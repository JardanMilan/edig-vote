# Kiberbiztonsági terv

A [biztonsági terv](BIZTONSAGI-TERV.md) arról szól, hogyan nem lehet csalni a **szabályok szerint használt** rendszerben. Ez a dokumentum arról, hogy mi van, ha valaki **magát a rendszert támadja**: az iskolából vagy kívülről, a szavazás alatt vagy előtte.

**Kiinduló feltételezés:** lesz, aki megpróbálja. Egy iskolai szavazásnál ez valószínű, nem kivétel. A cél ezért az, hogy egy támadás **ne tudja megváltoztatni az eredményt**. A legrosszabb, amit elérhet, hogy néhány osztály papíron szavaz.

---

## 1. Kik támadhatnak, és mit akarhatnak?

| Támadó | Cél | Lehetőség |
|---|---|---|
| Diák az iskolai wifin | Plusz szavazat, más eredménye, „poén”, leállítás | Ugyanazon a hálózaton van, ideje és motivációja is van |
| Diák otthonról / külső személy | Ugyanez, vagy csak leállítás | Csak az interneten keresztül |
| Automatikus robotok | Bármilyen ismert sebezhetőség | Minden nyilvános szervert folyamatosan pásztáznak |
| Ellopott fiók (tanár vagy admin) | Ülés megnyitása, admin műveletek | Adathalászat, kiszivárgott jelszó |

## 2. Elérhetőség: a szerver az interneten van – ezért szűkítjük, mikor és kinek

A diákok **saját telefonon, mobilneten** szavaznak, mert az iskolai wifi diákoknak nem használható (lásd [BIZTONSAGI-TERV.md](BIZTONSAGI-TERV.md), 2.0). Ezért a szerver **az internetről elérhető**, és iskolai IP-címre sem lehet szűrni. A védekezés ezért a következőkre épül:

- **Időablak:** a diákok számára a szavazás csak a megnyitás és a lezárás között, nagyjából 12 és 13 óra között él. Előtte és utána a szavazó végpontok semmit nem fogadnak el.
- **Belépés nélkül semmi nem érhető el:** minden érdemi művelethez `@edig.hu` Google-belépés kell. Egy külső támadó csak a nyitóoldalt és a belépési kérést látja.
- **Túlterhelés ellen:** a szerver egy olyan szolgáltatónál fusson, amelyik alapból véd a DDoS ellen (a nagyobb VPS-szolgáltatók ilyenek). Ha mégis elérhetetlenné válik, a még nem szavazott osztályok papíron szavaznak, és a már leadott szavazatok megmaradnak.
- **Admin és osztályfőnöki felület:** Google-belépés, kötelező kétlépcsős azonosítás a tanári fiókokon, és minden művelet naplózva van.

> A korábbi javaslat (belső hálózaton futó, kívülről elérhetetlen szerver) erősebb lenne, de mobilnetes szavazással nem működik. Ha egyszer az iskolai wifi diákoknak is elérhető lesz, érdemes visszatérni rá.

## 3. Támadások és védekezés

**Állapot:** ✅ kész · 🔧 tervezett

### 3.1. Belépés és jogosultság
| Támadás | Védekezés | |
|---|---|---|
| Hamis Google-belépés, idegen fiók | A Google-token aláírásának, címzettjének és domainjének ellenőrzése a szerveren | ✅ |
| Jelszó-találgatás | A rendszerben nincs saját jelszó, minden belépés Google-lel történik, ezért nincs mit találgatni | ✅ |
| Ellopott tanári vagy admin fiók | **Kötelező kétlépcsős azonosítás** (2FA) a tanári és admin fiókokra a Google Admin Console-ban. Az admin csak az előre megadott címlistáról léphet be | 🔧 / ✅ |
| Diák admin műveletet próbál | Minden admin végpont szerveroldalon ellenőrzi a jogosultságot. Teszt is van rá | ✅ |
| Munkamenet ellopása | HttpOnly + Secure + SameSite=Strict süti. Az adatbázisban csak a munkamenet lenyomata van, így egy kiszivárgott adatbázisból sem lehet belépni | ✅ |

### 3.2. Webes támadások
| Támadás | Védekezés | |
|---|---|---|
| SQL-befecskendezés | Minden adatbázis-lekérdezés paraméterezett, szöveg-összefűzés nincs | ✅ |
| XSS (kártékony szkript az oldalba) | Szigorú tartalombiztonsági szabály (CSP): idegen szkript nem futhat. Minden megjelenített adat escape-elve | ✅ |
| CSRF (más oldal a diák nevében küld kérést) | SameSite=Strict süti + csak JSON kérés fogadása | ✅ |
| Az oldal beágyazása, kattintás-eltérítés | X-Frame-Options: DENY, CSP frame-szabály | ✅ |
| Lehallgatás a wifin | Csak HTTPS, HSTS | ✅ |
| Túl nagy kérések | A kéréstörzs méretkorlátja **2 MB-ról ~100 KB-ra** csökkentve (a névjegyzék-feltöltés kivételével) | 🔧 |

### 3.3. Túlterhelés (DoS) az iskolán belülről
| Támadás | Védekezés | |
|---|---|---|
| Rengeteg kérés egy eszközről | **Kérésszám-korlát munkamenetenként és eszközönként.** IP alapú korlát nem működik, mert az egész iskola egy IP-ről jön | 🔧 |
| Kódtalálgatás | Diákonként 5 hiba után 5 perc zárolás | ✅ |
| A szerver leáll | Automatikus újraindulás (systemd). A jóváhagyott ülések szavazatai adatbázisban vannak, nem vesznek el. Az éppen futó ülés osztálya papíron szavaz | ✅ |
| A wifi elárasztása | A rendszergazda hatásköre (kliens-izoláció, eszköz kitiltása). Ellene a papíros tartalék véd | – |

### 3.4. Szerver és üzemeltetés
| Kockázat | Védekezés | |
|---|---|---|
| Ismert sebezhetőség egy függőségben | Csak 3 közvetlen függőség, rögzített verziók (lockfile). `npm audit` minden változtatásnál, heti frissítésjelzés (Dependabot) a GitHubon | ✅ |
| Ellopott szerver-hozzáférés | Belépés csak SSH-kulccsal, jelszavas belépés tiltva. Tűzfal: csak a 443-as port nyitott. Automatikus biztonsági frissítések | 🔧 (telepítési útmutatóba) |
| A szolgáltatás feltörése után a rendszer többi része | Külön, jogosultság nélküli felhasználó. A systemd korlátozza, hogy csak a saját adatmappájába írhat | ✅ |
| Titkos kulcsok kiszivárgása | Csak a szerveren, a `.env`-ben, jogosultsággal védve. A repóban soha | ✅ |
| Módosított kód fut a szerveren | Csak megjelölt, nyilvános verzió futhat. A lezáráskor a tanúk ellenőrizhetik, hogy a futó verzió megegyezik-e a megjelölttel | 🔧 |
| Az eredmény utólagos átírása | A jegyzőkönyv lenyomata ki van nyomtatva és aláírva, a kettéválasztott rendszerben a szavazatok is alá vannak írva | ✅ / 🔧 |

## 4. Felügyelet a szavazás alatt

- **Állapotjelző** (`/healthz`): a rendszergazda vagy az ügyeletes egy oldalon látja, hogy fut-e a szerver.
- **Riasztás** szokatlan forgalomra: sok elutasított kérés, sok hibás kód egy osztályban, vagy hirtelen terhelés. 🔧
- **Admin napló:** minden admin és tanári művelet naplózva van, ki és mikor. Szavazat soha nem kerül a naplóba.

## 5. Mi a teendő, ha támadás van? (incidens-terv)

1. **Az ügyeletes tanár vagy DÖK-tag azonnal szól** a rendszergazdának és Milánnak. A teendő nincs ráhagyva egy diákra.
2. **A futó ülések szüneteltetése:** az admin egy gombbal felfüggeszti az összes nyitott ülést. 🔧
3. **Ha nem hárítható el gyorsan:** a még nem szavazott osztályok **papíron** szavaznak. A már jóváhagyott ülések eredménye megmarad.
4. **Utána:** naplók mentése, jegyzőkönyv a történtekről, a hiba javítása és új teszt rá.

## 6. Ellenőrzés a próbák előtt

| Mit | Ki | Mikor |
|---|---|---|
| Kódátnézés, biztonsági szempontból | Infótanárok ([INFOTANAROKNAK.md](INFOTANAROKNAK.md)) | 2026. október–november |
| Automatikus sebezhetőség-keresés (pl. OWASP ZAP) a tesztszerveren | Milán, infótanár | az 1. próba előtt |
| **Diák „red team” óra:** diákok próbálják feltörni a tesztpéldányt, előre rögzített szabályokkal | Infótanár | az 1. és a 2. próba között |
| Túlterheléses próba: hány kérést bír a szerver | Milán | a 2. próba előtt |

A próbák alatt a támadási kísérletek **kifejezetten hasznosak**: ami ott kiderül, az a diáknap előtt javítható.
