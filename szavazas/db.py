"""Adatbázis (SQLite, a Python beépített sqlite3 modulja).

Adatmodell – a lényeg:
 * `voted` : KI szavazott (email) – de NEM azt, hogy mire, és NEM azt, hogy mikor.
 * `tally` : MIRE szavaztak – csak számlálók jelöltenként, se email, se idő, se sorrend.
A kettőt egyetlen tranzakció írja (lásd app.py, cast_vote), így nem lehet dupla vagy elveszett
szavazat, és utólag sem párosítható össze, ki mire szavazott.
A `voted` tábla WITHOUT ROWID: nincs belső sorszám, ami a szavazás sorrendjét elárulná.
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .nevjegyzek import group_kind

SCHEMA = """
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

-- v0.3: csoportok/osztályok, felelősök (osztályfőnökök), szavazásonkénti jelenlét
CREATE TABLE IF NOT EXISTS groups (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'osztaly' CHECK (kind IN ('osztaly','csoport'))
) WITHOUT ROWID;

-- Ki kezelheti a csoport jelenlétét (osztályfőnök, vagy a tanári csoportnál pl. igazgatóhelyettes).
CREATE TABLE IF NOT EXISTS group_leaders (
  group_name TEXT NOT NULL REFERENCES groups(name) ON DELETE CASCADE ON UPDATE CASCADE,
  email      TEXT NOT NULL,
  PRIMARY KEY (group_name, email)
) WITHOUT ROWID;

-- Jelenlét szavazásonként: 1 = jelen, 0 = hiányzik, nincs sor = még nincs rögzítve.
-- Csak azt tartalmazza, ki volt jelen – szavazatról semmit.
CREATE TABLE IF NOT EXISTS attendance (
  election_id INTEGER NOT NULL REFERENCES elections(id),
  email       TEXT NOT NULL,
  present     INTEGER NOT NULL CHECK (present IN (0,1)),
  marked_by   TEXT NOT NULL,
  PRIMARY KEY (election_id, email)
) WITHOUT ROWID;
"""


def _columns(conn, table):
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]


def _migrate(conn):
    """Régebbi adatbázisok kiegészítése (a v0.1–v0.2 adatbázisok is használhatók maradnak)."""
    if "name" not in _columns(conn, "voters"):
        conn.execute("ALTER TABLE voters ADD COLUMN name TEXT NOT NULL DEFAULT ''")
    # Régi adatbázis: a meglévő osztályokból csoport lesz.
    for r in conn.execute("SELECT DISTINCT class FROM voters").fetchall():
        conn.execute("INSERT OR IGNORE INTO groups (name, kind) VALUES (?, ?)", (r["class"], group_kind(r["class"])))
    cols = _columns(conn, "elections")
    # 1 = csak az szavazhat, akit a csoport felelőse (osztályfőnök) jelennek jelölt
    if "require_attendance" not in cols:
        conn.execute("ALTER TABLE elections ADD COLUMN require_attendance INTEGER NOT NULL DEFAULT 0")
    # 1 = a diák nem szavazhat a saját osztályára (ha az osztálya jelölt)
    if "no_self_vote" not in cols:
        conn.execute("ALTER TABLE elections ADD COLUMN no_self_vote INTEGER NOT NULL DEFAULT 0")
    # 1 = az eredmény lezárás után a kivetítőn is megjelenhet
    if "published" not in cols:
        conn.execute("ALTER TABLE elections ADD COLUMN published INTEGER NOT NULL DEFAULT 0")


def connect(db_path):
    """Új kapcsolat. A webszerver minden kéréshez sajátot nyit (szálanként egyet)."""
    conn = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # Ha egy másik kérés éppen ír, legfeljebb 5 mp-ig vár, nem dob azonnal hibát.
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(db_path):
    """Létrehozza (ha kell) az adatbázist és a táblákat. Indításkor egyszer fut."""
    Path(db_path).resolve().parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    # WAL: olvasás közben is lehet írni; a beállítás a fájlban megmarad.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    with transaction(conn):
        _migrate(conn)
    conn.close()


@contextmanager
def transaction(conn):
    """Egyetlen tranzakció: vagy minden lépés megtörténik, vagy egyik sem.

    BEGIN IMMEDIATE: már az elején írási zárat kér, így két szavazás nem keveredhet.
    Hiba esetén minden visszagörgetődik.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
