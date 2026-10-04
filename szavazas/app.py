"""A szavazó szerver: minden végpont (API) és a statikus oldalak kiszolgálása.

Felépítés:
  * segédfüggvények (IP-szűrés, hibakezelés, adatbázis-lekérdezések)
  * munkamenet (bejelentkezés sütivel)
  * diák végpontok: bejelentkezés, jelenléti kód, szavazás
  * kivetítő (kiosk)
  * admin végpontok (/api/admin/...)
  * osztályfőnöki végpontok (/api/teacher/...)
  * statikus oldalak (public/ mappa) és hibakezelés

Szándékosan NINCS kérés-naplózás a törzzsel: a szavazat tartalma sehol nem kerülhet logba.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import segno
from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from . import db as database
from .auth import LoginError
from .jelenlet import current_code, verify_code
from .nevjegyzek import group_kind, normalize_class, parse_email_list, parse_voters

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
MAX_CODE_FAILS = 5
CODE_LOCK_MS = 5 * 60 * 1000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+$")

log = logging.getLogger("szavazas")


# ---------- segédfüggvények ----------


def sha256(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def now_ms():
    return int(time.time() * 1000)


def now_iso():
    """Pl. 2026-10-04T18:30:00.000Z – ugyanaz a formátum, mint a korábbi (Node) verzióban."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def to_json(obj):
    """Tömör JSON (szóközök nélkül, ékezetekkel) – a jegyzőkönyv lenyomata ebből készül."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def ip_allowed(ip, allowed):
    """Üres lista = bárhonnan lehet. Egyébként pontos cím (1.2.3.4) vagy tartomány (1.2.3.0/24)."""
    if not allowed:
        return True
    clean = re.sub(r"^::ffff:", "", str(ip or ""))
    try:
        addr = ipaddress.ip_address(clean)
    except ValueError:
        return False
    for rule in allowed:
        try:
            if addr in ipaddress.ip_network(rule, strict=False):
                return True
        except ValueError:
            continue
    return False


class HttpError(Exception):
    """Hiba, ami a felhasználónak szól: státuszkód + magyar üzenet + gépi kód a felületnek."""

    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def body():
    """A kérés JSON törzse (ha nem objektum, üres szótár)."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


# ---------- alkalmazás ----------


def create_app(cfg, verify_google):
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    if cfg["trust_proxy"]:
        # Caddy mögött: a valódi IP és protokoll a proxy fejléceiből jön.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    database.init_db(cfg["db_path"])

    # Hibás kódbeírások számlálója: email -> {"fails", "locked_until"}
    code_fails = {}
    code_fails_lock = threading.Lock()

    # ---------- adatbázis ----------

    def conn():
        if "db" not in g:
            g.db = database.connect(cfg["db_path"])
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        c = g.pop("db", None)
        if c is not None:
            c.close()

    def one(sql, *args):
        row = conn().execute(sql, args).fetchone()
        return dict(row) if row else None

    def rows(sql, *args):
        return [dict(r) for r in conn().execute(sql, args).fetchall()]

    def count(sql, *args):
        return conn().execute(sql, args).fetchone()[0]

    def audit(actor, action, details=None):
        conn().execute(
            "INSERT INTO audit_log (at, actor, action, details) VALUES (?, ?, ?, ?)",
            (now_iso(), actor, action, to_json(details) if details is not None else None),
        )

    def get_voter(email):
        return one("SELECT email, class, name FROM voters WHERE email = ?", email)

    def get_group(name):
        return one("SELECT name, kind FROM groups WHERE name = ?", name)

    def get_election(eid):
        return one("SELECT * FROM elections WHERE id = ?", eid)

    def open_election():
        return one("SELECT * FROM elections WHERE status = 'open' LIMIT 1")

    def candidates(eid):
        return rows("SELECT id, label FROM candidates WHERE election_id = ? ORDER BY position", eid)

    def members(group):
        return rows("SELECT email, name FROM voters WHERE class = ? ORDER BY name, email", group)

    def member_count(group):
        return count("SELECT COUNT(*) FROM voters WHERE class = ?", group)

    def has_voted(eid, email):
        return one("SELECT 1 AS x FROM voted WHERE election_id = ? AND email = ?", eid, email) is not None

    def attendance(eid, email):
        return one("SELECT present FROM attendance WHERE election_id = ? AND email = ?", eid, email)

    def set_attendance(eid, email, present, marked_by):
        conn().execute(
            """INSERT INTO attendance (election_id, email, present, marked_by) VALUES (?, ?, ?, ?)
               ON CONFLICT (election_id, email) DO UPDATE SET present = excluded.present, marked_by = excluded.marked_by""",
            (eid, email, 1 if present else 0, marked_by),
        )

    def present_count(eid, group):
        return count(
            """SELECT COUNT(*) FROM attendance a JOIN voters v ON v.email = a.email
               WHERE a.election_id = ? AND a.present = 1 AND v.class = ?""",
            eid,
            group,
        )

    def voted_count(eid):
        return count("SELECT COUNT(*) FROM voted WHERE election_id = ?", eid)

    def class_counts():
        return rows("SELECT class, COUNT(*) AS total FROM voters GROUP BY class ORDER BY class")

    def allowed_classes(election):
        return json.loads(election["allowed_classes"]) if election["allowed_classes"] else None

    def group_allowed(election, group_name):
        classes = allowed_classes(election)
        return classes is None or group_name in classes

    def member_total(election):
        """A szavazáson részt vevő csoportok tagjainak száma."""
        return sum(r["total"] for r in class_counts() if group_allowed(election, r["class"]))

    def eligible_count(election):
        """Jogosultak: jelenlét-ellenőrzésnél csak a jelennek jelöltek, egyébként minden tag."""
        if not election["require_attendance"]:
            return member_total(election)
        return sum(
            present_count(election["id"], r["class"]) for r in class_counts() if group_allowed(election, r["class"])
        )

    def active_election():
        """A tanári felület melyik szavazásra rögzít jelenlétet: a nyitottra, ha nincs, a legutóbb előkészítettre."""
        return open_election() or one("SELECT * FROM elections WHERE status = 'draft' ORDER BY id DESC LIMIT 1")

    def is_admin(email):
        return email in cfg["admin_emails"]

    def leader_groups(email):
        return [r["group_name"] for r in rows("SELECT group_name FROM group_leaders WHERE email = ? ORDER BY group_name", email)]

    def eligibility(email):
        """Jogosultság eldöntése egy helyen – a /api/me és a szavazás is ezt használja."""
        election = open_election()
        voter = get_voter(email)

        def result(reason):
            return {"ok": reason is None, "reason": reason, "election": election, "voter": voter}

        if not election:
            return result("no_open_election")
        if not voter:
            return result("not_on_list")
        if not group_allowed(election, voter["class"]):
            return result("class_not_in_round")
        if has_voted(election["id"], email):
            return result("already_voted")
        if election["require_attendance"]:
            a = attendance(election["id"], email)
            if not a:
                return result("not_marked")
            if not a["present"]:
                return result("absent")
        return result(None)

    # ---------- sütik ----------
    # A beállítandó sütiket összegyűjtjük, és a válaszhoz a végén adjuk hozzá (hibaválaszhoz is).

    def set_cookie(name, value, max_age, path="/"):
        g.setdefault("cookies", []).append((name, value, max_age, path))

    def read_cookie(name):
        return request.cookies.get(name)

    # ---------- munkamenet ----------

    def start_session(email):
        token = b64url(secrets.token_bytes(32))
        conn().execute("DELETE FROM sessions WHERE expires_at <= ?", (now_ms(),))
        # Az adatbázisban csak a token lenyomata van: ha kiszivárogna, abból sem lehet belépni.
        conn().execute(
            "INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)",
            (sha256(token), email, now_ms() + cfg["session_ttl_sec"] * 1000),
        )
        set_cookie("sid", token, cfg["session_ttl_sec"])

    def end_session():
        conn().execute("DELETE FROM sessions WHERE token = ?", (g.session["token_hash"],))
        set_cookie("sid", "", 0)

    def require_login():
        if not g.session:
            raise HttpError(401, "Nem vagy bejelentkezve.", "not_logged_in")
        return g.session["email"]

    def require_admin():
        if not g.session or not is_admin(g.session["email"]):
            raise HttpError(403, "Nincs admin jogosultságod.")
        return g.session["email"]

    def require_leader():
        """Osztályfőnök / csoportfelelős: legalább egy csoport felelőse. Visszaadja a csoportjait."""
        email = require_login()
        groups = leader_groups(email)
        if not groups:
            raise HttpError(403, "Egyetlen osztálynak vagy csoportnak sem vagy a felelőse.", "not_leader")
        return groups

    def require_school_network():
        if not ip_allowed(request.remote_addr, cfg["allowed_ips"]):
            raise HttpError(403, "Szavazni csak az iskola hálózatáról lehet.", "wrong_network")

    @app.before_request
    def before():
        g.session = None
        # CSRF-védelem: minden módosító kérésnek JSON-nak kell lennie (+ SameSite=Strict süti).
        if request.path.startswith("/api") and request.method != "GET":
            if not re.match(r"^application/json\b", request.headers.get("Content-Type", ""), re.I):
                return jsonify(error="JSON kérés szükséges."), 415
        token = read_cookie("sid")
        if token:
            s = one("SELECT * FROM sessions WHERE token = ? AND expires_at > ?", sha256(token), now_ms())
            if s:
                g.session = {**s, "token_hash": sha256(token)}
        return None

    @app.after_request
    def after(res):
        res.headers["Content-Security-Policy"] = "; ".join(
            [
                "default-src 'self'",
                "script-src 'self' https://accounts.google.com/gsi/client",
                "frame-src https://accounts.google.com/gsi/",
                "connect-src 'self' https://accounts.google.com/gsi/",
                "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
                "img-src 'self' data: https://*.googleusercontent.com",
            ]
        )
        res.headers["X-Content-Type-Options"] = "nosniff"
        res.headers["Referrer-Policy"] = "no-referrer"
        res.headers["Cache-Control"] = "no-store"
        res.headers["X-Frame-Options"] = "DENY"
        if cfg["cookie_secure"]:
            res.headers["Strict-Transport-Security"] = "max-age=31536000"
        for name, value, max_age, path in g.get("cookies", []):
            res.set_cookie(
                name, value, max_age=max_age, path=path, httponly=True, samesite="Strict", secure=cfg["cookie_secure"]
            )
        return res

    # ---------- nyilvános végpontok ----------

    @app.get("/api/config")
    def api_config():
        return {"googleClientId": cfg["google_client_id"], "devLogin": cfg["dev_login"], "domain": cfg["allowed_domain"]}

    @app.post("/api/login/google")
    def login_google():
        try:
            email = verify_google(str(body().get("credential") or ""))
        except LoginError as e:
            raise HttpError(401, str(e)) from e
        except Exception as e:  # pl. a Google nem érhető el
            log.warning("Google-ellenőrzés sikertelen: %s", type(e).__name__)
            raise HttpError(401, "Sikertelen bejelentkezés.") from e
        start_session(email)
        return {"ok": True}

    if cfg["dev_login"]:

        @app.post("/api/login/dev")
        def login_dev():
            email = str(body().get("email") or "").strip().lower()
            if not email.endswith("@" + cfg["allowed_domain"]) and not is_admin(email):
                raise HttpError(401, f"Csak @{cfg['allowed_domain']} cím.")
            start_session(email)
            return {"ok": True}

    @app.post("/api/logout")
    def logout():
        if g.session:
            conn().execute("DELETE FROM sessions WHERE token = ?", (g.session["token_hash"],))
        set_cookie("sid", "", 0)
        return {"ok": True}

    @app.get("/api/me")
    def me():
        email = require_login()
        el = eligibility(email)
        e, v = el["election"], el["voter"]
        return {
            "email": email,
            "isAdmin": is_admin(email),
            "isLeader": len(leader_groups(email)) > 0,
            "name": v["name"] if v else None,
            "class": v["class"] if v else None,
            "canVote": el["ok"],
            "reason": el["reason"],
            "present": g.session["present_until"] > now_ms(),
            "hasScan": read_scan() is not None,
            "election": {
                "id": e["id"],
                "name": e["name"],
                "isTrial": bool(e["is_trial"]),
                "candidates": candidates(e["id"]),
                # Ha a saját osztályra nem lehet szavazni, ezt a jelöltet a felület letiltja.
                "blockedCandidate": v["class"] if e["no_self_vote"] and v else None,
            }
            if e
            else None,
        }

    # ----- QR-beolvasás megjegyzése -----
    # Aki a kivetített QR-t beolvassa, annak a Google-belépés (fiókválasztás, jelszó) akár percekig tarthat,
    # miközben a kód 30 mp-enként változik. Ezért a beolvasás PILLANATÁT a szerver aláírva, sütiben rögzíti,
    # és belépés után azt ellenőrzi, hogy a kód a beolvasáskor érvényes volt-e.
    # Ez a végpont szándékosan nem árulja el, hogy a kód helyes-e (különben bejelentkezés nélkül lehetne
    # találgatni); az ellenőrzés csak belépés után, a diákonkénti próbálkozás-korláttal történik.

    def scan_sig(payload):
        return b64url(hmac.new(cfg["secret"].encode(), ("scan:" + payload).encode(), hashlib.sha256).digest())

    def read_scan():
        raw = read_cookie("scan")
        if not raw:
            return None
        parts = raw.split(".")
        if len(parts) != 3 or not all(parts):
            return None
        code, t, sig = parts
        if not hmac.compare_digest(scan_sig(f"{code}.{t}"), sig) or not t.isdigit():
            return None
        if now_ms() - int(t) > cfg["scan_ttl_sec"] * 1000:
            return None
        return {"code": code, "t": int(t)}

    @app.post("/api/presence/scan")
    def presence_scan():
        code = re.sub(r"\D", "", str(body().get("code") or ""))
        if len(code) != 6:
            raise HttpError(400, "Érvénytelen kód.", "bad_code")
        payload = f"{code}.{now_ms()}"
        set_cookie("scan", f"{payload}.{scan_sig(payload)}", cfg["scan_ttl_sec"], path="/api")
        return {"ok": True}

    @app.post("/api/presence")
    def presence():
        """Jelenléti kód beírása -> a munkamenet PRESENCE_TTL_SEC ideig "jelen van"."""
        email = require_login()
        require_school_network()
        el = eligibility(email)
        if not el["ok"]:
            raise HttpError(403, "Most nem szavazhatsz.", el["reason"])

        with code_fails_lock:
            f = code_fails.get(email, {"fails": 0, "locked_until": 0})
        if f["locked_until"] > now_ms():
            minutes = -(-(f["locked_until"] - now_ms()) // 60000)  # felfelé kerekítve
            raise HttpError(429, f"Túl sok hibás kód. Próbáld újra {minutes} perc múlva.", "locked")

        # Kód forrása: a most beírt kód, vagy a korábbi QR-beolvasás (a beolvasás idejére ellenőrizve).
        typed_code = body().get("code")
        typed = typed_code is not None and typed_code != ""
        scan = None if typed else read_scan()
        if not typed and not scan:
            raise HttpError(400, "Írd be a kivetítőn látható kódot.", "bad_code")
        eid = el["election"]["id"]
        ok = verify_code(cfg, eid, typed_code) if typed else verify_code(cfg, eid, scan["code"], scan["t"])
        if scan:
            set_cookie("scan", "", 0, path="/api")  # egyszer használható

        if not ok:
            with code_fails_lock:
                f["fails"] += 1
                if f["fails"] >= MAX_CODE_FAILS:
                    f = {"fails": 0, "locked_until": now_ms() + CODE_LOCK_MS}
                code_fails[email] = f
            raise HttpError(400, "Hibás vagy lejárt kód. Nézd meg a kivetítőt!", "bad_code")
        with code_fails_lock:
            code_fails.pop(email, None)
        conn().execute(
            "UPDATE sessions SET present_until = ? WHERE token = ?",
            (now_ms() + cfg["presence_ttl_sec"] * 1000, g.session["token_hash"]),
        )
        return {"ok": True, "presentForSec": cfg["presence_ttl_sec"]}

    def cast_vote(election_id, email, candidate_id):
        """A szavazás: egyetlen tranzakció.

        1) beírjuk a `voted` táblába, hogy ez az email szavazott (PRIMARY KEY -> másodszor elbukik)
        2) növeljük a választott jelölt számlálóját a `tally` táblában
        Ha bármelyik lépés hibázik, egyik sem történik meg.
        """
        c = conn()
        with database.transaction(c):
            e = get_election(election_id)
            if not e or e["status"] != "open":
                raise HttpError(409, "A szavazás már lezárult.", "no_open_election")
            try:
                c.execute("INSERT INTO voted (election_id, email) VALUES (?, ?)", (election_id, email))
            except sqlite3.IntegrityError as err:
                raise HttpError(409, "Már leadtad a szavazatodat.", "already_voted") from err
            r = c.execute(
                "UPDATE tally SET count = count + 1 WHERE election_id = ? AND candidate_id = ?",
                (election_id, candidate_id),
            )
            if r.rowcount != 1:
                raise HttpError(400, "Érvénytelen választás.", "bad_candidate")

    @app.post("/api/vote")
    def vote():
        email = require_login()
        require_school_network()
        el = eligibility(email)
        if not el["ok"]:
            raise HttpError(403, "Most nem szavazhatsz.", el["reason"])
        if not g.session["present_until"] > now_ms():
            raise HttpError(403, "Előbb írd be a kivetítőn látható kódot.", "not_present")
        candidate_id = str(body().get("candidateId") or "")
        if el["election"]["no_self_vote"] and candidate_id == el["voter"]["class"]:
            raise HttpError(400, "A saját osztályodra nem szavazhatsz.", "own_class")
        cast_vote(el["election"]["id"], email, candidate_id)
        # Szavazás után kiléptetjük: közös gépen (gépterem) a következő diák ne az ő munkamenetében folytassa.
        end_session()
        # Szándékosan nem adunk vissza semmit, ami a választást azonosítaná.
        return {"ok": True}

    # ---------- kivetítő (kiosk) ----------

    @app.get("/api/kiosk/code")
    def kiosk_code():
        key = str(request.args.get("key") or "")
        key_ok = bool(cfg["kiosk_key"]) and hmac.compare_digest(key.encode(), cfg["kiosk_key"].encode())
        # Adminként vagy osztályfőnökként belépve kulcs nélkül is megnyitható.
        user_ok = g.session and (is_admin(g.session["email"]) or leader_groups(g.session["email"]))
        if not key_ok and not user_ok:
            raise HttpError(403, "Érvénytelen kivetítő-kulcs.")
        election = open_election()
        if not election:
            # Nincs nyitott szavazás: ha az admin közzétette, a legutóbbi eredményt mutatjuk.
            pub = one(
                "SELECT protocol FROM elections WHERE status = 'closed' AND published = 1 ORDER BY closed_at DESC LIMIT 1"
            )
            if not pub:
                return {"open": False}
            p = json.loads(pub["protocol"])
            keys = ["name", "isTrial", "results", "winners", "ballotCount", "votedCount", "eligibleCount"]
            return {"open": False, "results": {k: p.get(k) for k in keys}}
        c = current_code(cfg, election["id"])
        url = f"{request.host_url}?kod={c['code']}"
        qr_svg = segno.make(url, error="m", micro=False).svg_inline(border=1, omitsize=True)
        return {"open": True, "electionName": election["name"], "isTrial": bool(election["is_trial"]), **c, "qrSvg": qr_svg}

    # ---------- admin ----------

    def groups_summary():
        """Csoportok áttekintése: létszám, felelősök, és az aktív szavazásra rögzített jelenlét."""
        active = active_election()
        return [
            {
                "name": gr["name"],
                "kind": gr["kind"],
                "leaders": [r["email"] for r in rows("SELECT email FROM group_leaders WHERE group_name = ? ORDER BY email", gr["name"])],
                "total": member_count(gr["name"]),
                "present": present_count(active["id"], gr["name"]) if active else None,
            }
            for gr in rows("SELECT name, kind FROM groups ORDER BY name")
        ]

    @app.get("/api/admin/overview")
    def admin_overview():
        me_ = require_admin()
        groups = groups_summary()
        elections = [
            {
                "id": e["id"],
                "name": e["name"],
                "isTrial": bool(e["is_trial"]),
                "status": e["status"],
                "allowedClasses": allowed_classes(e),
                "createdAt": e["created_at"],
                "openedAt": e["opened_at"],
                "closedAt": e["closed_at"],
                "candidates": candidates(e["id"]),
                "noSelfVote": bool(e["no_self_vote"]),
                "requireAttendance": bool(e["require_attendance"]),
                "memberTotal": member_total(e),
                "published": bool(e["published"]),
                # Élő részvétel: CSAK a létszám, az eredmény lezárásig nem látható.
                "votedCount": voted_count(e["id"]),
                "eligibleCount": json.loads(e["protocol"])["eligibleCount"] if e["status"] == "closed" else eligible_count(e),
                "resultHash": e["result_hash"],
            }
            for e in rows("SELECT * FROM elections ORDER BY id DESC")
        ]
        classes = [{"class": gr["name"], "total": gr["total"]} for gr in groups]  # régi felület kompatibilitás
        return {"me": me_, "classes": classes, "groups": groups, "elections": elections}

    def check_roster_unlocked():
        if open_election():
            raise HttpError(409, "Nyitott szavazás alatt a névjegyzék és a csoportok nem módosíthatók.")

    def upsert_group(name, kind):
        conn().execute(
            "INSERT INTO groups (name, kind) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET kind = excluded.kind",
            (name, kind),
        )

    def upsert_voter(email, group, name):
        # Ha az új sorban nincs név, a régi név megmarad.
        conn().execute(
            """INSERT INTO voters (email, class, name) VALUES (?, ?, ?)
               ON CONFLICT (email) DO UPDATE SET class = excluded.class,
                 name = CASE WHEN excluded.name = '' THEN voters.name ELSE excluded.name END""",
            (email, group, name),
        )

    @app.put("/api/admin/voters")
    def admin_voters():
        """Névjegyzék importálása CSV-ből (email;csoport;név). A hiányzó csoportok létrejönnek.
        mode = 'replace': a teljes névjegyzék cseréje; 'merge': hozzáadás / módosítás."""
        actor = require_admin()
        check_roster_unlocked()
        b = body()
        replace = b.get("mode") != "merge"
        voters, errors = parse_voters(b.get("csv"), cfg["allowed_domain"])
        if errors:
            return jsonify(error="Hibás sorok a névjegyzékben.", details=errors[:50]), 400
        if not voters:
            raise HttpError(400, "Üres névjegyzék.")
        with database.transaction(conn()):
            if replace:
                conn().execute("DELETE FROM voters")
            for v in voters:
                if not get_group(v["class"]):
                    upsert_group(v["class"], group_kind(v["class"]))
                upsert_voter(v["email"], v["class"], v["name"])
        audit(actor, "voters_replaced" if replace else "voters_merged", {"count": len(voters)})
        return {"ok": True, "count": len(voters)}

    # ----- Csoportok / osztályok és felelőseik (osztályfőnökök) -----

    @app.post("/api/admin/groups")
    def admin_group_save():
        actor = require_admin()
        b = body()
        name = normalize_class(b.get("name"))
        if not name or len(name) > 30:
            raise HttpError(400, "Adj meg egy csoportnevet (max. 30 karakter).")
        kind = b["kind"] if b.get("kind") in ("osztaly", "csoport") else group_kind(name)
        raw = b.get("leaders")
        raw_leaders = ",".join(str(x) for x in raw) if isinstance(raw, list) else str(raw or "")
        leaders = parse_email_list(raw_leaders)
        bad = [e for e in leaders if e.split("@")[1] != cfg["allowed_domain"]]
        if bad:
            raise HttpError(400, f"Csak @{cfg['allowed_domain']} cím lehet felelős: {', '.join(bad)}")
        with database.transaction(conn()):
            upsert_group(name, kind)
            conn().execute("DELETE FROM group_leaders WHERE group_name = ?", (name,))
            for e in leaders:
                conn().execute("INSERT INTO group_leaders (group_name, email) VALUES (?, ?)", (name, e))
        audit(actor, "group_saved", {"name": name, "kind": kind, "leaders": leaders})
        return {"ok": True, "name": name}

    @app.delete("/api/admin/groups/<name>")
    def admin_group_delete(name):
        actor = require_admin()
        check_roster_unlocked()
        if not get_group(name):
            raise HttpError(404, "Nincs ilyen csoport.")
        if member_count(name) > 0:
            raise HttpError(409, "Csak üres csoport törölhető.")
        conn().execute("DELETE FROM groups WHERE name = ?", (name,))
        audit(actor, "group_deleted", {"name": name})
        return {"ok": True}

    @app.get("/api/admin/groups/<name>/members")
    def admin_group_members(name):
        require_admin()
        gr = get_group(name)
        if not gr:
            raise HttpError(404, "Nincs ilyen csoport.")
        return {"group": gr["name"], "members": members(gr["name"])}

    @app.post("/api/admin/members")
    def admin_member_save():
        """Egy tag felvétele vagy áthelyezése másik csoportba."""
        actor = require_admin()
        check_roster_unlocked()
        b = body()
        email = str(b.get("email") or "").strip().lower()
        group = normalize_class(b.get("group"))
        name = re.sub(r"\s+", " ", str(b.get("name") or "").strip())[:100]
        if not EMAIL_RE.match(email) or email.split("@")[1] != cfg["allowed_domain"]:
            raise HttpError(400, f"Érvényes @{cfg['allowed_domain']} cím kell.")
        if not get_group(group):
            raise HttpError(404, "Nincs ilyen csoport. Előbb hozd létre.")
        upsert_voter(email, group, name)
        audit(actor, "member_saved", {"email": email, "group": group})
        return {"ok": True}

    @app.delete("/api/admin/members/<email>")
    def admin_member_delete(email):
        actor = require_admin()
        check_roster_unlocked()
        email = email.lower()
        r = conn().execute("DELETE FROM voters WHERE email = ?", (email,))
        if r.rowcount != 1:
            raise HttpError(404, "Nincs ilyen tag.")
        audit(actor, "member_removed", {"email": email})
        return {"ok": True}

    @app.put("/api/admin/attendance")
    def admin_attendance():
        """Ügyelet: az admin bárki jelenlétét javíthatja az aktív szavazásban."""
        actor = require_admin()
        e = active_election()
        if not e:
            raise HttpError(409, "Nincs előkészített vagy nyitott szavazás.")
        b = body()
        email = str(b.get("email") or "").lower()
        present = bool(b.get("present"))
        if not get_voter(email):
            raise HttpError(404, "Nincs ilyen diák a névjegyzékben.")
        if not present and has_voted(e["id"], email):
            raise HttpError(409, "Aki már szavazott, nem jelölhető hiányzónak.")
        set_attendance(e["id"], email, present, actor)
        audit(actor, "attendance_set", {"election": e["id"], "email": email, "present": present})
        return {"ok": True}

    @app.post("/api/admin/elections")
    def admin_election_create():
        actor = require_admin()
        b = body()
        name = str(b.get("name") or "").strip()
        cands = []
        for c in b.get("candidates") if isinstance(b.get("candidates"), list) else []:
            if not isinstance(c, dict):
                continue
            cid = normalize_class(c.get("id"))
            label = str(c.get("label") or c.get("id") or "").strip()
            if cid and label:
                cands.append({"id": cid, "label": label})
        allowed = []
        if isinstance(b.get("allowedClasses"), list):
            for c in map(normalize_class, b["allowedClasses"]):
                if c and c not in allowed:
                    allowed.append(c)
        if not name:
            raise HttpError(400, "Adj nevet a szavazásnak.")
        if len(cands) < 2:
            raise HttpError(400, "Legalább 2 jelölt kell.")
        if len({c["id"] for c in cands}) != len(cands):
            raise HttpError(400, "Ismétlődő jelölt-azonosító.")
        known = {r["name"] for r in rows("SELECT name FROM groups")}
        unknown = [c for c in allowed if c not in known]
        if unknown:
            raise HttpError(400, f"Ilyen osztály/csoport nincs: {', '.join(unknown)}")
        # Alapértelmezés: csak az szavazhat, akit az osztályfőnöke jelennek jelölt.
        require_att = 1 if "requireAttendance" not in b or b["requireAttendance"] else 0
        no_self = 1 if b.get("noSelfVote") else 0
        c = conn()
        with database.transaction(c):
            eid = c.execute(
                """INSERT INTO elections (name, is_trial, allowed_classes, no_self_vote, require_attendance, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (name, 1 if b.get("isTrial") else 0, to_json(allowed) if allowed else None, no_self, require_att, now_iso()),
            ).lastrowid
            for i, cand in enumerate(cands):
                c.execute(
                    "INSERT INTO candidates (election_id, id, label, position) VALUES (?, ?, ?, ?)",
                    (eid, cand["id"], cand["label"], i),
                )
                c.execute("INSERT INTO tally (election_id, candidate_id, count) VALUES (?, ?, 0)", (eid, cand["id"]))
        audit(
            actor,
            "election_created",
            {
                "id": eid,
                "name": name,
                "candidates": cands,
                "allowedClasses": allowed,
                "noSelfVote": bool(no_self),
                "requireAttendance": bool(require_att),
            },
        )
        return {"ok": True, "id": eid}

    def election_or_404(eid):
        e = get_election(eid)
        if not e:
            raise HttpError(404, "Nincs ilyen szavazás.")
        return e

    @app.post("/api/admin/elections/<int:eid>/open")
    def admin_election_open(eid):
        actor = require_admin()
        e = election_or_404(eid)
        if e["status"] != "draft":
            raise HttpError(409, "Csak előkészített szavazás nyitható meg.")
        if open_election():
            raise HttpError(409, "Már van nyitott szavazás.")
        # Jelenlét-ellenőrzésnél a jelenlétet megnyitás után is lehet rögzíteni, ezért itt a létszám számít.
        if member_total(e) == 0:
            raise HttpError(409, "A kijelölt csoportokban nincs egyetlen tag sem (üres névjegyzék).")
        conn().execute("UPDATE elections SET status = 'open', opened_at = ? WHERE id = ?", (now_iso(), eid))
        audit(actor, "election_opened", {"id": eid})
        return {"ok": True}

    @app.post("/api/admin/elections/<int:eid>/close")
    def admin_election_close(eid):
        actor = require_admin()
        e = election_or_404(eid)
        if e["status"] != "open":
            raise HttpError(409, "Csak nyitott szavazás zárható le.")
        c = conn()
        with database.transaction(c):
            closed_at = now_iso()
            c.execute("UPDATE elections SET status = 'closed', closed_at = ? WHERE id = ?", (closed_at, eid))
            results = rows(
                """SELECT c.id, c.label, t.count FROM candidates c
                   JOIN tally t ON t.election_id = c.election_id AND t.candidate_id = c.id
                   WHERE c.election_id = ? ORDER BY t.count DESC, c.position""",
                eid,
            )
            top = results[0]["count"] if results else 0
            p = {
                "electionId": eid,
                "name": e["name"],
                "isTrial": bool(e["is_trial"]),
                "allowedClasses": allowed_classes(e),
                "noSelfVote": bool(e["no_self_vote"]),
                "requireAttendance": bool(e["require_attendance"]),
                "openedAt": e["opened_at"],
                "closedAt": closed_at,
                "memberTotal": member_total(e),
                "eligibleCount": eligible_count(e),
                "votedCount": voted_count(eid),
                "ballotCount": count("SELECT COALESCE(SUM(count), 0) FROM tally WHERE election_id = ?", eid),
                "turnoutByClass": rows(
                    """SELECT v.class, COUNT(*) AS n FROM voted d JOIN voters v ON v.email = d.email
                       WHERE d.election_id = ? GROUP BY v.class ORDER BY v.class""",
                    eid,
                ),
                "results": results,
                "winners": [r["label"] for r in results if r["count"] == top] if top > 0 else [],
            }
            p["consistent"] = p["votedCount"] == p["ballotCount"]
            text = to_json(p)
            c.execute("UPDATE elections SET protocol = ?, result_hash = ? WHERE id = ?", (text, sha256(text), eid))
        audit(actor, "election_closed", {"id": eid, "consistent": p["consistent"]})
        return {"ok": True}

    @app.get("/api/admin/elections/<int:eid>/protocol")
    def admin_protocol(eid):
        require_admin()
        e = election_or_404(eid)
        if e["status"] != "closed":
            raise HttpError(403, "Az eredmény csak lezárás után látható – senkinek, adminnak sem.")
        return {"protocol": json.loads(e["protocol"]), "resultHash": e["result_hash"]}

    @app.get("/api/admin/elections/<int:eid>/protocol.json")
    def admin_protocol_file(eid):
        """A jegyzőkönyv pontosan abban a formában, ahogy a lenyomat készült: ezzel bárki ellenőrizheti
        (python -m szavazas.ellenorzes jegyzokonyv.json), hogy a kinyomtatott lenyomat ehhez a fájlhoz tartozik."""
        require_admin()
        e = election_or_404(eid)
        if e["status"] != "closed":
            raise HttpError(403, "Csak lezárt szavazás jegyzőkönyve tölthető le.")
        return Response(
            e["protocol"].encode("utf-8"),
            content_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="jegyzokonyv-{eid}.json"'},
        )

    @app.post("/api/admin/elections/<int:eid>/publish")
    def admin_publish(eid):
        actor = require_admin()
        e = election_or_404(eid)
        if e["status"] != "closed":
            raise HttpError(409, "Csak lezárt szavazás eredménye tehető közzé.")
        published = 1 if body().get("published") else 0
        conn().execute("UPDATE elections SET published = ? WHERE id = ?", (published, eid))
        audit(actor, "results_published" if published else "results_unpublished", {"id": eid})
        return {"ok": True}

    @app.delete("/api/admin/elections/<int:eid>")
    def admin_election_delete(eid):
        actor = require_admin()
        e = election_or_404(eid)
        if e["status"] != "draft":
            raise HttpError(409, "Csak még meg nem nyitott szavazás törölhető.")
        c = conn()
        with database.transaction(c):
            for table in ("tally", "attendance", "candidates"):
                c.execute(f"DELETE FROM {table} WHERE election_id = ?", (eid,))
            c.execute("DELETE FROM elections WHERE id = ?", (eid,))
        audit(actor, "election_deleted", {"id": eid, "name": e["name"]})
        return {"ok": True}

    @app.get("/api/admin/voters/search")
    def admin_voter_search():
        """Ügyelet a szavazás napján: diák keresése (név vagy email), jelenlét javítása.
        Az admin látja, hogy valaki szavazott-e (mint papíron az aláírt névsor) – de azt nem, hogy mire."""
        require_admin()
        term = str(request.args.get("q") or "").strip().lower()
        if len(term) < 2:
            return {"voters": []}
        open_ = open_election()
        active = active_election()
        like = "%" + re.sub(r"([\\%_])", r"\\\1", term) + "%"
        found = rows(
            """SELECT email, class, name FROM voters
               WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' ORDER BY name, email LIMIT 20""",
            like,
            like,
        )
        out = []
        for v in found:
            a = attendance(active["id"], v["email"]) if active else None
            out.append(
                {
                    "email": v["email"],
                    "class": v["class"],
                    "name": v["name"],
                    "present": bool(a["present"]) if a else None,
                    "voted": has_voted(open_["id"], v["email"]) if open_ else None,
                }
            )
        return {
            "openElection": bool(open_),
            "activeElection": {"id": active["id"], "name": active["name"], "requireAttendance": bool(active["require_attendance"])}
            if active
            else None,
            "voters": out,
        }

    @app.post("/api/admin/purge")
    def admin_purge():
        """Adatvédelem: a szavazás után a személyes adatok (névjegyzék, ki szavazott, munkamenetek) törlése.
        A jegyzőkönyvek (csak számok) megmaradnak."""
        actor = require_admin()
        if body().get("confirm") != "TÖRLÉS":
            raise HttpError(400, "Megerősítéshez írd be: TÖRLÉS")
        if open_election():
            raise HttpError(409, "Nyitott szavazás alatt nem törölhető.")
        c = conn()
        with database.transaction(c):
            counts = {
                "voters": c.execute("DELETE FROM voters").rowcount,
                "voted": c.execute("DELETE FROM voted").rowcount,
                "attendance": c.execute("DELETE FROM attendance").rowcount,
                "sessions": c.execute("DELETE FROM sessions WHERE token != ?", (g.session["token_hash"],)).rowcount,
            }
        audit(actor, "personal_data_purged", counts)
        return {"ok": True, **counts}

    @app.get("/api/admin/audit")
    def admin_audit():
        require_admin()
        return {"log": rows("SELECT at, actor, action, details FROM audit_log ORDER BY id DESC LIMIT 200")}

    # ---------- osztályfőnök / csoportfelelős ----------
    # Csak a saját csoportjait látja és kezeli: a névsort, a jelenlétet, és hogy ki szavazott már.
    # Azt, hogy KIRE szavaztak, itt sem látja senki.

    @app.get("/api/teacher/overview")
    def teacher_overview():
        my_groups = require_leader()
        e = active_election()
        show_voted = bool(e) and e["status"] == "open"
        groups = []
        for name in my_groups:
            gr = get_group(name)
            mem = []
            for m in members(name):
                a = attendance(e["id"], m["email"]) if e else None
                mem.append(
                    {
                        "email": m["email"],
                        "name": m["name"],
                        "present": bool(a["present"]) if a else None,
                        "voted": has_voted(e["id"], m["email"]) if show_voted else None,
                    }
                )
            groups.append(
                {
                    "name": name,
                    "kind": gr["kind"] if gr else "csoport",
                    "votes": group_allowed(e, name) if e else None,  # részt vesz-e a csoport ebben a szavazásban
                    "members": mem,
                }
            )
        return {
            "me": g.session["email"],
            "isAdmin": is_admin(g.session["email"]),
            "election": {
                "id": e["id"],
                "name": e["name"],
                "status": e["status"],
                "isTrial": bool(e["is_trial"]),
                "requireAttendance": bool(e["require_attendance"]),
            }
            if e
            else None,
            "groups": groups,
        }

    @app.put("/api/teacher/attendance")
    def teacher_attendance():
        """Jelenlét rögzítése: { group, present: [email...], absent: [email...] }"""
        my_groups = require_leader()
        e = active_election()
        if not e:
            raise HttpError(409, "Nincs előkészített vagy nyitott szavazás.")
        b = body()
        group = str(b.get("group") or "")
        if group not in my_groups:
            raise HttpError(403, "Ennek a csoportnak nem vagy a felelőse.")

        def email_list(x):
            return [str(s).lower() for s in x] if isinstance(x, list) else []

        present, absent = email_list(b.get("present")), email_list(b.get("absent"))
        member_emails = {m["email"] for m in members(group)}
        foreign = [em for em in present + absent if em not in member_emails]
        if foreign:
            raise HttpError(403, f"Nem a csoportod tagja: {', '.join(foreign)}")
        voted_absent = [em for em in absent if has_voted(e["id"], em)]
        if voted_absent:
            raise HttpError(409, f"Aki már szavazott, nem jelölhető hiányzónak: {', '.join(voted_absent)}")
        actor = g.session["email"]
        with database.transaction(conn()):
            for em in present:
                set_attendance(e["id"], em, True, actor)
            for em in absent:
                set_attendance(e["id"], em, False, actor)
        audit(actor, "attendance_marked", {"election": e["id"], "group": group, "present": len(present), "absent": len(absent)})
        return {"ok": True}

    # Állapotjelzés (monitorozáshoz, pl. uptime-figyelő)
    @app.get("/healthz")
    def healthz():
        conn().execute("SELECT 1")
        return {"ok": True, "openElection": open_election() is not None}

    # ---------- statikus oldalak (public/ mappa) ----------
    # /admin -> admin.html, /tanar -> tanar.html, / -> index.html

    @app.get("/")
    @app.get("/<path:p>")
    def static_page(p="index.html"):
        if p.startswith("api/"):
            raise HttpError(404, "Nincs ilyen végpont.")
        for candidate in (p, p + ".html"):
            if (PUBLIC_DIR / candidate).is_file() and PUBLIC_DIR in (PUBLIC_DIR / candidate).resolve().parents:
                return send_from_directory(PUBLIC_DIR, candidate)
        raise HttpError(404, "Nincs ilyen oldal.")

    # ---------- hibakezelés ----------

    @app.errorhandler(HttpError)
    def handle_http_error(err):
        data = {"error": err.message}
        if err.code:
            data["code"] = err.code
        return jsonify(data), err.status

    @app.errorhandler(HTTPException)
    def handle_werkzeug_error(err):  # pl. 404, 405, 413 (túl nagy kérés)
        return jsonify(error=err.description), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        log.error("Váratlan hiba: %s: %s", type(err).__name__, err)  # törzs nélkül!
        return jsonify(error="Szerverhiba."), 500

    return app
