"""Jelenléti kód.

TOTP-szerű, 6 jegyű szám, ami `code_window_sec` másodpercenként változik.
A kivetítőn (kiosk) jelenik meg, csak az tudja beírni, aki a teremben látja.
A kód szavazásonként eltér (a szavazás azonosítója benne van a HMAC-ban).
"""

import hashlib
import hmac
import re
import time


def _code_for(secret, election_id, window_index):
    mac = hmac.new(secret.encode(), f"presence:{election_id}:{window_index}".encode(), hashlib.sha256).digest()
    n = int.from_bytes(mac[:4], "big") % 1_000_000
    return f"{n:06d}"


def _now_ms():
    return int(time.time() * 1000)


def _window(window_sec, now_ms):
    return now_ms // 1000 // window_sec


def current_code(cfg, election_id, now_ms=None):
    now_ms = _now_ms() if now_ms is None else now_ms
    w = _window(cfg["code_window_sec"], now_ms)
    seconds_left = cfg["code_window_sec"] - (now_ms // 1000) % cfg["code_window_sec"]
    return {
        "code": _code_for(cfg["secret"], election_id, w),
        "secondsLeft": seconds_left,
        "windowSec": cfg["code_window_sec"],
    }


def verify_code(cfg, election_id, value, now_ms=None):
    now_ms = _now_ms() if now_ms is None else now_ms
    clean = re.sub(r"\D", "", str(value or ""))
    if len(clean) != 6:
        return False
    w = _window(cfg["code_window_sec"], now_ms)
    for i in range(cfg["code_grace_windows"] + 1):
        # compare_digest: az összehasonlítás ideje nem árulja el, hány számjegy egyezett
        if hmac.compare_digest(_code_for(cfg["secret"], election_id, w - i), clean):
            return True
    return False
