'use strict';

// Demó adatok a kipróbáláshoz: 45 teszt diák 9 osztályban + egy előkészített próbakör.
// Használat: npm run demo   (a data/demo.db-t hozza létre újra)

const fs = require('fs');
const path = require('path');
const { openDb } = require('../src/db');

const dbPath = process.argv[2] || './data/demo.db';
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) fs.rmSync(f, { force: true });
const db = openDb(dbPath);

const classes = ['11.A', '11.B', '11.C', '9.A', '9.B', '10.A', '10.B', '12.A', '12.B'];
const lines = ['email;osztaly'];
const ins = db.prepare('INSERT INTO voters (email, class) VALUES (?, ?)');
let n = 1;
for (const cls of classes) {
  for (let i = 0; i < 5; i++) {
    const email = `diak${n++}@edig.hu`;
    ins.run(email, cls);
    lines.push(`${email};${cls}`);
  }
}
fs.writeFileSync(path.join(path.dirname(dbPath), 'demo-szavazok.csv'), lines.join('\n') + '\n');

const now = new Date().toISOString();
const eid = db
  .prepare('INSERT INTO elections (name, is_trial, allowed_classes, created_at) VALUES (?, 1, ?, ?)')
  .run('Diáknap 2026 – próbakör', JSON.stringify(['11.A', '9.B']), now).lastInsertRowid;
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
  45 diák: diak1–5 = 11.A, diak6–10 = 11.B, diak11–15 = 11.C, diak16–20 = 9.A, diak21–25 = 9.B, …
  Előkészített próbakör: csak a 11.A és a 9.B szavazhat.
  Admin: admin@edig.hu   Kivetítő-kulcs: demo`);
