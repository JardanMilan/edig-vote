"""Automata tesztek.  Futtatás:  python -m pytest

Ugyanazokat a szabályokat ellenőrzik, mint a korábbi (Node) verzió 24 tesztje:
teljes szavazási kör, jogosultság, visszaélések, anonimitás, osztályfőnöki jelenlét, jegyzőkönyv.
"""

import hashlib
import http.client
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from werkzeug.serving import make_server

from szavazas.app import create_app, ip_allowed
from szavazas.auth import LoginError
from szavazas.config import load_config
from szavazas.db import init_db
from szavazas.jelenlet import current_code, verify_code
from szavazas.nevjegyzek import parse_voters

# ---------- tesztkörnyezet ----------


def fake_google(token):
    if token == "jo-token":
        return "diak1@edig.hu"
    raise LoginError("Csak @edig.hu fiókkal lehet belépni.")


class Env:
    def __init__(self, tmp_path, **overrides):
        self.cfg = load_config(
            dev_login=True,
            secret="teszt-titok",
            admin_emails=["admin@edig.hu"],
            kiosk_key="kulcs",
            cookie_secure=False,
            google_client_id="",
            allowed_ips=[],
            trust_proxy=False,
            db_path=str(tmp_path / "teszt.db"),
            **overrides,
        )
        self.app = create_app(self.cfg, fake_google)

    def client(self):
        return Client(self.app.test_client())

    def db(self):
        c = sqlite3.connect(self.cfg["db_path"])
        return c

    def scalar(self, sql, *args):
        with self.db() as c:
            return c.execute(sql, args).fetchone()[0]

    def code(self, eid):
        return current_code(self.cfg, eid)["code"]


class Res:
    def __init__(self, r):
        self.status = r.status_code
        self.raw = r.get_data()
        try:
            self.data = json.loads(self.raw)
        except ValueError:
            self.data = {}


class Client:
    """Egyszerű "böngésző" sütikezeléssel (a Flask tesztkliense)."""

    def __init__(self, c):
        self.c = c

    def get(self, path):
        return Res(self.c.get(path))

    def post(self, path, body=None):
        return Res(self.c.post(path, json=body if body is not None else {}))

    def put(self, path, body=None):
        return Res(self.c.put(path, json=body if body is not None else {}))

    def delete(self, path):  # mint a böngésző: JSON fejléc, törzs nélkül
        return Res(self.c.delete(path, headers={"Content-Type": "application/json"}))

    def login(self, email):
        return self.post("/api/login/dev", {"email": email})


VOTERS = """email;osztaly
diak1@edig.hu;11.A
diak2@edig.hu;11.A
diak3@edig.hu;11.B
diak4@edig.hu;9.b
diak5@edig.hu;9.B
diak6@edig.hu;12a"""

CANDS = [{"id": "11.A", "label": "11.A"}, {"id": "11.B", "label": "11.B"}]


def prepare_election(env, allowed_classes=(), open_=True, require_attendance=False):
    """A régi tesztek jelenlét-ellenőrzés nélküli szavazással futnak; a jelenlétet külön tesztek nézik."""
    admin = env.client()
    admin.login("admin@edig.hu")
    r = admin.put("/api/admin/voters", {"csv": VOTERS})
    assert r.status == 200, r.data
    r = admin.post(
        "/api/admin/elections",
        {
            "name": "Teszt",
            "isTrial": True,
            "candidates": CANDS,
            "allowedClasses": list(allowed_classes),
            "requireAttendance": require_attendance,
        },
    )
    assert r.status == 200, r.data
    eid = r.data["id"]
    if open_:
        assert admin.post(f"/api/admin/elections/{eid}/open").status == 200
    return admin, eid


def student_ready(env, eid, email):
    s = env.client()
    s.login(email)
    r = s.post("/api/presence", {"code": env.code(eid)})
    assert r.status == 200, r.data
    return s


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


# ---------- segédfüggvények ----------

# A Node-verzió (v0.3) által ugyanerre a bemenetre számolt kód.
NODE_REFERENCE_CODE = "079313"


def test_nevjegyzek_normalizalas_hibas_sorok():
    voters, errors = parse_voters("email;osztaly\na@edig.hu;11a\nb@gmail.com;9.B\nc@edig.hu;\na@edig.hu;10.A", "edig.hu")
    assert voters == [{"email": "a@edig.hu", "class": "11.A", "name": ""}]
    assert len(errors) == 3
    named = parse_voters("t@edig.hu;Tanár;Kovács  Anna", "edig.hu")[0][0]
    assert named == {"email": "t@edig.hu", "class": "TANÁR", "name": "Kovács Anna"}


def test_jelenleti_kod_aktualis_es_elozo_ablak():
    cfg = {"secret": "s", "code_window_sec": 30, "code_grace_windows": 1}
    t = 1_700_000_000_000
    code = current_code(cfg, 1, t)["code"]
    assert verify_code(cfg, 1, code, t)
    assert verify_code(cfg, 1, code, t + 30_000)
    assert not verify_code(cfg, 1, code, t + 61_000)
    assert not verify_code(cfg, 2, code, t), "másik szavazás kódja nem jó"


def test_jelenleti_kod_azonos_a_korabbi_verzioval():
    # A Node-verzió ugyanerre a bemenetre ugyanezt a kódot adta: a kivetítő és a régi adatok kompatibilisek.
    cfg = {"secret": "s", "code_window_sec": 30, "code_grace_windows": 1}
    assert current_code(cfg, 1, 1_700_000_000_000)["code"] == NODE_REFERENCE_CODE


def test_ip_szures():
    assert ip_allowed("1.2.3.4", [])
    assert ip_allowed("::ffff:81.183.10.7", ["81.183.10.0/24"])
    assert not ip_allowed("81.183.11.7", ["81.183.10.0/24"])
    assert ip_allowed("10.0.0.5", ["10.0.0.5"])


# ---------- szavazási folyamat ----------


def test_teljes_kor(env):
    admin, eid = prepare_election(env)
    s = env.client()
    s.login("diak1@edig.hu")

    me = s.get("/api/me").data
    assert me["canVote"] is True
    assert me["present"] is False

    assert s.post("/api/vote", {"candidateId": "11.B"}).data["code"] == "not_present"
    wrong = "111111" if env.code(eid) == "000000" else "000000"
    assert s.post("/api/presence", {"code": wrong}).data["code"] == "bad_code"
    assert s.post("/api/presence", {"code": env.code(eid)}).status == 200

    r = s.post("/api/vote", {"candidateId": "11.B"})
    assert r.status == 200
    assert r.data == {"ok": True}, "a válasz nem árulhatja el a választást"

    # szavazás után a munkamenet megszűnik (közös gépek miatt)
    assert s.post("/api/vote", {"candidateId": "11.A"}).status == 401
    s.login("diak1@edig.hu")
    assert s.get("/api/me").data["reason"] == "already_voted"
    r = s.post("/api/vote", {"candidateId": "11.A"})
    assert r.status == 403
    assert r.data["code"] == "already_voted"

    # eredmény nyitott szavazás alatt adminnak sem látható
    assert admin.get(f"/api/admin/elections/{eid}/protocol").status == 403

    assert student_ready(env, eid, "diak3@edig.hu").post("/api/vote", {"candidateId": "11.B"}).status == 200
    assert student_ready(env, eid, "diak4@edig.hu").post("/api/vote", {"candidateId": "11.A"}).status == 200

    assert admin.post(f"/api/admin/elections/{eid}/close").status == 200
    r = admin.get(f"/api/admin/elections/{eid}/protocol")
    p = r.data["protocol"]
    assert (p["votedCount"], p["ballotCount"], p["consistent"]) == (3, 3, True)
    assert [(x["id"], x["count"]) for x in p["results"]] == [("11.B", 2), ("11.A", 1)]
    assert p["winners"] == ["11.B"]
    assert p["eligibleCount"] == 6
    assert len(r.data["resultHash"]) == 64

    # lezárás után nem lehet szavazni
    late = env.client()
    late.login("diak2@edig.hu")
    assert late.get("/api/me").data["reason"] == "no_open_election"


# ---------- jogosultság ----------


@pytest.fixture
def env_jog(tmp_path):
    env = Env(tmp_path)
    _, env.eid = prepare_election(env, allowed_classes=["11.A", "9.B"])
    return env


def reason(env, email):
    s = env.client()
    s.login(email)
    return s.get("/api/me").data["reason"]


def test_probakor_csak_kijelolt_osztalyok(env_jog):
    assert reason(env_jog, "diak1@edig.hu") is None
    assert reason(env_jog, "diak4@edig.hu") is None  # "9.b" -> 9.B
    assert reason(env_jog, "diak3@edig.hu") == "class_not_in_round"


def test_nincs_a_nevjegyzekben(env_jog):
    assert reason(env_jog, "idegen@edig.hu") == "not_on_list"


def test_csak_iskolai_domain(env_jog):
    s = env_jog.client()
    assert s.login("valaki@gmail.com").status == 401
    assert s.post("/api/login/google", {"credential": "rossz"}).status == 401
    assert s.post("/api/login/google", {"credential": "jo-token"}).status == 200
    assert s.get("/api/me").data["email"] == "diak1@edig.hu"


def test_diak_nem_eri_el_az_admint(env_jog):
    s = env_jog.client()
    s.login("diak1@edig.hu")
    assert s.get("/api/admin/overview").status == 403
    assert s.post(f"/api/admin/elections/{env_jog.eid}/close").status == 403


def test_nevjegyzek_nyitott_szavazas_alatt_zarolt(env_jog):
    admin = env_jog.client()
    admin.login("admin@edig.hu")
    assert admin.put("/api/admin/voters", {"csv": VOTERS}).status == 409


# ---------- visszaélések és hibák ----------


def test_50_parhuzamos_szavazas_egy_diaktol(env):
    """Valódi, többszálú szerverrel: 50 egyidejű kérés ugyanazzal a munkamenettel -> pontosan 1 szavazat."""
    _, eid = prepare_election(env)
    server = make_server("127.0.0.1", 0, env.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port

    def call(method, path, body, cookie=""):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        c.request(method, path, json.dumps(body), {"Content-Type": "application/json", "Cookie": cookie})
        r = c.getresponse()
        r.read()
        cookies = [h.split(";")[0] for k, h in r.getheaders() if k.lower() == "set-cookie"]
        c.close()
        return r.status, cookies

    try:
        _, cookies = call("POST", "/api/login/dev", {"email": "diak5@edig.hu"})
        sid = next(c for c in cookies if c.startswith("sid="))
        assert call("POST", "/api/presence", {"code": env.code(eid)}, sid)[0] == 200
        with ThreadPoolExecutor(max_workers=50) as pool:
            statuses = list(pool.map(lambda _: call("POST", "/api/vote", {"candidateId": "11.A"}, sid)[0], range(50)))
    finally:
        server.shutdown()
    assert statuses.count(200) == 1
    assert env.scalar("SELECT SUM(count) FROM tally WHERE election_id = ?", eid) == 1


def test_ervenytelen_jelolt_visszagorgetes(env):
    _, eid = prepare_election(env)
    s = student_ready(env, eid, "diak6@edig.hu")
    assert s.post("/api/vote", {"candidateId": "NINCS"}).status == 400
    assert env.scalar("SELECT COUNT(*) FROM voted WHERE email = ?", "diak6@edig.hu") == 0
    assert s.post("/api/vote", {"candidateId": "11.B"}).status == 200, "utána még szavazhat"


def test_5_hibas_kod_utan_zarolas(env):
    _, eid = prepare_election(env)
    s = env.client()
    s.login("diak1@edig.hu")
    good = env.code(eid)
    bad = "654321" if good == "123456" else "123456"
    for _ in range(5):
        assert s.post("/api/presence", {"code": bad}).data["code"] == "bad_code"
    assert s.post("/api/presence", {"code": good}).status == 429, "zárolás alatt a jó kód sem működik"


def test_nem_json_keres_elutasitva(env):
    r = env.app.test_client().post(
        "/api/vote", data="candidateId=11.A", content_type="application/x-www-form-urlencoded"
    )
    assert r.status_code == 415


def test_kivetito_kulcs(env):
    _, eid = prepare_election(env)
    c = env.client()
    assert c.get("/api/kiosk/code?key=rossz").status == 403
    d = c.get("/api/kiosk/code?key=kulcs").data
    assert d["code"] == env.code(eid)
    assert d["qrSvg"].startswith("<svg")


def test_iskolai_halozat(tmp_path):
    env = Env(tmp_path, **{})
    env.cfg["allowed_ips"] = ["81.183.10.0/24"]
    _, eid = prepare_election(env)
    s = env.client()
    s.login("diak1@edig.hu")
    assert s.post("/api/presence", {"code": env.code(eid)}).data["code"] == "wrong_network"


# ---------- csoportok, osztályfőnökök, reggeli jelenlét ----------


@pytest.fixture(scope="module")
def env_ofo(tmp_path_factory):
    env = Env(tmp_path_factory.mktemp("ofo"))
    admin = env.client()
    admin.login("admin@edig.hu")
    r = admin.put(
        "/api/admin/voters",
        {
            "csv": "email;csoport;nev\n"
            "diak1@edig.hu;11.A;Versenyző Vilma\n"
            "diak4@edig.hu;9.B;Kiss Anna\n"
            "diak5@edig.hu;9.B;Nagy Bence\n"
            "tanar1@edig.hu;TANÁR;Tóth Tímea"
        },
    )
    assert r.status == 200, r.data
    assert admin.post("/api/admin/groups", {"name": "9.B", "leaders": ["ofo9b@edig.hu"]}).status == 200
    assert admin.post("/api/admin/groups", {"name": "11.A", "leaders": "ofo11a@edig.hu"}).status == 200
    assert admin.post("/api/admin/groups", {"name": "TANÁR", "leaders": ["ih@edig.hu"]}).status == 200
    assert admin.post("/api/admin/groups", {"name": "9.B", "leaders": ["kulsos@gmail.com"]}).status == 400, "csak iskolai cím"
    r = admin.post("/api/admin/elections", {"name": "Diáknap", "candidates": CANDS, "allowedClasses": ["9.B", "TANÁR"]})
    env.eid = r.data["id"]
    assert admin.post(f"/api/admin/elections/{env.eid}/open").status == 200
    env.admin = admin
    return env


def as_user(env, email):
    c = env.client()
    c.login(email)
    return c


# A modul tesztjei egymásra épülnek (mint az eredetiben), ezért a sorrendjük számít.


def test_ofo_1_alapertelmezes_jelenlet_nelkul_nem(env_ofo):
    o = env_ofo.admin.get("/api/admin/overview").data
    assert o["elections"][0]["requireAttendance"] is True
    assert o["elections"][0]["eligibleCount"] == 0
    assert o["elections"][0]["memberTotal"] == 3
    s = as_user(env_ofo, "diak4@edig.hu")
    assert s.get("/api/me").data["reason"] == "not_marked"
    assert s.post("/api/presence", {"code": env_ofo.code(env_ofo.eid)}).data["code"] == "not_marked"


def test_ofo_2_csak_sajat_osztaly_nevekkel(env_ofo):
    t = as_user(env_ofo, "ofo9b@edig.hu")
    o = t.get("/api/teacher/overview").data
    assert [g["name"] for g in o["groups"]] == ["9.B"]
    assert [m["name"] for m in o["groups"][0]["members"]] == ["Kiss Anna", "Nagy Bence"]
    assert o["groups"][0]["members"][0]["present"] is None
    assert o["election"]["requireAttendance"] is True
    assert t.get("/api/admin/overview").status == 403, "nem admin"
    assert t.get("/api/me").data["isLeader"] is True


def test_ofo_3_jelen_levo_szavazhat_hianyzo_nem(env_ofo):
    t = as_user(env_ofo, "ofo9b@edig.hu")
    r = t.put("/api/teacher/attendance", {"group": "9.B", "present": ["diak4@edig.hu"], "absent": ["diak5@edig.hu"]})
    assert r.status == 200, r.data
    assert as_user(env_ofo, "diak5@edig.hu").get("/api/me").data["reason"] == "absent"
    s = student_ready(env_ofo, env_ofo.eid, "diak4@edig.hu")
    assert s.post("/api/vote", {"candidateId": "11.B"}).status == 200
    o = t.get("/api/teacher/overview").data
    anna = next(m for m in o["groups"][0]["members"] if m["email"] == "diak4@edig.hu")
    assert (anna["present"], anna["voted"]) == (True, True)
    again = t.put("/api/teacher/attendance", {"group": "9.B", "absent": ["diak4@edig.hu"]})
    assert again.status == 409, "aki szavazott, nem jelölhető hiányzónak"


def test_ofo_4_mas_osztalyat_nem_kezelheti(env_ofo):
    t = as_user(env_ofo, "ofo9b@edig.hu")
    assert t.put("/api/teacher/attendance", {"group": "11.A", "present": ["diak1@edig.hu"]}).status == 403
    assert t.put("/api/teacher/attendance", {"group": "9.B", "present": ["diak1@edig.hu"]}).status == 403
    assert t.put("/api/teacher/attendance", {"group": "9.B", "present": ["tanar1@edig.hu"]}).status == 403
    assert as_user(env_ofo, "diak4@edig.hu").get("/api/teacher/overview").data["code"] == "not_leader"
    o11 = as_user(env_ofo, "ofo11a@edig.hu").get("/api/teacher/overview").data
    assert o11["groups"][0]["votes"] is False, "a 11.A ebben a szavazásban nem szavaz"


def test_ofo_5_tanari_csoport(env_ofo):
    ih = as_user(env_ofo, "ih@edig.hu")
    assert ih.put("/api/teacher/attendance", {"group": "TANÁR", "present": ["tanar1@edig.hu"]}).status == 200
    t1 = student_ready(env_ofo, env_ofo.eid, "tanar1@edig.hu")
    assert t1.post("/api/vote", {"candidateId": "11.A"}).status == 200


def test_ofo_6_kivetito_kulcs_nelkul(env_ofo):
    k = as_user(env_ofo, "ofo9b@edig.hu").get("/api/kiosk/code")
    assert k.data["code"] == env_ofo.code(env_ofo.eid)
    assert as_user(env_ofo, "diak4@edig.hu").get("/api/kiosk/code").status == 403


def test_ofo_7_tagsag_zarolt_lezaraskor_jelenlevok_jogosultak(env_ofo):
    admin = env_ofo.admin
    assert admin.post("/api/admin/members", {"email": "uj@edig.hu", "group": "9.B", "name": "Új"}).status == 409
    assert admin.delete("/api/admin/members/diak5@edig.hu").status == 409
    assert admin.post(f"/api/admin/elections/{env_ofo.eid}/close").status == 200
    p = admin.get(f"/api/admin/elections/{env_ofo.eid}/protocol").data["protocol"]
    assert [p["eligibleCount"], p["memberTotal"], p["votedCount"], p["ballotCount"]] == [2, 3, 2, 2]
    t = as_user(env_ofo, "ofo9b@edig.hu")
    r = t.put("/api/teacher/attendance", {"group": "9.B", "present": ["diak5@edig.hu"]})
    assert r.status == 409, "lezárás után nincs aktív szavazás"


def test_ofo_8_tagok_es_csoportok_kezelese(env_ofo):
    admin = env_ofo.admin
    assert admin.post("/api/admin/members", {"email": "uj@edig.hu", "group": "9.B", "name": "Új Ödön"}).status == 200
    assert admin.post("/api/admin/members", {"email": "uj@edig.hu", "group": "NINCS"}).status == 404
    m = admin.get("/api/admin/groups/9.B/members").data["members"]
    assert any(x["email"] == "uj@edig.hu" and x["name"] == "Új Ödön" for x in m)
    assert admin.delete("/api/admin/groups/9.B").status == 409, "nem üres"
    assert admin.post("/api/admin/groups", {"name": "DÖK", "kind": "csoport"}).status == 200
    assert admin.post("/api/admin/members", {"email": "uj@edig.hu", "group": "DÖK"}).status == 200, "áthelyezés"
    m = admin.get("/api/admin/groups/DÖK/members").data["members"]
    assert m[0]["name"] == "Új Ödön", "áthelyezéskor a név megmarad"
    assert admin.delete("/api/admin/members/uj@edig.hu").status == 200
    assert admin.delete("/api/admin/groups/DÖK").status == 200
    g = next(x for x in admin.get("/api/admin/overview").data["groups"] if x["name"] == "9.B")
    assert g["leaders"] == ["ofo9b@edig.hu"]


# ---------- anonimitás – adatbázis-szerkezet ----------


def test_nincs_tabla_amiben_email_es_jelolt_egyutt_van(tmp_path):
    path = str(tmp_path / "anon.db")
    init_db(path)
    c = sqlite3.connect(path)
    cols = lambda t: [r[1] for r in c.execute(f"PRAGMA table_info({t})")]  # noqa: E731
    for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
        assert not ("email" in cols(t) and "candidate_id" in cols(t)), f"{t} tábla összekapcsolná a szavazót és a szavazatot"
    assert sorted(cols("voted")) == ["election_id", "email"], "a voted táblában nincs időbélyeg"
    assert sorted(cols("tally")) == ["candidate_id", "count", "election_id"]


# ---------- QR-beolvasás, szabályok, admin funkciók ----------


@pytest.fixture(scope="module")
def env_v2(tmp_path_factory):
    return Env(tmp_path_factory.mktemp("v2"))


def test_v2_1_qr_beolvasas(env_v2):
    env = env_v2
    admin, eid = prepare_election(env)
    s = env.client()
    # a scan végpont nem árulja el, jó-e a kód
    assert s.post("/api/presence/scan", {"code": "000000"}).status == 200
    s.login("diak1@edig.hu")
    if env.code(eid) != "000000":
        assert s.post("/api/presence", {}).data["code"] == "bad_code"

    assert s.post("/api/presence/scan", {"code": env.code(eid)}).status == 200
    assert s.get("/api/me").data["hasScan"] is True
    assert s.post("/api/presence", {}).status == 200
    assert s.get("/api/me").data["present"] is True
    assert s.post("/api/presence", {}).data["code"] == "bad_code", "a beolvasás egyszer használható"

    # hamisított scan süti nem jó
    f = env.client()
    f.login("diak2@edig.hu")
    f.c.set_cookie("scan", f"{env.code(eid)}.{1}.hamis", path="/api")
    assert f.post("/api/presence", {}).data["code"] == "bad_code"
    admin.post(f"/api/admin/elections/{eid}/close")


def test_v2_2_sajat_osztalyra_szavazas_tilthato(env_v2):
    admin = as_user(env_v2, "admin@edig.hu")
    r = admin.post(
        "/api/admin/elections", {"name": "Saját tiltva", "noSelfVote": True, "requireAttendance": False, "candidates": CANDS}
    )
    eid = r.data["id"]
    assert admin.post(f"/api/admin/elections/{eid}/open").status == 200
    s = student_ready(env_v2, eid, "diak2@edig.hu")  # 11.A
    assert s.get("/api/me").data["election"]["blockedCandidate"] == "11.A"
    assert s.post("/api/vote", {"candidateId": "11.A"}).data["code"] == "own_class"
    assert s.post("/api/vote", {"candidateId": "11.B"}).status == 200
    admin.post(f"/api/admin/elections/{eid}/close")


def test_v2_3_torles_es_ismeretlen_osztaly(env_v2):
    admin = as_user(env_v2, "admin@edig.hu")
    ab = [{"id": "11.A", "label": "A"}, {"id": "11.B", "label": "B"}]
    assert admin.post("/api/admin/elections", {"name": "Törlendő", "candidates": ab, "allowedClasses": ["13.X"]}).status == 400
    r = admin.post("/api/admin/elections", {"name": "Törlendő", "candidates": ab})
    assert admin.delete(f"/api/admin/elections/{r.data['id']}").status == 200
    closed = next(e for e in admin.get("/api/admin/overview").data["elections"] if e["status"] == "closed")
    assert admin.delete(f"/api/admin/elections/{closed['id']}").status == 409


def test_v2_4_jegyzokonyv_lenyomat_es_kozzetetel(env_v2):
    admin = as_user(env_v2, "admin@edig.hu")
    closed = next(e for e in admin.get("/api/admin/overview").data["elections"] if e["status"] == "closed")
    raw = admin.get(f"/api/admin/elections/{closed['id']}/protocol.json").raw
    assert hashlib.sha256(raw).hexdigest() == closed["resultHash"]

    kiosk = env_v2.client()
    assert "results" not in kiosk.get("/api/kiosk/code?key=kulcs").data, "közzététel előtt nincs eredmény"
    admin.post(f"/api/admin/elections/{closed['id']}/publish", {"published": True})
    assert isinstance(kiosk.get("/api/kiosk/code?key=kulcs").data["results"]["results"], list)


def test_v2_5_ugyelet_kereses_jelenlet_javitas(env_v2):
    admin = as_user(env_v2, "admin@edig.hu")
    r = admin.put("/api/admin/attendance", {"email": "diak5@edig.hu", "present": True})
    assert r.status == 409, "nincs aktív szavazás"
    d = admin.post("/api/admin/elections", {"name": "Ügyelet", "candidates": [{"id": "11.A", "label": "A"}, {"id": "11.B", "label": "B"}]})
    r = admin.get("/api/admin/voters/search?q=diak5")
    assert len(r.data["voters"]) == 1
    assert r.data["voters"][0]["present"] is None
    assert admin.put("/api/admin/attendance", {"email": "diak5@edig.hu", "present": True}).status == 200
    assert admin.get("/api/admin/voters/search?q=diak5").data["voters"][0]["present"] is True
    assert len(admin.get("/api/admin/voters/search?q=%25").data["voters"]) == 0, "LIKE-joker escape-elve"
    assert admin.delete(f"/api/admin/elections/{d.data['id']}").status == 200


def test_v2_6_szemelyes_adatok_torlese(env_v2):
    admin = as_user(env_v2, "admin@edig.hu")
    assert admin.post("/api/admin/purge", {"confirm": "igen"}).status == 400
    assert admin.post("/api/admin/purge", {"confirm": "TÖRLÉS"}).status == 200
    assert env_v2.scalar("SELECT COUNT(*) FROM voters") == 0
    assert env_v2.scalar("SELECT COUNT(*) FROM voted") == 0
    assert env_v2.scalar("SELECT COUNT(*) FROM elections WHERE protocol IS NOT NULL") >= 1
    assert admin.get("/api/admin/overview").status == 200, "az admin bejelentkezve marad"
    e = admin.post("/api/admin/elections", {"name": "Üres", "candidates": [{"id": "11.A", "label": "A"}, {"id": "11.B", "label": "B"}]})
    assert admin.post(f"/api/admin/elections/{e.data['id']}/open").status == 409, "0 taggal nem nyitható"


def test_healthz_es_statikus_oldalak(env):
    c = env.client()
    assert c.get("/healthz").data["ok"] is True
    assert c.get("/").status == 200
    assert c.get("/admin").status == 200, "/admin -> admin.html"
    assert c.get("/../README.md").status == 404
    assert c.get("/api/nincs-ilyen").status == 404

