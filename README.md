# Diáknapi szavazás

Elektronikus szavazórendszer a Dobó István Gimnázium (Eger) diáknapjára. Kiváltja a papíros szavazást és a több órás kézi számlálást, miközben megtartja a hitelességet.

- ✅ csak `@edig.hu` fiókkal, csak a névjegyzékben szereplő diákok
- ✅ csak aki a teremben van (30 mp-enként változó, kivetített jelenléti kód + QR)
- ✅ mindenki egyszer, anonim módon (a „ki szavazott” és a „mire” teljesen külön)
- ✅ eredmény csak lezárás után, automatikus ellenőrzéssel és nyomtatható jegyzőkönyvvel
- ✅ próbakör: szavazásonként kijelölhető, mely osztályok vesznek részt

📄 **[Részletes rendszerleírás](docs/RENDSZERLEIRAS.md)** · 🔧 **[Rendszergazdai teendők](docs/RENDSZERGAZDA.md)** · 🚀 **[Telepítés](docs/TELEPITES.md)** · 📝 **[Változások](CHANGELOG.md)**

> **Állapot:** prototípus (v0.2.1). Élesítés előtt próbakör szükséges.

## Kipróbálás (Google-fiók nélkül)

Kell hozzá: [Node.js](https://nodejs.org/) 22.13 vagy újabb (az LTS verzió jó). Natív fordítás nem kell, Windows-on is azonnal települ.

```bash
npm install
npm run demo
```

Ez egy demó adatbázist készít (45 teszt diák, 9 osztály, egy előkészített próbakör), és fejlesztői módban elindítja a szervert a http://localhost:3000 címen.

1. **Admin:** http://localhost:3000/admin → belépés `admin@edig.hu` → a próbakör **Megnyitás**
2. **Kivetítő:** http://localhost:3000/kiosk#demo → itt látszik a jelenléti kód és a QR
3. **Diák:** http://localhost:3000 (másik böngészőben vagy privát ablakban) → belépés pl. `diak1@edig.hu` → kód → szavazás
   - `diak1–5` (11.A) és `diak21–25` (9.B) szavazhat, a többi osztály nem része a próbakörnek
4. **Admin:** **Lezárás** → jegyzőkönyv (nyomtatás, JSON letöltés), igény szerint **Eredmény a kivetítőre**

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
docs/          rendszerleírás, rendszergazdai teendők
```

## Licenc

MIT
