# Diáknapi szavazás

Elektronikus szavazórendszer a Dobó István Gimnázium (Eger) diáknapjára. Kiváltja a papíros szavazást és a több órás kézi számlálást, miközben megtartja a hitelességet.

- ✅ csak `@edig.hu` fiókkal, csak a névjegyzékben szereplő diákok
- ✅ csak aki a teremben van (30 mp-enként változó, kivetített jelenléti kód + QR)
- ✅ mindenki egyszer, anonim módon (a „ki szavazott” és a „mire” teljesen külön)
- ✅ eredmény csak lezárás után, automatikus ellenőrzéssel és nyomtatható jegyzőkönyvvel
- ✅ próbakör: szavazásonként kijelölhető, mely osztályok vesznek részt

📄 **[Részletes rendszerleírás](docs/RENDSZERLEIRAS.md)** · 🗓️ **[Ütemterv 2026/27](docs/UTEMTERV.md)** · 🧑‍🏫 **[Infótanároknak](docs/INFOTANAROKNAK.md)** · 🔐 **[Biztonsági terv](docs/BIZTONSAGI-TERV.md)** · 🛡️ **[Kiberbiztonság](docs/KIBERBIZTONSAG.md)** · 🔧 **[Rendszergazdai teendők](docs/RENDSZERGAZDA.md)** · 🚀 **[Telepítés](docs/TELEPITES.md)** · 📝 **[Változások](CHANGELOG.md)**

> **Állapot:** prototípus (v0.4). A szerver Pythonban készült, hogy az informatikatanárok át tudják nézni. Cél: a 2027-es diáknap, előtte két próbaszavazás mérésekkel.

## Kipróbálás (Google-fiók nélkül)

Kell hozzá: [Python](https://www.python.org/downloads/) 3.11 vagy újabb. Natív fordítás nem kell, Windows-on is azonnal települ.

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate      Linux/macOS:  source .venv/bin/activate
python -m pip install -r requirements.txt
python -m szavazas.demo
```

Ez egy demó adatbázist készít (9 osztály névvel és osztályfőnökkel, tanári csoport, egy előkészített szavazás jelenlét-ellenőrzéssel), és fejlesztői módban elindítja a szervert a http://localhost:3000 címen.

1. **Admin:** http://localhost:3000/admin → belépés `admin@edig.hu` → a szavazás **Megnyitás**. Itt kezelhetők az osztályok, csoportok, osztályfőnökök és tagok is.
2. **Osztályfőnök** (telefonon is): http://localhost:3000/tanar → belépés pl. `ofo.9a@edig.hu` → a saját osztály névsora, koppintással jelölhető a jelenlét. A tanári csoport felelőse `igazgatohelyettes@edig.hu`.
3. **Kivetítő:** http://localhost:3000/kiosk#demo (osztályfőnökként belépve kulcs nélkül is)
4. **Diák:** http://localhost:3000 (másik böngészőben vagy privát ablakban) → belépés pl. `diak16@edig.hu` (9.A) → kód → szavazás
   - csak az szavazhat, akit az osztályfőnöke jelennek jelölt
   - a DÖK szabálya szerint a versengő 11. évfolyam nem szavaz: `diak1–15` (11.A–C) nem tud szavazni
5. **Admin:** **Lezárás** → jegyzőkönyv (nyomtatás, JSON letöltés), igény szerint **Eredmény a kivetítőre**

### Szerepkörök

| Szerepkör | Ki | Mit lát / mit tud |
|---|---|---|
| **Admin** | az `ADMIN_EMAILS` címei (pl. rendszergazda, igazgató) | mindent: osztályok, csoportok, osztályfőnökök, tagok, szavazások, lezárás, jegyzőkönyv |
| **Osztályfőnök / csoportfelelős** | akit az admin egy osztályhoz vagy csoporthoz rendel | csak a saját osztályát: névsor, reggeli jelenlét, ki szavazott már (azt nem, hogy kire) |
| **Szavazó** | a névjegyzék tagjai (diákok, tanárok) | a saját szavazólapját |

A jegyzőkönyv-fájl ellenőrzése: `python -m szavazas.ellenorzes jegyzokonyv-1.json <lenyomat>`

> Fejlesztői módban (`DEV_LOGIN=1`) bárki beléphet tetszőleges címmel. **Élesben ez tilos.**

## Tesztek

```bash
python -m pip install -r requirements-dev.txt
python -m pytest
```

Többek között: teljes szavazási folyamat, dupla szavazás (50 egyidejű kéréssel is), próbakör-szűrés, hiányzók, jelenléti kód lejárata és zárolása, IP-szűrés, admin jogosultság, és hogy az adatbázisban nincs olyan tábla, ami a szavazót és a szavazatot összekötné.

## Éles futtatás

1. `cp .env.example .env`, és kitölteni (Google Client ID, adminok, titkos kulcsok)
2. `python -m pip install -r requirements.txt` és `python -m szavazas`
3. HTTPS mögé tenni (pl. Caddy), és `TRUST_PROXY=1` – részletesen: [docs/TELEPITES.md](docs/TELEPITES.md)

## Felépítés

```
szavazas/          a szerver (Python)
  __main__.py      indítás (python -m szavazas)
  app.py           végpontok, jogosultság, szavazás tranzakciója
  db.py            adatmodell (SQLite)
  jelenlet.py      jelenléti kód (TOTP-szerű)
  auth.py          Google-token ellenőrzése
  nevjegyzek.py    névjegyzék beolvasása
  config.py        beállítások (.env)
  demo.py          demó adatok + indítás
  ellenorzes.py    jegyzőkönyv-ellenőrző
public/            szavazóoldal, kivetítő, admin (sima HTML + CSS + JS, nincs build)
deploy/            systemd szolgáltatás, Caddy konfiguráció
tests/             automata tesztek
requirements.txt   függőségek, rögzített verziókkal
docs/          rendszerleírás, ütemterv, infótanári és rendszergazdai útmutató, telepítés
```

## Licenc

MIT
