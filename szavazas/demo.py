"""Demó indítása egy paranccsal (Windows-on is):  python -m szavazas.demo

Friss demó adatbázist készít (data/demo.db), majd fejlesztői módban elindítja a szervert.
Demó adatok a DÖK szabálya szerint:
 - 9 osztály × 5 diák, névvel; minden osztálynak osztályfőnöke (ofo.9a@edig.hu, …)
 - TANÁR csoport: a szavazó tanárok (a 11. évfolyam osztályfőnökei NEM), felelőse az igazgatóhelyettes
 - előkészített szavazás: a versengő 11. évfolyam kivételével mindenki, jelenlét-ellenőrzéssel
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import db as database
from .nevjegyzek import group_kind

LAST = ["Kovács", "Nagy", "Szabó", "Tóth", "Horváth", "Varga", "Kiss", "Molnár", "Németh", "Farkas", "Balogh", "Papp", "Takács", "Juhász", "Lakatos"]
FIRST = ["Anna", "Bence", "Csenge", "Dávid", "Eszter", "Gergő", "Hanna", "Levente", "Luca", "Máté", "Nóra", "Olivér", "Petra", "Zalán", "Zsófi"]
CLASSES = ["11.A", "11.B", "11.C", "9.A", "9.B", "10.A", "10.B", "12.A", "12.B"]


def fake_name(i):
    """225 különböző név; i = 1..60 között mind egyedi."""
    return f"{LAST[i % 15]} {FIRST[(4 * i + i // 15) % 15]}"


def ofo(cls):
    return f"ofo.{cls.replace('.', '').lower()}@edig.hu"


def seed(db_path):
    for suffix in ("", "-wal", "-shm"):
        Path(db_path + suffix).unlink(missing_ok=True)
    database.init_db(db_path)
    c = database.connect(db_path)
    lines = ["email;csoport;nev"]

    with database.transaction(c):
        n = 1
        for cls in CLASSES:
            c.execute("INSERT INTO groups (name, kind) VALUES (?, ?)", (cls, group_kind(cls)))
            c.execute("INSERT INTO group_leaders (group_name, email) VALUES (?, ?)", (cls, ofo(cls)))
            for _ in range(5):
                email, name = f"diak{n}@edig.hu", fake_name(n)
                c.execute("INSERT INTO voters (email, class, name) VALUES (?, ?, ?)", (email, cls, name))
                lines.append(f"{email};{cls};{name}")
                n += 1

        # Tanárok: a nem 11.-es osztályfőnökök + 5 szaktanár. A 11. évfolyam osztályfőnökei nem szavaznak.
        c.execute("INSERT INTO groups (name, kind) VALUES ('TANÁR', 'csoport')")
        c.execute("INSERT INTO group_leaders (group_name, email) VALUES ('TANÁR', 'igazgatohelyettes@edig.hu')")
        teachers = [(ofo(cls), f"{cls} osztályfőnöke") for cls in CLASSES if not cls.startswith("11.")]
        teachers += [(f"tanar{i}@edig.hu", f"{fake_name(45 + i)} (tanár)") for i in range(1, 6)]
        for email, name in teachers:
            c.execute("INSERT INTO voters (email, class, name) VALUES (?, 'TANÁR', ?)", (email, name))
            lines.append(f"{email};TANÁR;{name}")

        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        voting = [cls for cls in CLASSES if not cls.startswith("11.")] + ["TANÁR"]
        eid = c.execute(
            "INSERT INTO elections (name, is_trial, allowed_classes, require_attendance, created_at) VALUES (?, 1, ?, 1, ?)",
            ("Diáknap – próbaszavazás", json.dumps(voting, ensure_ascii=False, separators=(",", ":")), now),
        ).lastrowid
        for i, (cid, label) in enumerate([("11.A", "11.A – Vadnyugat"), ("11.B", "11.B – Űrutazás"), ("11.C", "11.C – Retro 80s")]):
            c.execute("INSERT INTO candidates (election_id, id, label, position) VALUES (?, ?, ?, ?)", (eid, cid, label, i))
            c.execute("INSERT INTO tally (election_id, candidate_id, count) VALUES (?, ?, 0)", (eid, cid))
        c.execute(
            "INSERT INTO audit_log (at, actor, action, details) VALUES (?, 'demo-seed', 'election_created', '{\"demo\":true}')",
            (now,),
        )
    c.close()
    (Path(db_path).parent / "demo-szavazok.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"""Demó adatbázis kész: {db_path}
  Osztályok: 9.A–12.B, 5-5 diák (diak1–15 = 11.A–C, diak16–20 = 9.A, diak21–25 = 9.B, …)
  Osztályfőnökök: ofo.9a@edig.hu, ofo.9b@edig.hu, … (tanári felület: /tanar)
  Tanári csoport: felelőse igazgatohelyettes@edig.hu; tagjai a nem 11.-es osztályfőnökök és tanar1–5@edig.hu
  Előkészített szavazás: a versengő 11. évfolyam kivételével mindenki, jelenlét-ellenőrzéssel
  Admin: admin@edig.hu   Kivetítő-kulcs: demo""")


def main():
    db_path = "./data/demo.db"
    seed(db_path)
    os.environ.update(
        DEV_LOGIN="1", COOKIE_SECURE="0", DB_PATH=db_path, ADMIN_EMAILS="admin@edig.hu", KIOSK_KEY="demo"
    )
    from .__main__ import main as run_server

    run_server()


if __name__ == "__main__":
    main()
