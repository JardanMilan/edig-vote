# Útmutató az informatikatanároknak

Köszönöm, hogy ránéznek. A célom nem az, hogy jóváhagyják, hanem hogy **megtalálják a hibáit**, mielőtt egy valódi szavazáson derülnének ki. Minden észrevétel jól jön: kód, biztonság, használhatóság, eljárás.

– Járdán Milán

---

## 1. Röviden

Webes szavazórendszer a diáknapra. A diák az `@edig.hu` Google-fiókjával lép be, beírja a teremben kivetített, 30 másodpercenként változó kódot (vagy beolvassa a QR-t), majd egy osztályra szavaz.

| | |
|---|---|
| Nyelv, keretrendszer | Node.js 22+, Express 5 |
| Adatbázis | SQLite (a Node beépített `node:sqlite` modulja), egyetlen fájl |
| Frontend | sima HTML + JS, nincs build lépés |
| Függőségek | 3 db: `express`, `google-auth-library`, `qrcode` |
| Méret | kb. 2000 sor (tesztekkel együtt) |
| Tesztek | 24 automata teszt, GitHub Actions: Linux + Windows, Node 22 és 24 |
| Forráskód | https://github.com/JardanMilan/edig-vote |

## 2. Kipróbálás 5 perc alatt

```bash
git clone https://github.com/JardanMilan/edig-vote.git
cd edig-vote
npm ci
npm test        # automata tesztek
npm run demo    # demó szerver Google nélkül: http://localhost:3000
```

A lépéseket a README írja le (`/admin` → Megnyitás, `/kiosk#demo`, majd diákként belépés privát ablakban).

## 3. A lényeg 5 állításban – kérem, ezeket próbálják megcáfolni

1. **Csak jogosult szavazhat.** Google ID token szerveroldali ellenőrzése (aláírás, audience, `hd` = `edig.hu`, igazolt email), utána névjegyzék, hiányzás, próbakör-szűrés.
   → `src/auth.js`, `eligibility()` az `src/app.js`-ben
2. **Mindenki legfeljebb egyszer.** A `voted` tábla elsődleges kulcsa `(election_id, email)`. A „szavazott” jelölés és a számláló növelése egy `BEGIN IMMEDIATE` tranzakció.
   → `castVote` az `src/app.js`-ben, `db.transaction` az `src/db.js`-ben
3. **Anonim.** Nincs szavazatonkénti sor: a `tally` táblában csak jelöltenkénti számláló van. A `voted` tábla `WITHOUT ROWID`, időbélyeg nélkül. Nincs olyan tábla, amelyben email és jelölt együtt szerepel; ezt teszt is ellenőrzi. A kéréstörzsek nincsenek naplózva.
   → `src/db.js` (séma), „anonimitás” teszt
4. **Csak aki a teremben van.** TOTP-szerű kód: `HMAC-SHA256(secret, election_id, időablak)`. Az aktuális és az előző ablak fogadható el. Diákonként 5 hiba után 5 perc zárolás. QR esetén a beolvasás időpontja aláírt sütiben, egyszer használható.
   → `src/presence.js`, `/api/presence` és `/api/presence/scan`
5. **Az eredmény lezárásig senkinek sem látható**, adminnak sem. Lezáráskor jegyzőkönyv készül SHA-256 lenyomattal, ami letöltés után külön script-tel ellenőrizhető.
   → `/elections/:id/close`, `scripts/verify-protocol.js`

## 4. Ismert korlátok (ezekről tudok)

| Korlát | Miért így |
|---|---|
| Egy bent lévő diák továbbküldheti a kódot egy otthon lévőnek | Kódból nem védhető ki teljesen; az IP-szűrés (`ALLOWED_IPS`) vagy a felügyelt szavazás véd ellene |
| Aki a szavazás **alatt** közvetlenül hozzáfér a szerverhez, időzítésből következtethet | Az üzemeltetőbe vetett bizalom kérdése; ezért nem érintett diák üzemelteti |
| A hibás kódok számlálója memóriában van, újraindításkor nullázódik | Egyszerűség; az újraindítás amúgy is ritka és naplózott |
| Nincs IP alapú korlát a belépésre | Az egész iskola egy NAT-olt IP-ről jön, ez a jogos diákokat zárná ki |
| Az ügyeletes admin látja, **hogy** valaki szavazott-e | Szándékos: ez a papíros aláírt névsor megfelelője. Azt, hogy **kire**, nem látja |
| A szerver egy példányban fut, egy SQLite-fájllal | 550 főhöz bőven elég; vízszintes skálázásra nincs szükség |

A korlátok első háromra már van terv: osztályülés + kettéválasztott hitelesítő és urna vak aláírással ([BIZTONSAGI-TERV.md](BIZTONSAGI-TERV.md)). **Erre a tervre különösen kíváncsi vagyok, mielőtt megírom.**

## 5. Mit kérnék?

Amire az idő engedi. Akár csak egy pont is sokat segít:

- [ ] **Kódátnézés:** `src/app.js` (végpontok, jogosultság), `src/presence.js`, `src/db.js`
- [ ] **Biztonság:** hitelesítés megkerülése, CSRF, XSS az admin felületen, munkamenet-kezelés, sütik
- [ ] **Anonimitás:** van-e olyan adat (napló, sorrend, méret, időzítés), amiből utólag kiderülhet, ki mire szavazott?
- [ ] **Hiányzó teszt:** milyen esetet nem fed le a `test/app.test.js`?
- [ ] **Eljárás:** a [rendszerleírás](RENDSZERLEIRAS.md) 7. fejezete (hitelesség, lezárás, jegyzőkönyv) életszerű-e?

Visszajelzés: GitHub issue a repóban, vagy szóban / emailben nekem.

## 6. Ötlet: diák „red team” óra

Ha van rá lehetőség, informatikaórán a diákok megpróbálhatnák **kijátszani** a rendszert. Ez jó tanóra is, és a rendszernek is a legjobb teszt.

**Szabályok:**
- **Csak a külön, erre indított tesztpéldányon**, soha nem éles szavazáson és nem az iskolai rendszereken.
- Csak teszt-névjegyzékkel (kitalált címekkel), Google nélküli demó módban.
- A talált hibát leírják: mit csináltak, mi történt, mit vártak volna.
- Nem cél semmi, ami más szolgáltatást (Google, iskolai hálózat) érint.

**Feladatötletek:**
1. Szavazz kétszer ugyanazzal a fiókkal.
2. Szavazz úgy, hogy nem látod a kivetítőt.
3. Derítsd ki az adatbázisból, ki kire szavazott (az adatbázisfájlt megkapják).
4. Nézd meg az eredményt a lezárás előtt.
5. Juss be az admin felületre diákfiókkal.

A sikeres támadásokból hibajegy lesz, a javítás után pedig új teszt, hogy ne forduljon elő újra.
