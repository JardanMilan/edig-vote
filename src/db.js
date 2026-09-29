'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Adatmodell – a lényeg:
//  * `voted`  : KI szavazott (email) – de NEM azt, hogy mire, és NEM azt, hogy mikor.
//  * `tally`  : MIRE szavaztak – csak számlálók osztályonként, se email, se idő, se sorrend.
// A kettőt egyetlen tranzakció írja (lásd castVote), így nem lehet dupla vagy elveszett szavazat,
// és utólag sem párosítható össze, ki mire szavazott.
// A `voted` tábla WITHOUT ROWID: nincs belső sorszám, ami a szavazás sorrendjét elárulná.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS voters (
  email   TEXT PRIMARY KEY,
  class   TEXT NOT NULL,
  absent  INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS elections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  is_trial        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  allowed_classes TEXT,               -- JSON tömb; NULL = minden osztály szavazhat
  created_at      TEXT NOT NULL,
  opened_at       TEXT,
  closed_at       TEXT,
  protocol        TEXT,               -- lezáráskor rögzített jegyzőkönyv (JSON)
  result_hash     TEXT                -- a jegyzőkönyv SHA-256 lenyomata
);

CREATE TABLE IF NOT EXISTS candidates (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  id          TEXT NOT NULL,
  label       TEXT NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (election_id, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tally (
  election_id  INTEGER NOT NULL,
  candidate_id TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, candidate_id),
  FOREIGN KEY (election_id, candidate_id) REFERENCES candidates(election_id, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS voted (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  email       TEXT NOT NULL,
  PRIMARY KEY (election_id, email)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  present_until INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Csak admin műveletek naplója. Szavazatról SOHA nem kerül ide semmi.
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  details TEXT
);
`;

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
