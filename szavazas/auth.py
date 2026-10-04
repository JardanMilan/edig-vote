"""Google-bejelentkezés ellenőrzése.

A Google ID token ellenőrzése SZERVEROLDALON történik:
aláírás, lejárat, audience (a mi client ID-nk), igazolt email, és a Workspace domain (hd).
A kliensoldali `hd` paraméter csak kényelmi szűrés, arra nem lehet építeni.
"""

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


class LoginError(Exception):
    pass


def create_google_verifier(cfg):
    transport = google_requests.Request()

    def verify(token):
        try:
            p = id_token.verify_oauth2_token(token, transport, cfg["google_client_id"])
        except ValueError as e:
            raise LoginError("Érvénytelen Google-bejelentkezés.") from e
        if not p.get("email") or not p.get("email_verified"):
            raise LoginError("A Google-fiók emailcíme nincs igazolva.")
        email = p["email"].lower()
        domain = email.split("@")[1]
        if p.get("hd") != cfg["allowed_domain"] or domain != cfg["allowed_domain"]:
            raise LoginError(f"Csak @{cfg['allowed_domain']} fiókkal lehet belépni.")
        return email

    return verify
