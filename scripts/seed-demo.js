'use strict';

// Demó adatok a kipróbáláshoz, a DÖK szabálya szerint:
//  - 9 osztály × 5 diák, névvel; minden osztálynak osztályfőnöke (ofo.9a@edig.hu, …)
//  - TANÁR csoport: a szavazó tanárok (a 11. évfolyam osztályfőnökei NEM), felelőse az igazgatóhelyettes
//  - előkészített szavazás: a versengő 11. évfolyam kivételével mindenki, jelenlét-ellenőrzéssel
// Használat: npm run demo   (a data/demo.db-t hozza létre újra)

const fs = require('fs');
const path = require('path');
const { openDb } = require('../src/db');
const { groupKind } = require('../src/csv');

const dbPath = process.argv[2] || './data/demo.db';
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) fs.rmSync(f, { force: true });
const db = openDb(dbPath);

const LAST = ['Kovács', 'Nagy', 'Szabó', 'Tóth', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Takács', 'Juhász', 'Lakatos'];
const FIRST = ['Anna', 'Bence', 'Csenge', 'Dávid', 'Eszter', 'Gergő', 'Hanna', 'Levente', 'Luca', 'Máté', 'Nóra', 'Olivér', 'Petra', 'Zalán', 'Zsófi'];
// 225 különböző név; i = 1..60 között mind egyedi.
const fakeName = (i) => `${LAST[i % 15]} ${FIRST[(4 * i + Math.floor(i / 15)) % 15]}`;

const classes = ['11.A', '11.B', '11.C', '9.A', '9.B', '10.A', '10.B', '12.A', '12.B'];
const lines = ['email;csoport;nev'];
const insVoter = db.prepare('INSERT INTO voters (email, class, name) VALUES (?, ?, ?)');
const insGroup = db.prepare('INSERT INTO groups (name, kind) VALUES (?, ?)');
const insLeader = db.prepare('INSERT INTO group_leaders (group_name, email) VALUES (?, ?)');
const ofo = (cls) => `ofo.${cls.replace('.', '').toLowerCase()}@edig.hu`;

let n = 1;
for (const cls of classes) {
  insGroup.run(cls, groupKind(cls));
  insLeader.run(cls, ofo(cls));
  for (let i = 0; i < 5; i++) {
    const email = `diak${n}@edig.hu`;
    const name = fakeName(n);
    insVoter.run(email, cls, name);
    lines.push(`${email};${cls};${name}`);
    n++;
  }
}

// Tanárok: a nem 11.-es osztályfőnökök + 5 szaktanár. A 11. évfolyam osztályfőnökei nem szavaznak.
insGroup.run('TANÁR', 'csoport');
insLeader.run('TANÁR', 'igazgatohelyettes@edig.hu');
const teachers = classes.filter((c) => !c.startsWith('11.')).map((c) => [ofo(c), `${c} osztályfőnöke`]);
for (let i = 1; i <= 5; i++) teachers.push([`tanar${i}@edig.hu`, `${fakeName(45 + i)} (tanár)`]);
for (const [email, name] of teachers) {
  insVoter.run(email, 'TANÁR', name);
  lines.push(`${email};TANÁR;${name}`);
}
fs.writeFileSync(path.join(path.dirname(dbPath), 'demo-szavazok.csv'), lines.join('\n') + '\n');

const now = new Date().toISOString();
const voting = classes.filter((c) => !c.startsWith('11.')).concat('TANÁR');
const eid = db
  .prepare(
    'INSERT INTO elections (name, is_trial, allowed_classes, require_attendance, created_at) VALUES (?, 1, ?, 1, ?)'
  )
  .run('Diáknap – próbaszavazás', JSON.stringify(voting), now).lastInsertRowid;
[
  ['11.A', '11.A – Vadnyugat'],
  ['11.B', '11.B – Űrutazás'],
  ['11.C', '11.C – Retro 80s'],
].forEach(([id, label], i) => {
  db.prepare('INSERT INTO candidates (election_id, id, label, position) VALUES (?, ?, ?, ?)').run(eid, id, label, i);
  db.prepare('INSERT INTO tally (election_id, candidate_id, count) VALUES (?, ?, 0)').run(eid, id);
});
db.prepare('INSERT INTO audit_log (at, actor, action, details) VALUES (?, ?, ?, ?)').run(now, 'demo-seed', 'election_created', '{"demo":true}');
db.close();

console.log(`Demó adatbázis kész: ${dbPath}
  Osztályok: 9.A–12.B, 5-5 diák (diak1–15 = 11.A–C, diak16–20 = 9.A, diak21–25 = 9.B, …)
  Osztályfőnökök: ofo.9a@edig.hu, ofo.9b@edig.hu, … (tanári felület: /tanar)
  Tanári csoport: felelőse igazgatohelyettes@edig.hu; tagjai a nem 11.-es osztályfőnökök és tanar1–5@edig.hu
  Előkészített szavazás: a versengő 11. évfolyam kivételével mindenki, jelenlét-ellenőrzéssel
  Admin: admin@edig.hu   Kivetítő-kulcs: demo`);
