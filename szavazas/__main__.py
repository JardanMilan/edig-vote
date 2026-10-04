"""Indítás:  python -m szavazas

A beállításokat a környezeti változókból / .env fájlból veszi (lásd .env.example).
Élesben a waitress webszerver fut (Windows-on és Linuxon is működik, nincs natív fordítás).
"""

import logging
import sys

from waitress import serve

from .app import create_app
from .auth import create_google_verifier
from .config import load_config, load_env_file


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_env_file()
    cfg = load_config()

    if cfg["google_client_id"]:
        verify_google = create_google_verifier(cfg)
    else:

        def verify_google(_token):
            raise RuntimeError("Google-bejelentkezés nincs beállítva (GOOGLE_CLIENT_ID).")

    app = create_app(cfg, verify_google)

    print(f"Diáknapi szavazás fut: http://localhost:{cfg['port']}", flush=True)
    if cfg["dev_login"]:
        print("\n⚠️  FEJLESZTŐI MÓD (DEV_LOGIN=1): bárki beléphet tetszőleges címmel. ÉLESBEN TILOS!\n", flush=True)
    if not cfg["admin_emails"]:
        print("Figyelem: nincs ADMIN_EMAILS beállítva, az admin felület elérhetetlen.", file=sys.stderr)

    # 16 szál: egyszerre ennyi kérést szolgál ki; a többi rövid ideig sorban áll.
    serve(app, host=cfg["host"], port=cfg["port"], threads=16, ident=None)


if __name__ == "__main__":
    main()
