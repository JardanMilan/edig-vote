"""Névjegyzék (CSV / lista) feldolgozása.

Elfogadott formátum soronként: email;csoport;név   (pontosvessző, vessző vagy tab; a név elhagyható)
A csoport egy osztály (pl. 9.A) vagy más csoport (pl. TANÁR).
Fejléc sor (pl. "email;osztaly;nev") és üres sorok kimaradnak.
"""

import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+$")


def normalize_class(c):
    """'11a' -> '11.A', ' 9.b ' -> '9.B', 'tanár' -> 'TANÁR'"""
    s = re.sub(r"\s+", "", str(c or "").strip().upper())
    return re.sub(r"^(\d+)([A-Z])$", r"\1.\2", s)


def parse_voters(text, domain):
    voters, errors, seen = [], [], set()
    for i, raw in enumerate(re.split(r"\r?\n", str(text or ""))):
        line = raw.strip()
        if not line:
            continue
        parts = [p.strip() for p in re.split(r"[;,\t]", line)]
        email_raw = parts[0] if parts else ""
        class_raw = parts[1] if len(parts) > 1 else ""
        name = re.sub(r"\s+", " ", " ".join(p for p in parts[2:] if p))[:100]
        email = email_raw.lower()
        row = i + 1
        if i == 0 and "@" not in email:
            continue  # fejléc
        if not EMAIL_RE.match(email):
            errors.append(f"{row}. sor: hibás email ({email_raw})")
            continue
        if email.split("@")[1] != domain:
            errors.append(f"{row}. sor: nem @{domain} cím ({email})")
            continue
        cls = normalize_class(class_raw)
        if not cls:
            errors.append(f"{row}. sor: hiányzik az osztály ({email})")
            continue
        if email in seen:
            errors.append(f"{row}. sor: ismétlődő cím ({email})")
            continue
        seen.add(email)
        voters.append({"email": email, "class": cls, "name": name})
    return voters, errors


def parse_email_list(text):
    """Vesszővel, pontosvesszővel vagy szóközzel elválasztott címek, ismétlés nélkül, sorrendtartóan."""
    out = []
    for s in re.split(r"[\s,;]+", str(text or "")):
        s = s.strip().lower()
        if "@" in s and s not in out:
            out.append(s)
    return out


def group_kind(name):
    """Osztály (pl. '9.A', '12.B') vagy egyéb csoport (pl. 'TANÁR')."""
    return "osztaly" if re.match(r"^\d{1,2}\.\S{1,3}$", name) else "csoport"
