"""Beállítások.

Minden beállítás környezeti változóból jön (lásd .env.example). Ha a munkakönyvtárban
van .env fájl, azt is beolvassuk (a már beállított környezeti változókat nem írja felül).
A load_config() tesztekben felülírható paraméterekkel is hívható.
"""

import os
from pathlib import Path


def _list(value):
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def load_env_file(path=".env"):
    """Egyszerű .env beolvasó: KULCS=ÉRTÉK soronként, # kezdetű sor megjegyzés."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def load_config(**overrides):
    env = os.environ
    trust_proxy = env.get("TRUST_PROXY", "")
    cfg = {
        "port": int(env.get("PORT", 3000)),
        # Proxy (Caddy) mögött csak a saját gépről fogadunk kérést, különben bárki hamisíthatná az IP-jét.
        "host": env.get("HOST") or ("127.0.0.1" if trust_proxy else "0.0.0.0"),
        "db_path": env.get("DB_PATH", "./data/szavazas.db"),
        # Google bejelentkezés
        "google_client_id": env.get("GOOGLE_CLIENT_ID", ""),
        "allowed_domain": env.get("ALLOWED_DOMAIN", "edig.hu").lower(),
        # Adminok: csak ezek a (Google-lel igazolt) címek érik el az admin felületet
        "admin_emails": [e.lower() for e in _list(env.get("ADMIN_EMAILS"))],
        # A kivetítő (kiosk) oldal kulcsa – ezzel lehet a jelenléti kódot megjeleníteni
        "kiosk_key": env.get("KIOSK_KEY", ""),
        # Jelenléti kód: ennyi másodpercenként vált, és ennyi korábbi ablakot fogadunk még el
        "code_window_sec": int(env.get("CODE_WINDOW_SEC", 30)),
        "code_grace_windows": int(env.get("CODE_GRACE_WINDOWS", 1)),
        # Sikeres kódbeírás után ennyi ideig lehet szavazni
        "presence_ttl_sec": int(env.get("PRESENCE_TTL_SEC", 300)),
        # QR-beolvasás után ennyi ideje van a diáknak belépni a Google-fiókjával
        "scan_ttl_sec": int(env.get("SCAN_TTL_SEC", 180)),
        # Opcionális: csak ezekről az IP-kről / tartományokról lehet szavazni (pl. iskolai NAT IP)
        "allowed_ips": _list(env.get("ALLOWED_IPS")),
        # Ha be van állítva: reverse proxy (Caddy) mögött fut, az X-Forwarded-For fejlécből jön a valódi IP
        "trust_proxy": bool(trust_proxy),
        # Titok a jelenléti kódhoz és a munkamenetekhez. Élesben kötelező, hosszú, véletlen.
        "secret": env.get("APP_SECRET", ""),
        # FEJLESZTŐI MÓD: Google nélküli bejelentkezés tesztcímekkel. ÉLESBEN TILOS.
        "dev_login": env.get("DEV_LOGIN") == "1",
        "session_ttl_sec": int(env.get("SESSION_TTL_SEC", 60 * 60 * 2)),
        "cookie_secure": env.get("COOKIE_SECURE") != "0",
    }
    cfg.update(overrides)

    if not cfg["secret"]:
        if cfg["dev_login"]:
            cfg["secret"] = "dev-secret-ne-hasznald-elesben"
        else:
            raise SystemExit("APP_SECRET hiányzik. Élesben kötelező (pl. `openssl rand -hex 32`).")
    if not cfg["dev_login"] and not cfg["google_client_id"]:
        raise SystemExit("GOOGLE_CLIENT_ID hiányzik (vagy fejlesztéshez DEV_LOGIN=1).")
    return cfg
