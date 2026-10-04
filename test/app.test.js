'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { createApp, ipAllowed } = require('../src/app');
const { currentCode, verifyCode } = require('../src/presence');
const { parseVoters } = require('../src/csv');

// ---------- tesztkörnyezet ----------

function setup(overrides = {}) {
  const cfg = loadConfig({
    devLogin: true,
    secret: 'teszt-titok',
    adminEmails: ['admin@edig.hu'],
    kioskKey: 'kulcs',
    cookieSecure: false,
    googleClientId: '',
    allowedIps: [],
    ...overrides,
  });
  const db = openDb(':memory:');
  const verifyGoogle = async (tok) => {
    if (tok === 'jo-token') return 'diak1@edig.hu';
    throw new Error('Csak @edig.hu fiókkal lehet belépni.');
  };
  const app = createApp({ cfg, db, verifyGoogle });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ cfg, db, server, base });
    });
  });
}

// Egyszerű "böngésző": süti-kezeléssel.
function client(base) {
  const jar = new Map();
  async function req(method, path, body, jsonHeader = body !== undefined) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, {
      method,
      headers: { ...(jsonHeader && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (!v || /Max-Age=0/.test(c)) jar.delete(k);
      else jar.set(k, v);
    }
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) { data = { text }; }
    return { status: res.status, data, text };
  }
  return {
    jar,
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b = {}) => req('PUT', p, b),
    del: (p) => req('DELETE', p, undefined, true), // mint a böngésző: fejléc, törzs nélkül
    login: (email) => req('POST', '/api/login/dev', { email }),
  };
}

const VOTERS = `email;osztaly
diak1@edig.hu;11.A
diak2@edig.hu;11.A
diak3@edig.hu;11.B
diak4@edig.hu;9.b
diak5@edig.hu;9.B
diak6@edig.hu;12a`;

// A régi tesztek jelenlét-ellenőrzés nélküli szavazással futnak; a jelenlétet külön tesztek nézik.
async function prepareElection(base, { allowedClasses = [], open = true, requireAttendance = false } = {}) {
  const admin = client(base);
  await admin.login('admin@edig.hu');
  let r = await admin.put('/api/admin/voters', { csv: VOTERS });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/admin/elections', {
    name: 'Teszt',
    isTrial: true,
    candidates: [{ id: '11.A', label: '11.A' }, { id: '11.B', label: '11.B' }],
    allowedClasses,
    requireAttendance,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.id;
  if (open) assert.equal((await admin.post(`/api/admin/elections/${id}/open`)).status, 200);
  return { admin, id };
}

async function studentReady(env, id, email) {
  const s = client(env.base);
  await s.login(email);
  const r = await s.post('/api/presence', { code: currentCode(env.cfg, id).code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return s;
}

// ---------- tesztek ----------

describe('segédfüggvények', () => {
  test('névjegyzék: osztálynév normalizálás, hibás sorok', () => {
    const { voters, errors } = parseVoters('email;osztaly\na@edig.hu;11a\nb@gmail.com;9.B\nc@edig.hu;\na@edig.hu;10.A', 'edig.hu');
    assert.deepEqual(voters, [{ email: 'a@edig.hu', class: '11.A', name: '' }]);
    assert.equal(errors.length, 3);
    const named = parseVoters('t@edig.hu;Tanár;Kovács  Anna', 'edig.hu').voters[0];
    assert.deepEqual(named, { email: 't@edig.hu', class: 'TANÁR', name: 'Kovács Anna' });
  });

  test('jelenléti kód: aktuális és előző ablak jó, régebbi nem', () => {
    const cfg = { secret: 's', codeWindowSec: 30, codeGraceWindows: 1 };
    const t = 1_700_000_000_000;
    const { code } = currentCode(cfg, 1, t);
    assert.ok(verifyCode(cfg, 1, code, t));
    assert.ok(verifyCode(cfg, 1, code, t + 30_000));
    assert.ok(!verifyCode(cfg, 1, code, t + 61_000));
    assert.ok(!verifyCode(cfg, 2, code, t), 'másik szavazás kódja nem jó');
  });

  test('IP-szűrés: pontos cím és CIDR', () => {
    assert.ok(ipAllowed('1.2.3.4', []));
    assert.ok(ipAllowed('::ffff:81.183.10.7', ['81.183.10.0/24']));
    assert.ok(!ipAllowed('81.183.11.7', ['81.183.10.0/24']));
    assert.ok(ipAllowed('10.0.0.5', ['10.0.0.5']));
  });
});

describe('szavazási folyamat', () => {
  let env;
  before(async () => { env = await setup(); });
  after(() => env.server.close());

  test('teljes kör: kód nélkül nem, kóddal egyszer, eredmény csak lezárás után', async () => {
    const { admin, id } = await prepareElection(env.base);
    const s = client(env.base);
    await s.login('diak1@edig.hu');

    let me = (await s.get('/api/me')).data;
    assert.equal(me.canVote, true);
    assert.equal(me.present, false);

    let r = await s.post('/api/vote', { candidateId: '11.B' });
    assert.equal(r.data.code, 'not_present');

    r = await s.post('/api/presence', { code: '000000' === currentCode(env.cfg, id).code ? '111111' : '000000' });
    assert.equal(r.data.code, 'bad_code');

    r = await s.post('/api/presence', { code: currentCode(env.cfg, id).code });
    assert.equal(r.status, 200);

    r = await s.post('/api/vote', { candidateId: '11.B' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true }, 'a válasz nem árulhatja el a választást');

    // szavazás után a munkamenet megszűnik (közös gépek miatt)
    r = await s.post('/api/vote', { candidateId: '11.A' });
    assert.equal(r.status, 401);
    await s.login('diak1@edig.hu');
    assert.equal((await s.get('/api/me')).data.reason, 'already_voted');
    r = await s.post('/api/vote', { candidateId: '11.A' });
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'already_voted');

    // eredmény nyitott szavazás alatt adminnak sem látható
    r = await admin.get(`/api/admin/elections/${id}/protocol`);
    assert.equal(r.status, 403);

    const s2 = await studentReady(env, id, 'diak3@edig.hu');
    assert.equal((await s2.post('/api/vote', { candidateId: '11.B' })).status, 200);
    const s3 = await studentReady(env, id, 'diak4@edig.hu');
    assert.equal((await s3.post('/api/vote', { candidateId: '11.A' })).status, 200);

    assert.equal((await admin.post(`/api/admin/elections/${id}/close`)).status, 200);
    r = await admin.get(`/api/admin/elections/${id}/protocol`);
    const p = r.data.protocol;
    assert.equal(p.votedCount, 3);
    assert.equal(p.ballotCount, 3);
    assert.equal(p.consistent, true);
    assert.deepEqual(p.results.map((x) => [x.id, x.count]), [['11.B', 2], ['11.A', 1]]);
    assert.deepEqual(p.winners, ['11.B']);
    assert.equal(p.eligibleCount, 6);
    assert.match(r.data.resultHash, /^[0-9a-f]{64}$/);

    // lezárás után nem lehet szavazni
    const late = client(env.base);
    await late.login('diak2@edig.hu');
    assert.equal((await late.get('/api/me')).data.reason, 'no_open_election');
  });
});

describe('jogosultság', () => {
  let env, id;
  before(async () => {
    env = await setup();
    ({ id } = await prepareElection(env.base, { allowedClasses: ['11.A', '9.B'] }));
  });
  after(() => env.server.close());

  const reason = async (email) => {
    const s = client(env.base);
    await s.login(email);
    return (await s.get('/api/me')).data.reason;
  };

  test('próbakör: csak a kijelölt osztályok', async () => {
    assert.equal(await reason('diak1@edig.hu'), null);
    assert.equal(await reason('diak4@edig.hu'), null); // "9.b" -> 9.B
    assert.equal(await reason('diak3@edig.hu'), 'class_not_in_round');
  });

  test('nincs a névjegyzékben', async () => {
    assert.equal(await reason('idegen@edig.hu'), 'not_on_list');
  });

  test('csak iskolai domain léphet be', async () => {
    const s = client(env.base);
    assert.equal((await s.login('valaki@gmail.com')).status, 401);
    assert.equal((await s.post('/api/login/google', { credential: 'rossz' })).status, 401);
    assert.equal((await s.post('/api/login/google', { credential: 'jo-token' })).status, 200);
    assert.equal((await s.get('/api/me')).data.email, 'diak1@edig.hu');
  });

  test('diák nem éri el az admin felületet', async () => {
    const s = client(env.base);
    await s.login('diak1@edig.hu');
    assert.equal((await s.get('/api/admin/overview')).status, 403);
    assert.equal((await s.post(`/api/admin/elections/${id}/close`)).status, 403);
  });

  test('névjegyzék nyitott szavazás alatt nem cserélhető', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    assert.equal((await admin.put('/api/admin/voters', { csv: VOTERS })).status, 409);
  });
});

describe('visszaélések és hibák', () => {
  let env, id;
  before(async () => {
    env = await setup();
    ({ id } = await prepareElection(env.base));
  });
  after(() => env.server.close());

  test('50 párhuzamos szavazási kérés ugyanattól a diáktól -> 1 szavazat', async () => {
    const s = await studentReady(env, id, 'diak5@edig.hu');
    const results = await Promise.all(Array.from({ length: 50 }, () => s.post('/api/vote', { candidateId: '11.A' })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const n = env.db.prepare('SELECT SUM(count) n FROM tally WHERE election_id = ?').get(id).n;
    assert.equal(n, 1);
  });

  test('érvénytelen jelölt: semmi nem íródik (tranzakció visszagörgetve)', async () => {
    const s = await studentReady(env, id, 'diak6@edig.hu');
    const r = await s.post('/api/vote', { candidateId: 'NINCS' });
    assert.equal(r.status, 400);
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM voted WHERE email = ?').get('diak6@edig.hu').n, 0);
    assert.equal((await s.post('/api/vote', { candidateId: '11.B' })).status, 200, 'utána még szavazhat');
  });

  test('5 hibás kód után zárolás', async () => {
    const s = client(env.base);
    await s.login('diak1@edig.hu');
    const good = currentCode(env.cfg, id).code;
    const bad = good === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) assert.equal((await s.post('/api/presence', { code: bad })).data.code, 'bad_code');
    const r = await s.post('/api/presence', { code: good });
    assert.equal(r.status, 429, 'zárolás alatt a jó kód sem működik');
  });

  test('nem JSON kérés elutasítva (CSRF-védelem)', async () => {
    const res = await fetch(env.base + '/api/vote', { method: 'POST', body: 'candidateId=11.A',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 415);
  });

  test('kivetítő: kulcs nélkül nem, kulccsal igen', async () => {
    assert.equal((await fetch(env.base + '/api/kiosk/code?key=rossz')).status, 403);
    const d = await (await fetch(env.base + '/api/kiosk/code?key=kulcs')).json();
    assert.equal(d.code, currentCode(env.cfg, id).code);
    assert.match(d.qrSvg, /^<svg/);
  });
});

describe('iskolai hálózat', () => {
  test('nem engedélyezett IP-ről nem lehet kódot beírni', async () => {
    const env = await setup({ allowedIps: ['81.183.10.0/24'] });
    const { id } = await prepareElection(env.base);
    const s = client(env.base);
    await s.login('diak1@edig.hu');
    const r = await s.post('/api/presence', { code: currentCode(env.cfg, id).code });
    assert.equal(r.data.code, 'wrong_network');
    env.server.close();
  });
});

describe('csoportok, osztályfőnökök, reggeli jelenlét', () => {
  let env, admin, id;
  before(async () => {
    env = await setup();
    admin = client(env.base);
    await admin.login('admin@edig.hu');
    let r = await admin.put('/api/admin/voters', {
      csv: `email;csoport;nev
diak1@edig.hu;11.A;Versenyző Vilma
diak4@edig.hu;9.B;Kiss Anna
diak5@edig.hu;9.B;Nagy Bence
tanar1@edig.hu;TANÁR;Tóth Tímea`,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await admin.post('/api/admin/groups', { name: '9.B', leaders: ['ofo9b@edig.hu'] })).status, 200);
    assert.equal((await admin.post('/api/admin/groups', { name: '11.A', leaders: 'ofo11a@edig.hu' })).status, 200);
    assert.equal((await admin.post('/api/admin/groups', { name: 'TANÁR', leaders: ['ih@edig.hu'] })).status, 200);
    assert.equal((await admin.post('/api/admin/groups', { name: '9.B', leaders: ['kulsos@gmail.com'] })).status, 400, 'csak iskolai cím');
    r = await admin.post('/api/admin/elections', {
      name: 'Diáknap', candidates: [{ id: '11.A', label: '11.A' }, { id: '11.B', label: '11.B' }],
      allowedClasses: ['9.B', 'TANÁR'],
    });
    id = r.data.id;
    assert.equal((await admin.post(`/api/admin/elections/${id}/open`)).status, 200);
  });
  after(() => env.server.close());

  const as = async (email) => {
    const c = client(env.base);
    await c.login(email);
    return c;
  };

  test('alapértelmezés: jelenlét nélkül nem lehet szavazni', async () => {
    const o = (await admin.get('/api/admin/overview')).data;
    assert.equal(o.elections[0].requireAttendance, true);
    assert.equal(o.elections[0].eligibleCount, 0);
    assert.equal(o.elections[0].memberTotal, 3);
    const s = await as('diak4@edig.hu');
    assert.equal((await s.get('/api/me')).data.reason, 'not_marked');
    assert.equal((await s.post('/api/presence', { code: currentCode(env.cfg, id).code })).data.code, 'not_marked');
  });

  test('az osztályfőnök csak a saját osztályát látja, nevekkel', async () => {
    const t = await as('ofo9b@edig.hu');
    const o = (await t.get('/api/teacher/overview')).data;
    assert.deepEqual(o.groups.map((g) => g.name), ['9.B']);
    assert.deepEqual(o.groups[0].members.map((m) => m.name), ['Kiss Anna', 'Nagy Bence']);
    assert.equal(o.groups[0].members[0].present, null);
    assert.equal(o.election.requireAttendance, true);
    assert.equal((await t.get('/api/admin/overview')).status, 403, 'nem admin');
    assert.equal((await t.get('/api/me')).data.isLeader, true);
  });

  test('jelenlét rögzítése után a jelen lévő szavazhat, a hiányzó nem', async () => {
    const t = await as('ofo9b@edig.hu');
    const r = await t.put('/api/teacher/attendance', { group: '9.B', present: ['diak4@edig.hu'], absent: ['diak5@edig.hu'] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await (await as('diak5@edig.hu')).get('/api/me')).data.reason, 'absent');
    const s = await studentReady(env, id, 'diak4@edig.hu');
    assert.equal((await s.post('/api/vote', { candidateId: '11.B' })).status, 200);
    const o = (await t.get('/api/teacher/overview')).data;
    const anna = o.groups[0].members.find((m) => m.email === 'diak4@edig.hu');
    assert.deepEqual([anna.present, anna.voted], [true, true]);
    const again = await t.put('/api/teacher/attendance', { group: '9.B', absent: ['diak4@edig.hu'] });
    assert.equal(again.status, 409, 'aki szavazott, nem jelölhető hiányzónak');
  });

  test('más osztályát nem kezelheti, és nem-felelős nem éri el', async () => {
    const t = await as('ofo9b@edig.hu');
    assert.equal((await t.put('/api/teacher/attendance', { group: '11.A', present: ['diak1@edig.hu'] })).status, 403);
    assert.equal((await t.put('/api/teacher/attendance', { group: '9.B', present: ['diak1@edig.hu'] })).status, 403);
    assert.equal((await t.put('/api/teacher/attendance', { group: '9.B', present: ['tanar1@edig.hu'] })).status, 403);
    const d = await as('diak4@edig.hu');
    assert.equal((await d.get('/api/teacher/overview')).data.code, 'not_leader');
    const o11 = (await (await as('ofo11a@edig.hu')).get('/api/teacher/overview')).data;
    assert.equal(o11.groups[0].votes, false, 'a 11.A ebben a szavazásban nem szavaz');
  });

  test('tanári csoport: a felelős (pl. igazgatóhelyettes) jelöli', async () => {
    const ih = await as('ih@edig.hu');
    assert.equal((await ih.put('/api/teacher/attendance', { group: 'TANÁR', present: ['tanar1@edig.hu'] })).status, 200);
    const t1 = await studentReady(env, id, 'tanar1@edig.hu');
    assert.equal((await t1.post('/api/vote', { candidateId: '11.A' })).status, 200);
  });

  test('osztályfőnök kulcs nélkül megnyithatja a kivetítőt', async () => {
    const t = await as('ofo9b@edig.hu');
    const k = await t.get('/api/kiosk/code');
    assert.equal(k.data.code, currentCode(env.cfg, id).code);
    assert.equal((await (await as('diak4@edig.hu')).get('/api/kiosk/code')).status, 403);
  });

  test('nyitott szavazás alatt a tagság nem módosítható; lezáráskor a jelenlévők a jogosultak', async () => {
    assert.equal((await admin.post('/api/admin/members', { email: 'uj@edig.hu', group: '9.B', name: 'Új' })).status, 409);
    assert.equal((await admin.del('/api/admin/members/diak5@edig.hu')).status, 409);
    assert.equal((await admin.post(`/api/admin/elections/${id}/close`)).status, 200);
    const p = (await admin.get(`/api/admin/elections/${id}/protocol`)).data.protocol;
    assert.deepEqual([p.eligibleCount, p.memberTotal, p.votedCount, p.ballotCount], [2, 3, 2, 2]);
    const t = await as('ofo9b@edig.hu');
    assert.equal((await t.put('/api/teacher/attendance', { group: '9.B', present: ['diak5@edig.hu'] })).status, 409, 'lezárás után nincs aktív szavazás');
  });

  test('tagok és csoportok kezelése szavazáson kívül', async () => {
    assert.equal((await admin.post('/api/admin/members', { email: 'uj@edig.hu', group: '9.B', name: 'Új Ödön' })).status, 200);
    assert.equal((await admin.post('/api/admin/members', { email: 'uj@edig.hu', group: 'NINCS' })).status, 404);
    let m = (await admin.get('/api/admin/groups/9.B/members')).data.members;
    assert.ok(m.some((x) => x.email === 'uj@edig.hu' && x.name === 'Új Ödön'));
    assert.equal((await admin.del('/api/admin/groups/9.B')).status, 409, 'nem üres');
    assert.equal((await admin.post('/api/admin/groups', { name: 'DÖK', kind: 'csoport' })).status, 200);
    assert.equal((await admin.post('/api/admin/members', { email: 'uj@edig.hu', group: 'DÖK' })).status, 200, 'áthelyezés');
    m = (await admin.get('/api/admin/groups/DÖK/members')).data.members;
    assert.equal(m[0].name, 'Új Ödön', 'áthelyezéskor a név megmarad');
    assert.equal((await admin.del('/api/admin/members/uj@edig.hu')).status, 200);
    assert.equal((await admin.del('/api/admin/groups/DÖK')).status, 200);
    const g = (await admin.get('/api/admin/overview')).data.groups.find((x) => x.name === '9.B');
    assert.deepEqual(g.leaders, ['ofo9b@edig.hu']);
  });
});

describe('anonimitás – adatbázis-szerkezet', () => {
  test('nincs olyan tábla, amelyben email és jelölt együtt szerepel', async () => {
    const db = openDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const hasPerson = cols.includes('email');
      const hasChoice = cols.includes('candidate_id');
      assert.ok(!(hasPerson && hasChoice), `${t} tábla összekapcsolná a szavazót és a szavazatot`);
    }
    const voted = db.prepare('PRAGMA table_info(voted)').all().map((c) => c.name);
    assert.deepEqual(voted.sort(), ['election_id', 'email'], 'a voted táblában nincs időbélyeg');
    const tally = db.prepare('PRAGMA table_info(tally)').all().map((c) => c.name);
    assert.deepEqual(tally.sort(), ['candidate_id', 'count', 'election_id']);
  });
});

describe('v0.2: QR-beolvasás, szabályok, admin funkciók', () => {
  let env;
  before(async () => { env = await setup(); });
  after(() => env.server.close());

  test('QR-beolvasás: belépés előtt rögzítve, belépés után kód beírása nélkül jelen van; egyszer használható', async () => {
    const { admin, id } = await prepareElection(env.base);
    const s = client(env.base);
    // a scan végpont nem árulja el, jó-e a kód
    assert.equal((await s.post('/api/presence/scan', { code: '000000' })).status, 200);
    await s.login('diak1@edig.hu');
    const wrong = currentCode(env.cfg, id).code === '000000';
    if (!wrong) assert.equal((await s.post('/api/presence', {})).data.code, 'bad_code');

    assert.equal((await s.post('/api/presence/scan', { code: currentCode(env.cfg, id).code })).status, 200);
    assert.equal((await s.get('/api/me')).data.hasScan, true);
    assert.equal((await s.post('/api/presence', {})).status, 200);
    assert.equal((await s.get('/api/me')).data.present, true);
    assert.equal((await s.post('/api/presence', {})).data.code, 'bad_code', 'a beolvasás egyszer használható');

    // hamisított scan süti nem jó
    const f = client(env.base);
    await f.login('diak2@edig.hu');
    f.jar.set('scan', `${currentCode(env.cfg, id).code}.${Date.now()}.hamis`);
    assert.equal((await f.post('/api/presence', {})).data.code, 'bad_code');
    await admin.post(`/api/admin/elections/${id}/close`);
  });

  test('saját osztályra szavazás tiltható', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    const r = await admin.post('/api/admin/elections', {
      name: 'Saját tiltva', noSelfVote: true, requireAttendance: false,
      candidates: [{ id: '11.A', label: '11.A' }, { id: '11.B', label: '11.B' }],
    });
    const id = r.data.id;
    assert.equal((await admin.post(`/api/admin/elections/${id}/open`)).status, 200);
    const s = await studentReady(env, id, 'diak2@edig.hu'); // 11.A
    assert.equal((await s.get('/api/me')).data.election.blockedCandidate, '11.A');
    assert.equal((await s.post('/api/vote', { candidateId: '11.A' })).data.code, 'own_class');
    assert.equal((await s.post('/api/vote', { candidateId: '11.B' })).status, 200);
    await admin.post(`/api/admin/elections/${id}/close`);
  });

  test('előkészített szavazás törölhető, nyitott/lezárt nem; ismeretlen osztály elutasítva', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    let r = await admin.post('/api/admin/elections', {
      name: 'Törlendő', candidates: [{ id: '11.A', label: 'A' }, { id: '11.B', label: 'B' }], allowedClasses: ['13.X'],
    });
    assert.equal(r.status, 400);
    r = await admin.post('/api/admin/elections', { name: 'Törlendő', candidates: [{ id: '11.A', label: 'A' }, { id: '11.B', label: 'B' }] });
    assert.equal((await admin.del(`/api/admin/elections/${r.data.id}`)).status, 200);
    const closed = (await admin.get('/api/admin/overview')).data.elections.find((e) => e.status === 'closed');
    assert.equal((await admin.del(`/api/admin/elections/${closed.id}`)).status, 409);
  });

  test('jegyzőkönyv JSON lenyomata egyezik; közzététel után a kivetítőn megjelenik', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    const closed = (await admin.get('/api/admin/overview')).data.elections.find((e) => e.status === 'closed');
    const raw = await admin.get(`/api/admin/elections/${closed.id}/protocol.json`);
    const hash = require('crypto').createHash('sha256').update(raw.text).digest('hex');
    assert.equal(hash, closed.resultHash);

    let k = await (await fetch(env.base + '/api/kiosk/code?key=kulcs')).json();
    assert.equal(k.results, undefined, 'közzététel előtt nincs eredmény a kivetítőn');
    await admin.post(`/api/admin/elections/${closed.id}/publish`, { published: true });
    k = await (await fetch(env.base + '/api/kiosk/code?key=kulcs')).json();
    assert.ok(Array.isArray(k.results.results));
  });

  test('ügyelet: keresés, jelenlét javítása az aktív szavazásban', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    assert.equal((await admin.put('/api/admin/attendance', { email: 'diak5@edig.hu', present: true })).status, 409, 'nincs aktív szavazás');
    const d = await admin.post('/api/admin/elections', { name: 'Ügyelet', candidates: [{ id: '11.A', label: 'A' }, { id: '11.B', label: 'B' }] });
    let r = await admin.get('/api/admin/voters/search?q=diak5');
    assert.equal(r.data.voters.length, 1);
    assert.equal(r.data.voters[0].present, null);
    assert.equal((await admin.put('/api/admin/attendance', { email: 'diak5@edig.hu', present: true })).status, 200);
    r = await admin.get('/api/admin/voters/search?q=diak5');
    assert.equal(r.data.voters[0].present, true);
    assert.equal((await admin.get('/api/admin/voters/search?q=%25')).data.voters.length, 0, 'LIKE-joker escape-elve');
    assert.equal((await admin.del(`/api/admin/elections/${d.data.id}`)).status, 200);
  });

  test('0 jogosulttal nem nyitható; személyes adatok törlése, jegyzőkönyv marad', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    assert.equal((await admin.post('/api/admin/purge', { confirm: 'igen' })).status, 400);
    const r = await admin.post('/api/admin/purge', { confirm: 'TÖRLÉS' });
    assert.equal(r.status, 200);
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM voters').get().n, 0);
    assert.equal(env.db.prepare('SELECT COUNT(*) n FROM voted').get().n, 0);
    assert.ok(env.db.prepare("SELECT COUNT(*) n FROM elections WHERE protocol IS NOT NULL").get().n >= 1);
    assert.equal((await admin.get('/api/admin/overview')).status, 200, 'az admin bejelentkezve marad');

    const e = await admin.post('/api/admin/elections', { name: 'Üres', candidates: [{ id: '11.A', label: 'A' }, { id: '11.B', label: 'B' }] });
    assert.equal((await admin.post(`/api/admin/elections/${e.data.id}/open`)).status, 409);
  });

  test('healthz', async () => {
    const r = await (await fetch(env.base + '/healthz')).json();
    assert.equal(r.ok, true);
  });
});
