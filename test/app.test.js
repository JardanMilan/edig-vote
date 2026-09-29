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
  let cookie = '';
  async function req(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b = {}) => req('PUT', p, b),
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

async function prepareElection(base, { allowedClasses = [], open = true } = {}) {
  const admin = client(base);
  await admin.login('admin@edig.hu');
  let r = await admin.put('/api/admin/voters', { csv: VOTERS });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.post('/api/admin/elections', {
    name: 'Teszt',
    isTrial: true,
    candidates: [{ id: '11.A', label: '11.A' }, { id: '11.B', label: '11.B' }],
    allowedClasses,
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
    assert.deepEqual(voters, [{ email: 'a@edig.hu', class: '11.A' }]);
    assert.equal(errors.length, 3);
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

  test('hiányzó nem szavazhat', async () => {
    const admin = client(env.base);
    await admin.login('admin@edig.hu');
    const r = await admin.put('/api/admin/absent', { emails: 'diak2@edig.hu, nincs@edig.hu' });
    assert.deepEqual([r.data.matched, r.data.unknown], [1, 1]);
    assert.equal(await reason('diak2@edig.hu'), 'absent');
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
