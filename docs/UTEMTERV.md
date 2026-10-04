# Éves ütemterv és próbaszavazások – 2026/27-es tanév

**Cél:** a 2027-es diáknapon elektronikusan szavazzunk úgy, hogy addigra **mért adatokkal** igazoljuk: a rendszer legalább annyira hiteles és megbízható, mint a papír, és sokkal gyorsabb.

**Felelősség:** a digitalizációt a **DÖK képviseli** (DÖK-segítő pedagógus egyeztetése alapján). A rendszer fejlesztése és technikai támogatása: Járdán Milán.

---

## 1. Ütemterv

| Időszak | Mérföldkő | Ki | Eredmény |
|---|---|---|---|
| **2026. október** | Infótanárok bevonása: bemutató, kódátnézés megkezdése ([INFOTANAROKNAK.md](INFOTANAROKNAK.md)) | Milán, infótanárok | Átnézési jegyzet, javítandók listája |
| **2026. november** | Rendszergazda: tesztkörnyezet, Google-alkalmazás engedélyezése ([RENDSZERGAZDA.md](RENDSZERGAZDA.md)) | rendszergazda, Milán | Működő teszt-szerver `@edig.hu` belépéssel |
| **2026. november–december** | Vezetőségi bemutató: engedély a próbaszavazásokra | DÖK (+ Milán technikai kérdésekre) | Írásos/szóbeli engedély, kijelölt felelősök |
| **2026. december** | Infótanári javítások beépítése, adatkezelési tájékoztató egyeztetése | Milán, adatvédelmi felelős | v0.3, tájékoztató tervezet |
| **2027. január–február** | **1. próba:** kicsi, tét nélküli szavazás 1–3 osztállyal, csak elektronikusan | DÖK | 1. mérési jegyzőkönyv |
| **2027. március–április** | **2. próba:** iskolai szintű, alacsony tétű szavazás, **papír és elektronikus párhuzamosan** | DÖK, osztályfőnökök | 2. mérési jegyzőkönyv, összehasonlítás |
| **2027. május** | Értékelés a vezetőséggel, **döntés** a diáknapról (lásd 4. pont) | DÖK, vezetőség | Döntés: elektronikus / párhuzamos / papír |
| **2027. június** | Szükséges javítások, éles szerver előkészítése | Milán, rendszergazda | Megjelölt kiadás (pl. v1.0) |
| **2027. szeptember** | Új névjegyzék, rövid „főpróba” 1 osztállyal, eljárásrend véglegesítése | DÖK, rendszergazda | Kész eljárásrend, kinyomtatott tartalék-szavazólapok |
| **2027. október** | **Diáknap: éles elektronikus szavazás**, papír tartalékkal | mindenki | Aláírt jegyzőkönyv |

A pontos dátumokat az iskolai munkatervhez kell igazítani. A próbákhoz bármilyen valódi, de alacsony tétű szavazás jó: például farsangi téma, ballagási zene, diákparlamenti kérdés, menza- vagy rendezvényötlet.

## 2. Próbaszavazások

### 1. próba – „működik-e?”
- **Kik:** 1–3 osztály (kb. 30–90 diák), tanórán, tanár jelenlétében, kivetítővel.
- **Csak elektronikus**, nincs tét.
- **Kérdés, amire választ keresünk:** be tud-e lépni mindenki, érthető-e a folyamat, mennyi ideig tart egy osztálynak, mi akad el (Google-engedély, wifi, telefonok).

### 2. próba – „ugyanazt adja-e, mint a papír?”
- **Kik:** az egész iskola, vagy több évfolyam.
- **Párhuzamosan:** ugyanaz a kérdés papíron **és** elektronikusan. **A hivatalos eredmény a papíros**, az elektronikus mérés.
- A papírt a megszokott módon számolják, és **mérik a számlálás idejét**.
- **Kérdés:** egyezik-e a két eredmény sorrendje és aránya, mennyivel gyorsabb az elektronikus, mekkora a részvétel a kettőben.

> A két eredmény nem lesz szavazatra pontosan azonos, mert nem pontosan ugyanazok vesznek részt mindkettőben (hiányzó, aki csak az egyiken szavaz, elrontott papírlap). Ezért a sorrendet és az arányokat hasonlítjuk össze, és minden eltérésnek megkeressük az okát.

## 3. Mit mérünk?

A rendszer magától adja (jegyzőkönyv): jogosultak, szavazók, szavazatok száma, egyezés-ellenőrzés, részvétel osztályonként, nyitás–zárás időpontja.

Kézzel rögzítjük (felügyelő tanár / DÖK-ös, osztályonként egy sor):

| Mérőszám | Hogyan |
|---|---|
| Egy osztály szavazási ideje (perc) | stopper: a kód kivetítésétől az utolsó leadásig |
| Hány diák kért segítséget | strigulázás |
| A segítségkérés oka | belépés / Google-engedély / kód / wifi / telefon / egyéb |
| Hány diák nem tudott szavazni | és miért |
| Papíros számlálás ideje (2. próba) | a szavazás végétől a kész eredményig, résztvevők száma |
| Elektronikus lezárás ideje | a „Lezárás” gombtól a kinyomtatott jegyzőkönyvig |

Rövid kérdőív a diákoknak a próba után (3 kérdés, Google Forms): mennyire volt egyszerű (1–5), mennyi ideig tartott, megbízol-e benne, hogy titkos (1–5).

> **Fejlesztés az 1. próba előtt:** névtelen üzemi számlálók a rendszerben (pl. hány hibás kód, hány „nincs a névjegyzékben” eset). Csak darabszámok – se email, se időpont –, hogy az anonimitás ne sérüljön.

## 4. Mikor mondjuk, hogy kész? (döntési feltételek)

Javaslat a 2027. májusi döntéshez. **Mindegyiknek teljesülnie kell** az elektronikus diáknapi szavazáshoz:

| # | Feltétel | Mérés |
|---|---|---|
| 1 | A rendszer egyik próbán sem adott **eltérést** a szavazók és a szavazatok száma között | jegyzőkönyv egyezés-ellenőrzése |
| 2 | A 2. próbán a papíros és az elektronikus eredmény **sorrendje megegyezik**, az eltérések megmagyarázhatók | összehasonlító táblázat |
| 3 | A jelen lévő jogosultak legalább **95%-a** le tudta adni a szavazatát | jegyzőkönyv + kézi napló |
| 4 | Egy osztály szavazása **legfeljebb 10 perc** | kézi napló |
| 5 | Az infótanári átnézésből **nincs nyitott súlyos hiba** | átnézési jegyzet |
| 6 | Van **kijelölt üzemeltető** (nem érintett diák) és **jóváhagyott eljárásrend** | vezetőségi döntés |
| 7 | Az adatkezelési tájékoztató elkészült | adatvédelmi felelős |

Ha valamelyik nem teljesül, a diáknapon **papír + párhuzamos elektronikus** szavazás lesz (mint a 2. próbán), és a következő évben próbálkozunk újra.

## 5. Kockázatok az év során

| Kockázat | Mit teszünk |
|---|---|
| A Google-engedély a 18 év alattiaknál nem jön meg | Időben, novemberben kérjük; a tesztkörnyezettel kipróbáljuk |
| A wifi nem bír sok eszközt egyszerre | Osztályonkénti idősávok; a 2. próbán mérjük |
| A diákok nem bíznak a titkosságban | Kérdőív; nyílt forráskód; infótanári vélemény nyilvánosan |
| Milán nem elérhető (vizsgák, betegség) | Dokumentáció + infótanár, aki ismeri a rendszert; a rendszer üzemeltethető nélküle |
| Valaki megpróbálja kijátszani | Ez a 2. próbán kifejezetten jó: kiderül, és javítható a diáknap előtt |
