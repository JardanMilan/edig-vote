"""Jegyzőkönyv ellenőrzése: kiszámolja a letöltött JSON SHA-256 lenyomatát, és kiírja a lényeget.

Használat:  python -m szavazas.ellenorzes jegyzokonyv-1.json [várt-lenyomat]
Ha a kinyomtatott és aláírt jegyzőkönyvön szereplő lenyomat egyezik, a fájl tartalma nem változott.
Csak a Python beépített moduljait használja, a szerver nélkül is futtatható.
"""

import hashlib
import json
import sys


def main(argv):
    if not argv:
        print("Használat: python -m szavazas.ellenorzes <jegyzokonyv.json> [várt lenyomat]", file=sys.stderr)
        return 2
    with open(argv[0], "rb") as f:
        raw = f.read()
    digest = hashlib.sha256(raw).hexdigest()
    p = json.loads(raw.decode("utf-8"))

    print(f"Szavazás:    {p['name']}{' (próbakör)' if p['isTrial'] else ''}")
    print(f"Lezárva:     {p['closedAt']}")
    print(f"Jogosult:    {p['eligibleCount']}   Szavazott: {p['votedCount']}   Szavazat: {p['ballotCount']}")
    ok = p["votedCount"] == p["ballotCount"] and p["consistent"]
    print(f"Egyezés:     {'RENDBEN' if ok else 'ELTÉRÉS!'}")
    print("Eredmény:")
    for r in p["results"]:
        print(f"  {r['count']:>5}  {r['label']}")
    total = sum(r["count"] for r in p["results"])
    if total != p["ballotCount"]:
        print(f"  FIGYELEM: a jelöltenkénti összeg ({total}) nem egyezik a szavazatszámmal!")
    print(f"\nSHA-256:     {digest}")

    if len(argv) > 1:
        match = argv[1].strip().lower() == digest
        print("A lenyomat EGYEZIK a megadottal." if match else "A lenyomat NEM egyezik – a fájl eltér az eredetitől!")
        return 0 if match else 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
