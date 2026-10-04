# Diáknapi szavazás

Elektronikus szavazórendszer a Dobó István Gimnázium (Eger) diáknapjára. Kiváltja a papíros szavazást és a több órás kézi számlálást, miközben megtartja a hitelességet.

- ✅ csak `@edig.hu` fiókkal, csak a névjegyzékben szereplő diákok
- ✅ csak aki a teremben van (30 mp-enként változó, kivetített jelenléti kód + QR)
- ✅ mindenki egyszer, anonim módon (a „ki szavazott” és a „mire” teljesen külön)
- ✅ eredmény csak lezárás után, automatikus ellenőrzéssel és nyomtatható jegyzőkönyvvel
- ✅ próbakör: szavazásonként kijelölhető, mely osztályok vesznek részt

📄 **[Részletes rendszerleírás](docs/RENDSZERLEIRAS.md)** · 🗓️ **[Ütemterv 2026/27](docs/UTEMTERV.md)** · 🧑‍🏫 **[Infótanároknak](docs/INFOTANAROKNAK.md)** · 🔐 **[Biztonsági terv](docs/BIZTONSAGI-TERV.md)** · 🛡️ **[Kiberbiztonság](docs/KIBERBIZTONSAG.md)** · 🔧 **[Rendszergazdai teendők](docs/RENDSZERGAZDA.md)** · 🚀 **[Telepítés](docs/TELEPITES.md)** · 📝 **[Változások](CHANGELOG.md)**

> **Állapot:** prototípus (v0.3). Cél: a 2027-es diáknap, előtte két próbaszavazás mérésekkel.

## Kipróbálás (Google-fiók nélkül)

Kell hozzá: [Node.js](https://nodejs.org/) 22.13 vagy újabb (az LTS verzió jó). Natív fordítás nem kell, Windows-on is azonnal települ.

```bash
npm install
npm run demo
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

A jegyzőkönyv-fájl ellenőrzése: `npm run verify -- jegyzokonyv-1.json <lenyomat>`

> Fejlesztői módban (`DEV_LOGIN=1`) bárki beléphet tetszőleges címmel. **Élesben ez tilos.**

## Tesztek

```bash
npm test
```

Többek között: teljes szavazási folyamat, dupla szavazás (50 egyidejű kéréssel is), próbakör-szűrés, hiányzók, jelenléti kód lejárata és zárolása, IP-szűrés, admin jogosultság, és hogy az adatbázisban nincs olyan tábla, ami a szavazót és a szavazatot összekötné.

## Éles futtatás

1. `cp .env.example .env`, és kitölteni (Google Client ID, adminok, titkos kulcsok)
2. `npm install --omit=dev && npm start`
3. HTTPS mögé tenni (pl. Caddy), és `TRUST_PROXY=loopback` – részletesen: [docs/TELEPITES.md](docs/TELEPITES.md)

## Felépítés

```
src/
  server.js    indítás
  app.js       végpontok, jogosultság, szavazás tranzakciója
  db.js        adatmodell (SQLite)
  presence.js  jelenléti kód (TOTP-szerű)
  auth.js      Google-token ellenőrzése
  csv.js       névjegyzék beolvasása
public/        szavazóoldal, kivetítő, admin (sima HTML + JS, nincs build)
scripts/       demó adatok, jegyzőkönyv-ellenőrző
deploy/        systemd szolgáltatás, Caddy konfiguráció
test/          automata tesztek
docs/          rendszerleírás, ütemterv, infótanári és rendszergazdai útmutató, telepítés
```

## Licenc

MIT
