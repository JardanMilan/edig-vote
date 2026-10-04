'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const { currentCode, verifyCode } = require('./presence');
const { isConstraintError } = require('./db');
const { parseVoters, parseEmailList, normalizeClass, groupKind } = require('./csv');

const MAX_CODE_FAILS = 5;
const CODE_LOCK_MS = 5 * 60 * 1000;

// ---------- segédfüggvények ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function ipAllowed(ip, allowed) {
  if (!allowed.length) return true;
  const clean = String(ip || '').replace(/^::ffff:/, '');
  return allowed.some((rule) => {
    if (!rule.includes('/')) return rule === clean;
    const [base, bitsStr] = rule.split('/');
    const bits = Number(bitsStr);
    const a = ipv4ToInt(clean);
    const b = ipv4ToInt(base);
    if (a === null || b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- alkalmazás ----------

function createApp({ cfg, db, verifyGoogle }) {
  const app = express();
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);
  app.disable('x-powered-by');

  // Szándékosan NINCS kérés-naplózás a törzzsel: a szavazat tartalma sehol nem kerülhet logba.

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' https://accounts.google.com/gsi/client",
        "frame-src https://accounts.google.com/gsi/",
        "connect-src 'self' https://accounts.google.com/gsi/",
        "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
        "img-src 'self' data: https://*.googleusercontent.com",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
    });
    if (cfg.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // CSRF-védelem: minden módosító kérésnek JSON-nak kell lennie (+ SameSite=Strict süti).
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && !/^application\/json\b/i.test(req.get('content-type') || '')) {
      return res.status(415).json({ error: 'JSON kérés szükséges.' });
    }
    next();
  });

  // ---------- adatbázis-lekérdezések ----------

  const q = {
    voter: db.prepare('SELECT email, class, name FROM voters WHERE email = ?'),
    groups: db.prepare('SELECT name, kind FROM groups ORDER BY name'),
    group: db.prepare('SELECT name, kind FROM groups WHERE name = ?'),
    groupLeaders: db.prepare('SELECT email FROM group_leaders WHERE group_name = ? ORDER BY email'),
    leaderGroups: db.prepare('SELECT group_name FROM group_leaders WHERE email = ? ORDER BY group_name'),
    members: db.prepare('SELECT email, name FROM voters WHERE class = ? ORDER BY name, email'),
    memberCount: db.prepare('SELECT COUNT(*) n FROM voters WHERE class = ?'),
    attendanceGet: db.prepare('SELECT present FROM attendance WHERE election_id = ? AND email = ?'),
    attendanceSet: db.prepare(
      `INSERT INTO attendance (election_id, email, present, marked_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (election_id, email) DO UPDATE SET present = excluded.present, marked_by = excluded.marked_by`
    ),
    presentCount: db.prepare(
      `SELECT COUNT(*) n FROM attendance a JOIN voters v ON v.email = a.email
       WHERE a.election_id = ? AND a.present = 1 AND v.class = ?`
    ),
    latestDraft: db.prepare("SELECT * FROM elections WHERE status = 'draft' ORDER BY id DESC LIMIT 1"),
    openElection: db.prepare("SELECT * FROM elections WHERE status = 'open' LIMIT 1"),
    election: db.prepare('SELECT * FROM elections WHERE id = ?'),
    elections: db.prepare('SELECT * FROM elections ORDER BY id DESC'),
    candidates: db.prepare('SELECT id, label FROM candidates WHERE election_id = ? ORDER BY position'),
    hasVoted: db.prepare('SELECT 1 FROM voted WHERE election_id = ? AND email = ?'),
    votedCount: db.prepare('SELECT COUNT(*) n FROM voted WHERE election_id = ?'),
    ballotCount: db.prepare('SELECT COALESCE(SUM(count),0) n FROM tally WHERE election_id = ?'),
    tally: db.prepare(
      `SELECT c.id, c.label, t.count FROM candidates c
       JOIN tally t ON t.election_id = c.election_id AND t.candidate_id = c.id
       WHERE c.election_id = ? ORDER BY t.count DESC, c.position`
    ),
    turnoutByClass: db.prepare(
      `SELECT v.class, COUNT(*) n FROM voted d JOIN voters v ON v.email = d.email
       WHERE d.election_id = ? GROUP BY v.class ORDER BY v.class`
    ),
    classCounts: db.prepare('SELECT class, COUNT(*) total FROM voters GROUP BY class ORDER BY class'),
    sessionGet: db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?'),
    sessionIns: db.prepare('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)'),
    sessionDel: db.prepare('DELETE FROM sessions WHERE token = ?'),
    sessionPresent: db.prepare('UPDATE sessions SET present_until = ? WHERE token = ?'),
    sessionsCleanup: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    audit: db.prepare('INSERT INTO audit_log (at, actor, action, details) VALUES (?, ?, ?, ?)'),
    auditList: db.prepare('SELECT at, actor, action, details FROM audit_log ORDER BY id DESC LIMIT 200'),
  };

  const audit = (actor, action, details) =>
    q.audit.run(nowIso(), actor, action, details ? JSON.stringify(details) : null);

  function allowedClasses(election) {
    return election.allowed_classes ? JSON.parse(election.allowed_classes) : null;
  }

  const groupAllowed = (election, groupName) => {
    const classes = allowedClasses(election);
    return !classes || classes.includes(groupName);
  };

  // A névjegyzékben szereplő, az adott szavazáson részt vevő csoportok tagjainak száma.
  function memberTotal(election) {
    return q.classCounts
      .all()
      .filter((r) => groupAllowed(election, r.class))
      .reduce((sum, r) => sum + r.total, 0);
  }

  // Jogosultak száma: jelenlét-ellenőrzésnél csak a jelennek jelöltek, egyébként minden tag.
  function eligibleCount(election) {
    if (!election.require_attendance) return memberTotal(election);
    return q.classCounts
      .all()
      .filter((r) => groupAllowed(election, r.class))
      .reduce((sum, r) => sum + q.presentCount.get(election.id, r.class).n, 0);
  }

  // A tanári felület melyik szavazásra rögzít jelenlétet: a nyitottra, ha nincs, a legutóbb előkészítettre.
  const activeElection = () => q.openElection.get() || q.latestDraft.get() || null;

  const isAdmin = (email) => cfg.adminEmails.includes(email);
  const leaderGroups = (email) => q.leaderGroups.all(email).map((r) => r.group_name);

  // Jogosultság eldöntése egy helyen – a /api/me és a szavazás is ezt használja.
  function eligibility(email) {
    const election = q.openElection.get();
    const voter = q.voter.get(email);
    if (!election) return { ok: false, reason: 'no_open_election', election: null, voter };
    if (!voter) return { ok: false, reason: 'not_on_list', election, voter };
    if (!groupAllowed(election, voter.class)) return { ok: false, reason: 'class_not_in_round', election, voter };
    if (q.hasVoted.get(election.id, email)) return { ok: false, reason: 'already_voted', election, voter };
    if (election.require_attendance) {
      const a = q.attendanceGet.get(election.id, email);
      if (!a) return { ok: false, reason: 'not_marked', election, voter };
      if (!a.present) return { ok: false, reason: 'absent', election, voter };
    }
    return { ok: true, reason: null, election, voter };
  }

  // ---------- munkamenet ----------

  function setSessionCookie(res, token, maxAgeSec) {
    const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (cfg.cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function startSession(res, email) {
    const token = crypto.randomBytes(32).toString('base64url');
    q.sessionsCleanup.run(Date.now());
    q.sessionIns.run(sha256(token), email, Date.now() + cfg.sessionTtlSec * 1000);
    setSessionCookie(res, token, cfg.sessionTtlSec);
  }

  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      const s = q.sessionGet.get(sha256(token), Date.now());
      if (s) req.session = { ...s, tokenHash: sha256(token) };
    }
    next();
  });

  const requireLogin = (req, res, next) =>
    req.session ? next() : next(new HttpError(401, 'Nem vagy bejelentkezve.', 'not_logged_in'));

  const requireAdmin = (req, res, next) =>
    req.session && isAdmin(req.session.email) ? next() : next(new HttpError(403, 'Nincs admin jogosultságod.'));

  // Osztályfőnök / csoportfelelős: legalább egy csoport felelőse.
  const requireLeader = (req, res, next) => {
    if (!req.session) return next(new HttpError(401, 'Nem vagy bejelentkezve.', 'not_logged_in'));
    req.leaderOf = leaderGroups(req.session.email);
    return req.leaderOf.length
      ? next()
      : next(new HttpError(403, 'Egyetlen osztálynak vagy csoportnak sem vagy a felelőse.', 'not_leader'));
  };

  const requireSchoolNetwork = (req, res, next) =>
    ipAllowed(req.ip, cfg.allowedIps)
      ? next()
      : next(new HttpError(403, 'Szavazni csak az iskola hálózatáról lehet.', 'wrong_network'));

  // ---------- nyilvános végpontok ----------

  app.get('/api/config', (req, res) => {
    res.json({ googleClientId: cfg.googleClientId, devLogin: cfg.devLogin, domain: cfg.allowedDomain });
  });

  app.post('/api/login/google', async (req, res, next) => {
    try {
      const email = await verifyGoogle(String(req.body.credential || ''));
      startSession(res, email);
      res.json({ ok: true });
    } catch (e) {
      next(new HttpError(401, e.message || 'Sikertelen bejelentkezés.'));
    }
  });

  if (cfg.devLogin) {
    app.post('/api/login/dev', (req, res, next) => {
      const email = String(req.body.email || '').trim().toLowerCase();
      const domainOk = email.endsWith('@' + cfg.allowedDomain);
      if (!domainOk && !isAdmin(email)) return next(new HttpError(401, `Csak @${cfg.allowedDomain} cím.`));
      startSession(res, email);
      res.json({ ok: true });
    });
  }

  app.post('/api/logout', (req, res) => {
    if (req.session) q.sessionDel.run(req.session.tokenHash);
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/me', requireLogin, (req, res) => {
    const email = req.session.email;
    const el = eligibility(email);
    res.json({
      email,
      isAdmin: isAdmin(email),
      isLeader: leaderGroups(email).length > 0,
      name: el.voter ? el.voter.name : null,
      class: el.voter ? el.voter.class : null,
      canVote: el.ok,
      reason: el.reason,
      present: req.session.present_until > Date.now(),
      hasScan: !!readScan(req),
      election: el.election
        ? {
            id: el.election.id,
            name: el.election.name,
            isTrial: !!el.election.is_trial,
            candidates: q.candidates.all(el.election.id),
            // Ha a saját osztályra nem lehet szavazni, ezt a jelöltet a felület letiltja.
            blockedCandidate: el.election.no_self_vote && el.voter ? el.voter.class : null,
          }
        : null,
    });
  });

  // ----- QR-beolvasás megjegyzése -----
  // Aki a kivetített QR-t beolvassa, annak a Google-belépés (fiókválasztás, jelszó) akár percekig tarthat,
  // miközben a kód 30 mp-enként változik. Ezért a beolvasás PILLANATÁT a szerver aláírva, sütiben rögzíti,
  // és belépés után azt ellenőrzi, hogy a kód a beolvasáskor érvényes volt-e.
  // Ez a végpont szándékosan nem árulja el, hogy a kód helyes-e (különben bejelentkezés nélkül lehetne
  // találgatni); az ellenőrzés csak belépés után, a diákonkénti próbálkozás-korláttal történik.
  const scanSig = (payload) => crypto.createHmac('sha256', cfg.secret).update('scan:' + payload).digest('base64url');

  function setScanCookie(res, value, maxAgeSec) {
    const parts = [`scan=${value}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (cfg.cookieSecure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function readScan(req) {
    const raw = parseCookies(req.headers.cookie).scan;
    if (!raw) return null;
    const [code, t, sig] = raw.split('.');
    if (!code || !t || !sig || scanSig(`${code}.${t}`) !== sig) return null;
    if (Date.now() - Number(t) > cfg.scanTtlSec * 1000) return null;
    return { code, t: Number(t) };
  }

  app.post('/api/presence/scan', (req, res, next) => {
    const code = String(req.body.code || '').replace(/\D/g, '');
    if (code.length !== 6) return next(new HttpError(400, 'Érvénytelen kód.', 'bad_code'));
    const payload = `${code}.${Date.now()}`;
    setScanCookie(res, `${payload}.${scanSig(payload)}`, cfg.scanTtlSec);
    res.json({ ok: true });
  });

  // Jelenléti kód beírása -> a munkamenet PRESENCE_TTL_SEC ideig "jelen van".
  const codeFails = new Map(); // email -> { fails, lockedUntil }
  app.post('/api/presence', requireLogin, requireSchoolNetwork, (req, res, next) => {
    const email = req.session.email;
    const el = eligibility(email);
    if (!el.ok) return next(new HttpError(403, 'Most nem szavazhatsz.', el.reason));

    const f = codeFails.get(email) || { fails: 0, lockedUntil: 0 };
    if (f.lockedUntil > Date.now()) {
      const min = Math.ceil((f.lockedUntil - Date.now()) / 60000);
      return next(new HttpError(429, `Túl sok hibás kód. Próbáld újra ${min} perc múlva.`, 'locked'));
    }
    // Kód forrása: a most beírt kód, vagy a korábbi QR-beolvasás (a beolvasás idejére ellenőrizve).
    const typed = req.body.code !== undefined && req.body.code !== '';
    const scan = typed ? null : readScan(req);
    if (!typed && !scan) return next(new HttpError(400, 'Írd be a kivetítőn látható kódot.', 'bad_code'));
    const ok = typed
      ? verifyCode(cfg, el.election.id, req.body.code)
      : verifyCode(cfg, el.election.id, scan.code, scan.t);
    if (scan) setScanCookie(res, '', 0); // egyszer használható

    if (!ok) {
      f.fails += 1;
      if (f.fails >= MAX_CODE_FAILS) Object.assign(f, { fails: 0, lockedUntil: Date.now() + CODE_LOCK_MS });
      codeFails.set(email, f);
      return next(new HttpError(400, 'Hibás vagy lejárt kód. Nézd meg a kivetítőt!', 'bad_code'));
    }
    codeFails.delete(email);
    q.sessionPresent.run(Date.now() + cfg.presenceTtlSec * 1000, req.session.tokenHash);
    res.json({ ok: true, presentForSec: cfg.presenceTtlSec });
  });

  // A szavazás: egyetlen tranzakció.
  //   1) beírjuk a `voted` táblába, hogy ez az email szavazott (PRIMARY KEY -> másodszor elbukik)
  //   2) növeljük a választott osztály számlálóját a `tally` táblában
  // Ha bármelyik lépés hibázik, egyik sem történik meg.
  const castVote = db.transaction((electionId, email, candidateId) => {
    const e = q.election.get(electionId);
    if (!e || e.status !== 'open') throw new HttpError(409, 'A szavazás már lezárult.', 'no_open_election');
    try {
      db.prepare('INSERT INTO voted (election_id, email) VALUES (?, ?)').run(electionId, email);
    } catch (err) {
      if (isConstraintError(err)) {
        throw new HttpError(409, 'Már leadtad a szavazatodat.', 'already_voted');
      }
      throw err;
    }
    const r = db
      .prepare('UPDATE tally SET count = count + 1 WHERE election_id = ? AND candidate_id = ?')
      .run(electionId, candidateId);
    if (r.changes !== 1) throw new HttpError(400, 'Érvénytelen választás.', 'bad_candidate');
  });

  app.post('/api/vote', requireLogin, requireSchoolNetwork, (req, res, next) => {
    const email = req.session.email;
    const el = eligibility(email);
    if (!el.ok) return next(new HttpError(403, 'Most nem szavazhatsz.', el.reason));
    if (!(req.session.present_until > Date.now())) {
      return next(new HttpError(403, 'Előbb írd be a kivetítőn látható kódot.', 'not_present'));
    }
    const candidateId = String(req.body.candidateId || '');
    if (el.election.no_self_vote && candidateId === el.voter.class) {
      return next(new HttpError(400, 'A saját osztályodra nem szavazhatsz.', 'own_class'));
    }
    try {
      castVote(el.election.id, email, candidateId);
    } catch (e) {
      return next(e);
    }
    // Szavazás után kiléptetjük: közös gépen (gépterem) a következő diák ne az ő munkamenetében folytassa.
    q.sessionDel.run(req.session.tokenHash);
    setSessionCookie(res, '', 0);
    // Szándékosan nem adunk vissza semmit, ami a választást azonosítaná.
    res.json({ ok: true });
  });

  // ---------- kivetítő (kiosk) ----------

  app.get('/api/kiosk/code', async (req, res, next) => {
    const key = String(req.query.key || '');
    const keyOk =
      cfg.kioskKey &&
      key.length === cfg.kioskKey.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(cfg.kioskKey));
    // Adminként vagy osztályfőnökként belépve kulcs nélkül is megnyitható.
    const adminOk = req.session && (isAdmin(req.session.email) || leaderGroups(req.session.email).length > 0);
    if (!keyOk && !adminOk) return next(new HttpError(403, 'Érvénytelen kivetítő-kulcs.'));
    const election = q.openElection.get();
    if (!election) {
      // Nincs nyitott szavazás: ha az admin közzétette, a legutóbbi eredményt mutatjuk.
      const pub = db
        .prepare("SELECT protocol FROM elections WHERE status = 'closed' AND published = 1 ORDER BY closed_at DESC LIMIT 1")
        .get();
      if (!pub) return res.json({ open: false });
      const p = JSON.parse(pub.protocol);
      return res.json({
        open: false,
        results: {
          name: p.name, isTrial: p.isTrial, results: p.results, winners: p.winners,
          ballotCount: p.ballotCount, votedCount: p.votedCount, eligibleCount: p.eligibleCount,
        },
      });
    }
    const c = currentCode(cfg, election.id);
    const url = `${req.protocol}://${req.get('host')}/?kod=${c.code}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ open: true, electionName: election.name, isTrial: !!election.is_trial, ...c, qrSvg });
  });

  // ---------- admin ----------

  const admin = express.Router();
  admin.use(requireLogin, requireAdmin);

  // Csoportok áttekintése: létszám, felelősök, és az aktív szavazásra rögzített jelenlét.
  function groupsSummary() {
    const active = activeElection();
    return q.groups.all().map((g) => ({
      name: g.name,
      kind: g.kind,
      leaders: q.groupLeaders.all(g.name).map((r) => r.email),
      total: q.memberCount.get(g.name).n,
      present: active ? q.presentCount.get(active.id, g.name).n : null,
    }));
  }

  admin.get('/overview', (req, res) => {
    const groups = groupsSummary();
    const classes = groups.map((g) => ({ class: g.name, total: g.total })); // régi felület kompatibilitás
    const elections = q.elections.all().map((e) => ({
      id: e.id,
      name: e.name,
      isTrial: !!e.is_trial,
      status: e.status,
      allowedClasses: allowedClasses(e),
      createdAt: e.created_at,
      openedAt: e.opened_at,
      closedAt: e.closed_at,
      candidates: q.candidates.all(e.id),
      // Élő részvétel: CSAK a létszám, az eredmény lezárásig nem látható.
      noSelfVote: !!e.no_self_vote,
      requireAttendance: !!e.require_attendance,
      memberTotal: memberTotal(e),
      published: !!e.published,
      votedCount: q.votedCount.get(e.id).n,
      eligibleCount: e.status === 'closed' ? JSON.parse(e.protocol).eligibleCount : eligibleCount(e),
      resultHash: e.result_hash,
    }));
    res.json({ me: req.session.email, classes, groups, elections });
  });

  const rosterLocked = (next) => {
    if (!q.openElection.get()) return false;
    next(new HttpError(409, 'Nyitott szavazás alatt a névjegyzék és a csoportok nem módosíthatók.'));
    return true;
  };
  const upsertGroup = db.prepare(
    'INSERT INTO groups (name, kind) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET kind = excluded.kind'
  );
  const upsertVoter = db.prepare(
    `INSERT INTO voters (email, class, name) VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET class = excluded.class,
       name = CASE WHEN excluded.name = '' THEN voters.name ELSE excluded.name END`
  );

  // Névjegyzék importálása CSV-ből (email;csoport;név). A hiányzó csoportok létrejönnek.
  // mode = 'replace': a teljes névjegyzék cseréje; 'merge': hozzáadás / módosítás.
  admin.put('/voters', (req, res, next) => {
    if (rosterLocked(next)) return;
    const replace = req.body.mode !== 'merge';
    const { voters, errors } = parseVoters(req.body.csv, cfg.allowedDomain);
    if (errors.length) return res.status(400).json({ error: 'Hibás sorok a névjegyzékben.', details: errors.slice(0, 50) });
    if (!voters.length) return next(new HttpError(400, 'Üres névjegyzék.'));
    db.transaction(() => {
      if (replace) db.prepare('DELETE FROM voters').run();
      for (const v of voters) {
        if (!q.group.get(v.class)) upsertGroup.run(v.class, groupKind(v.class));
        upsertVoter.run(v.email, v.class, v.name);
      }
    })();
    audit(req.session.email, replace ? 'voters_replaced' : 'voters_merged', { count: voters.length });
    res.json({ ok: true, count: voters.length });
  });

  // ----- Csoportok / osztályok és felelőseik (osztályfőnökök) -----

  admin.post('/groups', (req, res, next) => {
    const name = normalizeClass(req.body.name);
    if (!name || name.length > 30) return next(new HttpError(400, 'Adj meg egy csoportnevet (max. 30 karakter).'));
    const kind = ['osztaly', 'csoport'].includes(req.body.kind) ? req.body.kind : groupKind(name);
    const rawLeaders = Array.isArray(req.body.leaders) ? req.body.leaders.join(',') : String(req.body.leaders || '');
    const leaders = parseEmailList(rawLeaders);
    const bad = leaders.filter((e) => e.split('@')[1] !== cfg.allowedDomain);
    if (bad.length) return next(new HttpError(400, `Csak @${cfg.allowedDomain} cím lehet felelős: ${bad.join(', ')}`));
    db.transaction(() => {
      upsertGroup.run(name, kind);
      db.prepare('DELETE FROM group_leaders WHERE group_name = ?').run(name);
      const ins = db.prepare('INSERT INTO group_leaders (group_name, email) VALUES (?, ?)');
      leaders.forEach((e) => ins.run(name, e));
    })();
    audit(req.session.email, 'group_saved', { name, kind, leaders });
    res.json({ ok: true, name });
  });

  admin.delete('/groups/:name', (req, res, next) => {
    if (rosterLocked(next)) return;
    const name = req.params.name;
    if (!q.group.get(name)) return next(new HttpError(404, 'Nincs ilyen csoport.'));
    if (q.memberCount.get(name).n > 0) return next(new HttpError(409, 'Csak üres csoport törölhető.'));
    db.prepare('DELETE FROM groups WHERE name = ?').run(name);
    audit(req.session.email, 'group_deleted', { name });
    res.json({ ok: true });
  });

  admin.get('/groups/:name/members', (req, res, next) => {
    const g = q.group.get(req.params.name);
    if (!g) return next(new HttpError(404, 'Nincs ilyen csoport.'));
    res.json({ group: g.name, members: q.members.all(g.name) });
  });

  // Egy tag felvétele vagy áthelyezése másik csoportba
  admin.post('/members', (req, res, next) => {
    if (rosterLocked(next)) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    const group = normalizeClass(req.body.group);
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.split('@')[1] !== cfg.allowedDomain) {
      return next(new HttpError(400, `Érvényes @${cfg.allowedDomain} cím kell.`));
    }
    if (!q.group.get(group)) return next(new HttpError(404, 'Nincs ilyen csoport. Előbb hozd létre.'));
    upsertVoter.run(email, group, name);
    audit(req.session.email, 'member_saved', { email, group });
    res.json({ ok: true });
  });

  admin.delete('/members/:email', (req, res, next) => {
    if (rosterLocked(next)) return;
    const email = String(req.params.email).toLowerCase();
    const r = db.prepare('DELETE FROM voters WHERE email = ?').run(email);
    if (r.changes !== 1) return next(new HttpError(404, 'Nincs ilyen tag.'));
    audit(req.session.email, 'member_removed', { email });
    res.json({ ok: true });
  });

  // Ügyelet: az admin bárki jelenlétét javíthatja az aktív szavazásban.
  admin.put('/attendance', (req, res, next) => {
    const e = activeElection();
    if (!e) return next(new HttpError(409, 'Nincs előkészített vagy nyitott szavazás.'));
    const email = String(req.body.email || '').toLowerCase();
    if (!q.voter.get(email)) return next(new HttpError(404, 'Nincs ilyen diák a névjegyzékben.'));
    if (!req.body.present && q.hasVoted.get(e.id, email)) {
      return next(new HttpError(409, 'Aki már szavazott, nem jelölhető hiányzónak.'));
    }
    q.attendanceSet.run(e.id, email, req.body.present ? 1 : 0, req.session.email);
    audit(req.session.email, 'attendance_set', { election: e.id, email, present: !!req.body.present });
    res.json({ ok: true });
  });

  admin.post('/elections', (req, res, next) => {
    const name = String(req.body.name || '').trim();
    const candidates = (Array.isArray(req.body.candidates) ? req.body.candidates : [])
      .map((c) => ({ id: normalizeClass(c.id), label: String(c.label || c.id || '').trim() }))
      .filter((c) => c.id && c.label);
    const allowed = Array.isArray(req.body.allowedClasses)
      ? [...new Set(req.body.allowedClasses.map(normalizeClass).filter(Boolean))]
      : [];
    if (!name) return next(new HttpError(400, 'Adj nevet a szavazásnak.'));
    if (candidates.length < 2) return next(new HttpError(400, 'Legalább 2 jelölt kell.'));
    if (new Set(candidates.map((c) => c.id)).size !== candidates.length) {
      return next(new HttpError(400, 'Ismétlődő jelölt-azonosító.'));
    }
    const known = new Set(q.groups.all().map((r) => r.name));
    const unknownClasses = allowed.filter((c) => !known.has(c));
    if (unknownClasses.length) {
      return next(new HttpError(400, `Ilyen osztály/csoport nincs: ${unknownClasses.join(', ')}`));
    }
    // Alapértelmezés: csak az szavazhat, akit az osztályfőnöke jelennek jelölt.
    const requireAttendance = req.body.requireAttendance === undefined ? 1 : req.body.requireAttendance ? 1 : 0;
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO elections (name, is_trial, allowed_classes, no_self_vote, require_attendance, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          req.body.isTrial ? 1 : 0,
          allowed.length ? JSON.stringify(allowed) : null,
          req.body.noSelfVote ? 1 : 0,
          requireAttendance,
          nowIso()
        );
      const eid = info.lastInsertRowid;
      const insC = db.prepare('INSERT INTO candidates (election_id, id, label, position) VALUES (?, ?, ?, ?)');
      const insT = db.prepare('INSERT INTO tally (election_id, candidate_id, count) VALUES (?, ?, 0)');
      candidates.forEach((c, i) => {
        insC.run(eid, c.id, c.label, i);
        insT.run(eid, c.id);
      });
      return eid;
    })();
    audit(req.session.email, 'election_created', {
      id, name, candidates, allowedClasses: allowed, noSelfVote: !!req.body.noSelfVote,
      requireAttendance: !!requireAttendance,
    });
    res.json({ ok: true, id: Number(id) });
  });

  admin.post('/elections/:id/open', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'draft') return next(new HttpError(409, 'Csak előkészített szavazás nyitható meg.'));
    if (q.openElection.get()) return next(new HttpError(409, 'Már van nyitott szavazás.'));
    // Jelenlét-ellenőrzésnél a jelenlétet megnyitás után is lehet rögzíteni, ezért itt a létszám számít.
    if (memberTotal(e) === 0) {
      return next(new HttpError(409, 'A kijelölt csoportokban nincs egyetlen tag sem (üres névjegyzék).'));
    }
    db.prepare("UPDATE elections SET status = 'open', opened_at = ? WHERE id = ?").run(nowIso(), e.id);
    audit(req.session.email, 'election_opened', { id: e.id });
    res.json({ ok: true });
  });

  admin.post('/elections/:id/close', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'open') return next(new HttpError(409, 'Csak nyitott szavazás zárható le.'));

    const protocol = db.transaction(() => {
      const closedAt = nowIso();
      db.prepare("UPDATE elections SET status = 'closed', closed_at = ? WHERE id = ?").run(closedAt, e.id);
      const results = q.tally.all(e.id);
      const top = results.length ? results[0].count : 0;
      const p = {
        electionId: e.id,
        name: e.name,
        isTrial: !!e.is_trial,
        allowedClasses: allowedClasses(e),
        noSelfVote: !!e.no_self_vote,
        requireAttendance: !!e.require_attendance,
        openedAt: e.opened_at,
        closedAt,
        memberTotal: memberTotal(e),
        eligibleCount: eligibleCount(e),
        votedCount: q.votedCount.get(e.id).n,
        ballotCount: q.ballotCount.get(e.id).n,
        turnoutByClass: q.turnoutByClass.all(e.id),
        results,
        winners: top > 0 ? results.filter((r) => r.count === top).map((r) => r.label) : [],
      };
      p.consistent = p.votedCount === p.ballotCount;
      const json = JSON.stringify(p);
      db.prepare('UPDATE elections SET protocol = ?, result_hash = ? WHERE id = ?').run(json, sha256(json), e.id);
      return p;
    })();
    audit(req.session.email, 'election_closed', { id: e.id, consistent: protocol.consistent });
    res.json({ ok: true });
  });

  admin.get('/elections/:id/protocol', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'closed') {
      return next(new HttpError(403, 'Az eredmény csak lezárás után látható – senkinek, adminnak sem.'));
    }
    res.json({ protocol: JSON.parse(e.protocol), resultHash: e.result_hash });
  });

  // A jegyzőkönyv pontosan abban a formában, ahogy a lenyomat készült: ezzel bárki ellenőrizheti
  // (npm run verify -- jegyzokonyv.json), hogy a kinyomtatott lenyomat ehhez a fájlhoz tartozik.
  admin.get('/elections/:id/protocol.json', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'closed') return next(new HttpError(403, 'Csak lezárt szavazás jegyzőkönyve tölthető le.'));
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="jegyzokonyv-${e.id}.json"`);
    res.send(e.protocol);
  });

  admin.post('/elections/:id/publish', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'closed') return next(new HttpError(409, 'Csak lezárt szavazás eredménye tehető közzé.'));
    const published = req.body.published ? 1 : 0;
    db.prepare('UPDATE elections SET published = ? WHERE id = ?').run(published, e.id);
    audit(req.session.email, published ? 'results_published' : 'results_unpublished', { id: e.id });
    res.json({ ok: true });
  });

  admin.delete('/elections/:id', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'draft') return next(new HttpError(409, 'Csak még meg nem nyitott szavazás törölhető.'));
    db.transaction(() => {
      db.prepare('DELETE FROM tally WHERE election_id = ?').run(e.id);
      db.prepare('DELETE FROM attendance WHERE election_id = ?').run(e.id);
      db.prepare('DELETE FROM candidates WHERE election_id = ?').run(e.id);
      db.prepare('DELETE FROM elections WHERE id = ?').run(e.id);
    })();
    audit(req.session.email, 'election_deleted', { id: e.id, name: e.name });
    res.json({ ok: true });
  });

  // Ügyelet a szavazás napján: diák keresése (név vagy email), jelenlét javítása.
  // Az admin látja, hogy valaki szavazott-e (mint papíron az aláírt névsor) – de azt nem, hogy mire.
  admin.get('/voters/search', (req, res) => {
    const term = String(req.query.q || '').trim().toLowerCase();
    if (term.length < 2) return res.json({ voters: [] });
    const open = q.openElection.get();
    const active = activeElection();
    const like = '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const rows = db
      .prepare(
        `SELECT email, class, name FROM voters
         WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' ORDER BY name, email LIMIT 20`
      )
      .all(like, like);
    res.json({
      openElection: !!open,
      activeElection: active ? { id: active.id, name: active.name, requireAttendance: !!active.require_attendance } : null,
      voters: rows.map((v) => {
        const a = active ? q.attendanceGet.get(active.id, v.email) : null;
        return {
          email: v.email,
          class: v.class,
          name: v.name,
          present: a ? !!a.present : null,
          voted: open ? !!q.hasVoted.get(open.id, v.email) : null,
        };
      }),
    });
  });

  // Adatvédelem: a szavazás után a személyes adatok (névjegyzék, ki szavazott, munkamenetek) törlése.
  // A jegyzőkönyvek (csak számok) megmaradnak.
  admin.post('/purge', (req, res, next) => {
    if (req.body.confirm !== 'TÖRLÉS') return next(new HttpError(400, 'Megerősítéshez írd be: TÖRLÉS'));
    if (q.openElection.get()) return next(new HttpError(409, 'Nyitott szavazás alatt nem törölhető.'));
    const counts = db.transaction(() => ({
      voters: db.prepare('DELETE FROM voters').run().changes,
      voted: db.prepare('DELETE FROM voted').run().changes,
      attendance: db.prepare('DELETE FROM attendance').run().changes,
      sessions: db.prepare('DELETE FROM sessions WHERE token != ?').run(req.session.tokenHash).changes,
    }))();
    audit(req.session.email, 'personal_data_purged', counts);
    res.json({ ok: true, ...counts });
  });

  admin.get('/audit', (req, res) => res.json({ log: q.auditList.all() }));

  app.use('/api/admin', admin);

  // ---------- osztályfőnök / csoportfelelős ----------
  // Csak a saját csoportjait látja és kezeli: a névsort, a jelenlétet, és hogy ki szavazott már.
  // Azt, hogy KIRE szavaztak, itt sem látja senki.

  const teacher = express.Router();
  teacher.use(requireLeader);

  teacher.get('/overview', (req, res) => {
    const e = activeElection();
    const showVoted = e && e.status === 'open';
    const groups = req.leaderOf.map((name) => {
      const g = q.group.get(name);
      const members = q.members.all(name).map((m) => {
        const a = e ? q.attendanceGet.get(e.id, m.email) : null;
        return {
          email: m.email,
          name: m.name,
          present: a ? !!a.present : null,
          voted: showVoted ? !!q.hasVoted.get(e.id, m.email) : null,
        };
      });
      return {
        name,
        kind: g ? g.kind : 'csoport',
        votes: e ? groupAllowed(e, name) : null, // részt vesz-e a csoport ebben a szavazásban
        members,
      };
    });
    res.json({
      me: req.session.email,
      isAdmin: isAdmin(req.session.email),
      election: e
        ? { id: e.id, name: e.name, status: e.status, isTrial: !!e.is_trial, requireAttendance: !!e.require_attendance }
        : null,
      groups,
    });
  });

  // Jelenlét rögzítése: { group, present: [email...], absent: [email...] }
  teacher.put('/attendance', (req, res, next) => {
    const e = activeElection();
    if (!e) return next(new HttpError(409, 'Nincs előkészített vagy nyitott szavazás.'));
    const group = String(req.body.group || '');
    if (!req.leaderOf.includes(group)) return next(new HttpError(403, 'Ennek a csoportnak nem vagy a felelőse.'));
    const list = (x) => (Array.isArray(x) ? x.map((s) => String(s).toLowerCase()) : []);
    const present = list(req.body.present);
    const absent = list(req.body.absent);
    const members = new Set(q.members.all(group).map((m) => m.email));
    const foreign = [...present, ...absent].filter((em) => !members.has(em));
    if (foreign.length) return next(new HttpError(403, `Nem a csoportod tagja: ${foreign.join(', ')}`));
    const votedAbsent = absent.filter((em) => q.hasVoted.get(e.id, em));
    if (votedAbsent.length) {
      return next(new HttpError(409, `Aki már szavazott, nem jelölhető hiányzónak: ${votedAbsent.join(', ')}`));
    }
    db.transaction(() => {
      present.forEach((em) => q.attendanceSet.run(e.id, em, 1, req.session.email));
      absent.forEach((em) => q.attendanceSet.run(e.id, em, 0, req.session.email));
    })();
    audit(req.session.email, 'attendance_marked', { election: e.id, group, present: present.length, absent: absent.length });
    res.json({ ok: true });
  });

  app.use('/api/teacher', teacher);

  // Állapotjelzés (monitorozáshoz, pl. uptime-figyelő)
  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, openElection: !!q.openElection.get() });
  });

  // ---------- statikus oldalak ----------

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // ---------- hibakezelés ----------

  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status === 500) console.error('Váratlan hiba:', err.message); // törzs nélkül!
    res.status(status).json({ error: status === 500 ? 'Szerverhiba.' : err.message, code: err.code });
  });

  return app;
}

module.exports = { createApp, ipAllowed };
