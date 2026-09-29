'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const { currentCode, verifyCode } = require('./presence');
const { isConstraintError } = require('./db');
const { parseVoters, parseEmailList, normalizeClass } = require('./csv');

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
    });
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // CSRF-védelem: minden módosító kérésnek JSON-nak kell lennie (+ SameSite=Strict süti).
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && !req.is('application/json')) {
      return res.status(415).json({ error: 'JSON kérés szükséges.' });
    }
    next();
  });

  // ---------- adatbázis-lekérdezések ----------

  const q = {
    voter: db.prepare('SELECT email, class, absent FROM voters WHERE email = ?'),
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
    classCounts: db.prepare(
      'SELECT class, COUNT(*) total, SUM(absent) absent FROM voters GROUP BY class ORDER BY class'
    ),
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

  function eligibleCount(election) {
    const classes = allowedClasses(election);
    const rows = q.classCounts.all();
    return rows
      .filter((r) => !classes || classes.includes(r.class))
      .reduce((sum, r) => sum + r.total - (r.absent || 0), 0);
  }

  // Jogosultság eldöntése egy helyen – a /api/me és a szavazás is ezt használja.
  function eligibility(email) {
    const election = q.openElection.get();
    const voter = q.voter.get(email);
    if (!election) return { ok: false, reason: 'no_open_election', election: null, voter };
    if (!voter) return { ok: false, reason: 'not_on_list', election, voter };
    if (voter.absent) return { ok: false, reason: 'absent', election, voter };
    const classes = allowedClasses(election);
    if (classes && !classes.includes(voter.class)) return { ok: false, reason: 'class_not_in_round', election, voter };
    if (q.hasVoted.get(election.id, email)) return { ok: false, reason: 'already_voted', election, voter };
    return { ok: true, reason: null, election, voter };
  }

  // ---------- munkamenet ----------

  function setSessionCookie(res, token, maxAgeSec) {
    const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (cfg.cookieSecure) parts.push('Secure');
    res.set('Set-Cookie', parts.join('; '));
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

  const isAdmin = (email) => cfg.adminEmails.includes(email);
  const requireAdmin = (req, res, next) =>
    req.session && isAdmin(req.session.email) ? next() : next(new HttpError(403, 'Nincs admin jogosultságod.'));

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
      class: el.voter ? el.voter.class : null,
      canVote: el.ok,
      reason: el.reason,
      present: req.session.present_until > Date.now(),
      election: el.election
        ? {
            id: el.election.id,
            name: el.election.name,
            isTrial: !!el.election.is_trial,
            candidates: q.candidates.all(el.election.id),
          }
        : null,
    });
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
    if (!verifyCode(cfg, el.election.id, req.body.code)) {
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
    try {
      castVote(el.election.id, email, String(req.body.candidateId || ''));
    } catch (e) {
      return next(e);
    }
    q.sessionPresent.run(0, req.session.tokenHash);
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
    const adminOk = req.session && isAdmin(req.session.email);
    if (!keyOk && !adminOk) return next(new HttpError(403, 'Érvénytelen kivetítő-kulcs.'));
    const election = q.openElection.get();
    if (!election) return res.json({ open: false });
    const c = currentCode(cfg, election.id);
    const url = `${req.protocol}://${req.get('host')}/?kod=${c.code}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ open: true, electionName: election.name, isTrial: !!election.is_trial, ...c, qrSvg });
  });

  // ---------- admin ----------

  const admin = express.Router();
  admin.use(requireLogin, requireAdmin);

  admin.get('/overview', (req, res) => {
    const classes = q.classCounts.all();
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
      votedCount: q.votedCount.get(e.id).n,
      eligibleCount: e.status === 'closed' ? JSON.parse(e.protocol).eligibleCount : eligibleCount(e),
      resultHash: e.result_hash,
    }));
    res.json({ me: req.session.email, classes, elections });
  });

  admin.put('/voters', (req, res, next) => {
    if (q.openElection.get()) return next(new HttpError(409, 'Nyitott szavazás alatt a névjegyzék nem cserélhető.'));
    const { voters, errors } = parseVoters(req.body.csv, cfg.allowedDomain);
    if (errors.length) return res.status(400).json({ error: 'Hibás sorok a névjegyzékben.', details: errors.slice(0, 50) });
    if (!voters.length) return next(new HttpError(400, 'Üres névjegyzék.'));
    db.transaction(() => {
      db.prepare('DELETE FROM voters').run();
      const ins = db.prepare('INSERT INTO voters (email, class) VALUES (?, ?)');
      voters.forEach((v) => ins.run(v.email, v.class));
    })();
    audit(req.session.email, 'voters_replaced', { count: voters.length });
    res.json({ ok: true, count: voters.length });
  });

  admin.put('/absent', (req, res) => {
    const emails = parseEmailList(req.body.emails);
    let matched = 0;
    db.transaction(() => {
      db.prepare('UPDATE voters SET absent = 0').run();
      const upd = db.prepare('UPDATE voters SET absent = 1 WHERE email = ?');
      emails.forEach((e) => (matched += upd.run(e).changes));
    })();
    audit(req.session.email, 'absent_set', { listed: emails.length, matched });
    res.json({ ok: true, listed: emails.length, matched, unknown: emails.length - matched });
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
    const id = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO elections (name, is_trial, allowed_classes, created_at) VALUES (?, ?, ?, ?)')
        .run(name, req.body.isTrial ? 1 : 0, allowed.length ? JSON.stringify(allowed) : null, nowIso());
      const eid = info.lastInsertRowid;
      const insC = db.prepare('INSERT INTO candidates (election_id, id, label, position) VALUES (?, ?, ?, ?)');
      const insT = db.prepare('INSERT INTO tally (election_id, candidate_id, count) VALUES (?, ?, 0)');
      candidates.forEach((c, i) => {
        insC.run(eid, c.id, c.label, i);
        insT.run(eid, c.id);
      });
      return eid;
    })();
    audit(req.session.email, 'election_created', { id, name, candidates, allowedClasses: allowed });
    res.json({ ok: true, id: Number(id) });
  });

  admin.post('/elections/:id/open', (req, res, next) => {
    const e = q.election.get(req.params.id);
    if (!e) return next(new HttpError(404, 'Nincs ilyen szavazás.'));
    if (e.status !== 'draft') return next(new HttpError(409, 'Csak előkészített szavazás nyitható meg.'));
    if (q.openElection.get()) return next(new HttpError(409, 'Már van nyitott szavazás.'));
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
        openedAt: e.opened_at,
        closedAt,
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

  admin.get('/audit', (req, res) => res.json({ log: q.auditList.all() }));

  app.use('/api/admin', admin);

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
