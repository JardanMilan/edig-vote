# Változások

## Dokumentáció – 2026-10-04
- **Biztonsági terv** (`docs/BIZTONSAGI-TERV.md`): osztályülés (tanári jóváhagyás, ülésenkénti érvénytelenítés, osztályonként vagy elektronikus, vagy papír) és kettéválasztott hitelesítő + urna vak aláírással (RFC 9474). Kiváltja a figyelemre és bizalomra épülő védekezést.
- Új cél: a **2027-es diáknap**. Éves ütemterv két próbaszavazással, mérőszámokkal és előre rögzített döntési feltételekkel: `docs/UTEMTERV.md`.
- Útmutató az informatikatanároknak (átnézés, ismert korlátok, diák red team óra): `docs/INFOTANAROKNAK.md`.
- Rendszergazdai teendők időzítve; rendszerleírás: tartalékterv pontosítva (egy szavazáson mindig egy hivatalos csatorna).

## v0.2.1 – 2026-09-29

### Javítva
- **Jegyzőkönyv nyomtatása:** üres oldal jött ki, mert a nyomtatási szabály a jegyzőkönyvet is elrejtette. Most csak a jegyzőkönyv kerül a papírra (a Nyomtatás gombbal és Ctrl+P-vel is), A4-es margóval, a színes sávokkal, és sötét módban is fehér háttérrel.

## v0.2.0 – 2026-09-29

### Javítva
- **Kód szóközzel:** a kivetítőn „947 969” formában látszó kód szóközzel beírva levágódott. Most bármilyen formában beírható, 6 számjegy után magától továbblép.
- **QR-kód lejárt a Google-belépés alatt:** ha a belépés (fiókválasztás, jelszó) 30–60 mp-nél tovább tartott, a QR-ből érkező kód érvénytelen lett. Most a beolvasás pillanatát a szerver aláírva rögzíti, és a belépés után arra az időpontra ellenőriz (3 perc türelmi idő, egyszer használható, belépés nélkül nem lehet vele találgatni).
- **Közös gépek (gépterem):** szavazás után a diák bejelentkezve maradt. Most a szerver kilépteti, a Google automatikus belépését kikapcsolja, és figyelmeztet a Google-fiókból való kilépésre.
- **Windows-telepítés:** natív modul helyett a Node beépített SQLite-ja (v0.1.1).

### Új
- **Saját osztályra szavazás tiltása** szavazásonként beállítható; a szavazólapon a saját osztály letiltva látszik.
- **Ügyelet:** diák keresése az admin felületen – névjegyzékben van-e, hiányzó-e (egy kattintással javítható), szavazott-e már.
- **Eredmény a kivetítőre:** lezárás után az admin egy gombbal megjelenítheti (és leveheti) az eredményt a `/kiosk` oldalon.
- **Jegyzőkönyv JSON letöltése + ellenőrző:** `npm run verify -- jegyzokonyv-1.json <lenyomat>`.
- **Személyes adatok törlése** (GDPR) egy gombbal; a jegyzőkönyvek megmaradnak.
- **Előkészített szavazás törlése** (elírás esetén).
- Szavazóoldal magától frissül, amíg a szavazás el nem indul.
- Kivetítő: teljes képernyő gomb.
- `/healthz` állapotjelző, HSTS és X-Frame-Options fejlécek.
- GitHub Actions: tesztek minden változtatásnál Linuxon és Windowson, Node 22 és 24 alatt.
- Telepítési útmutató (systemd + Caddy).

### Ellenőrzések
- Nem nyitható meg szavazás 0 jogosulttal.
- Próbakörben csak a névjegyzékben létező osztály adható meg.

## v0.1.0 – 2026-09-29
- Első prototípus: Google-bejelentkezés (@edig.hu), névjegyzék, hiányzók, jelenléti kód + QR, anonim tárolás, egy tranzakciós szavazás, próbakör, jegyzőkönyv SHA-256 lenyomattal.
