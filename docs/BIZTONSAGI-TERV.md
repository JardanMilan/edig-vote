# Biztonsági terv – a fennmaradó kockázatok kizárása

**Állapot:** terv, még nincs megvalósítva. Megvalósítás a próbaszavazások előtt (lásd 6. pont).

## 1. Cél

A v0.2 négy kockázata **figyelemre és bizalomra** épült: „a tanár figyel”, „az üzemeltető nem érintett diák”. Ez a terv ezeket **szerkezeti** megoldásokra cseréli. Utána egyik sem múlik azon, hogy valaki ügyes vagy jó szándékú.

A mérce a papír. Papíron is kijátszható a szavazás, ha **több ember összejátszik**. Ha például a névsort aláírató és az urnát kezelő ember egyezteti, ki milyen sorrendben dobott, az urnában lévő lapok sorrendjéből kideríthető, ki mire szavazott. A cél ezért az, hogy **egyetlen ember egyedül semmit ne tudjon megtenni**, és minden szabálytalanság a lezárás előtt kiderüljön.

## 2. A két új építőelem

### 2.1. Osztályülés

A szavazás osztályonként, **ülésekben** zajlik:

1. A felügyelő tanár a terem gépén a saját `@edig.hu` fiókjával **megnyitja az osztálya ülését**. A tanárok listáját az admin előre feltölti.
2. A kivetítőn megjelenő kód **csak ehhez az üléshez** tartozik: csak az osztály diákjai használhatják, csak amíg az ülés nyitva van, és csak az iskolai hálózatról.
3. A tanár gépén élőben látszik az **„aláírt névsor”**: kik szavaztak már az osztályból. Az nem látszik, hogy kire.
4. Az ülés végén a tanár **jóváhagyja** az ülést, ha minden név a teremben ülő diáké. Ha olyan név szerepel, aki nincs bent, vagy valaki azt jelzi, hogy helyette szavaztak, a tanár **érvényteleníti** az ülést. Ilyenkor az ülés összes szavazata kimarad, és az osztály papíron szavaz újra.
5. Egy ülés szavazatai **csak jóváhagyás után** kerülnek a végeredménybe.

Így egy osztály **vagy teljesen elektronikusan, vagy teljesen papíron** szavaz. A kettő soha nem keveredik, ezért nem lehet dupla szavazat.

### 2.2. Kettéválasztott hitelesítő és urna (vak aláírás)

A mostani egy szerver helyett **kettő** lesz, **két különböző kezelővel** (pl. a rendszergazda és egy informatikatanár):

| | **Hitelesítő** | **Urna** |
|---|---|---|
| Mit tud? | Ki jogosult, ki kapott szavazójegyet (a névsor) | Melyik szavazójegyre mi a szavazat |
| Mit **nem** tud? | Mire szavaztak | Ki szavazott |
| Ki kezeli? | pl. rendszergazda | pl. informatikatanár |

A folyamat a **vak aláírásra** épül (RSA Blind Signatures, szabványa az [RFC 9474](https://www.rfc-editor.org/rfc/rfc9474)). A megvalósításhoz a Cloudflare nyílt forráskódú, karbantartott könyvtára használható ([`@cloudflare/blindrsa-ts`](https://github.com/cloudflare/blindrsa-ts)):

1. A diák böngészője titokban létrehoz egy **szavazójegyet**: véletlen azonosító és egy hozzá tartozó egyszer használatos aláírókulcs.
2. A böngésző a jegyet **elvakítja**, és elküldi a Hitelesítőnek a belépéssel és a jelenléti kóddal együtt.
3. A Hitelesítő ellenőrzi a jogosultságot, beírja a diákot a névsorba, és **aláírja az elvakított jegyet**. Magát a jegyet nem látja, csak egy értelmezhetetlen számot.
4. A böngésző kibontja az aláírást. Ekkor van egy **érvényes, aláírt jegye, amit a Hitelesítő soha nem látott**.
5. A böngésző a jegyet, az aláírást és a szavazatot (a jegy kulcsával aláírva) **az Urnának** küldi.
6. Az Urna ellenőrzi az aláírást, és hogy a jegyet még nem használták. Mivel a jegy névtelen, az Urna **nem tudja, ki szavazott**.

**Minden osztályülés saját aláírókulcsot kap.** Ebből következik, hogy:
- az Urna tudja, melyik üléshez tartozik egy szavazat, így egy ülés egészében érvényteleníthető;
- egy érvénytelenített ülés jegyeit az Urna nem fogadja el, így egy régi jegy sem használható fel újra;
- ülésenként össze lehet vetni: **kiadott jegyek száma (Hitelesítő) = beérkezett szavazatok száma (Urna) = a tanár által igazolt létszám**.

## 3. Mit old meg ez? (a 7. dia kockázatai)

| Kockázat | Mi történik az új rendszerben | Ki tudná mégis megtenni? |
|---|---|---|
| **A kódot továbbküldik valakinek, aki nincs bent** | A kód csak az osztály saját ülésében, iskolai wifiről érvényes. Aki mégis szavaz, a neve megjelenik a tanár névsorában, az ülés érvénytelen lesz, és az osztály papíron szavaz. Az elkövető neve is kiderül. | Senki észrevétlenül |
| **Más nevében szavaz valaki** | Hiányzó nevében nem lehet. Jelen lévő diák nevében a név a tanárnál megjelenik, a diák pedig a saját telefonján azt látja, hogy „Már szavaztál”. Az ülés érvénytelen lesz, és az osztály papíron szavaz. | Senki észrevétlenül |
| **Az üzemeltető összeköti, ki mire szavazott** | A Hitelesítő nem látja a szavazatot, az Urna nem látja a nevet. Az összekötéshez **két különböző kezelőnek** kellene összejátszania, és mindkét szervert titokban módosítania kellene. | Csak két ember összejátszásával, mint papíron |
| **Az üzemeltető hamis szavazatot tesz az urnába, vagy átír egyet** | Hamis jegyet nem tud készíteni a Hitelesítő aláírása nélkül. Átírni sem tud, mert minden szavazat a jegy saját kulcsával alá van írva. Ha szavazatot töröl, ülésenként nem egyezik a jegyek és a szavazatok száma. | Senki észrevétlenül |
| **Leáll az internet vagy egy szerver** | Az éppen futó ülés nem kerül jóváhagyásra, az osztály papíron szavaz. A már jóváhagyott ülések szavazatai adatbázisban vannak, nem vesznek el. | Nem okoz hibás eredményt, csak papírt egy-két osztálynál |

## 4. Lezárás és ellenőrzés

A lezáráskor a tanúk egy **ellenőrző programot** futtatnak, ami a mostani `npm run verify` kibővítése. A program:
- minden szavazaton ellenőrzi a Hitelesítő aláírását és a jegy saját aláírását;
- ülésenként összeveti a kiadott jegyek számát, a szavazatok számát és a tanár által igazolt létszámot;
- újraszámolja az eredményt, és hozzáadja a papíron szavazó osztályok eredményét;
- kiírja a jegyzőkönyv lenyomatát.

A szavazatok listáját **nem tesszük nyilvánossá**. Ha mindenki láthatná a saját jegyét és szavazatát, akkor egy diák meg tudná mutatni egy kampányoló osztálynak, hogy kire szavazott. Ez nyomásgyakorlásra adna lehetőséget. Az ellenőrzést ezért a tanúk végzik.

## 5. Ami megmarad, őszintén

- **Két kezelő összejátszása.** Ha a Hitelesítő és az Urna kezelője összejátszik, és mindkét szervert titokban átírja úgy, hogy időpontokat naplózzon, elvben összeköthetik a szavazókat a szavazatokkal. Ez ugyanaz a szint, mint papíron: ott is két ember összejátszása kell hozzá. Csökkenti a kockázatot, hogy a szerverek csak a nyilvános, megjelölt kódverzióból futnak, és a szavazás alatt senki nem lép be rájuk.
- **Osztályonkénti részeredmény.** Az Urna kezelője látja, hogy egy osztályülésben hogyan oszlottak meg a szavazatok. Ez a papíron osztályonként számolt urna szintje, egyéni szavazatot nem fed fel.
- **Az érvénytelenítés visszaélhető.** Egy diák szándékosan „kívülről” szavazhat, hogy az osztálya papíron szavazzon újra. Ezzel csak időt veszít az osztály, az eredmény nem sérül, és a diák neve kiderül.

## 6. Megvalósítás

| Lépés | Tartalom | Mikor |
|---|---|---|
| 1. | **Osztályülés:** tanári fiókok, ülés megnyitása és zárása, élő névsor, jóváhagyás vagy érvénytelenítés, papíros osztályeredmény rögzítése | 2026. december, az 1. próba előtt |
| 2. | **Kettéválasztás:** Hitelesítő és Urna külön szolgáltatásként, vak aláírás a böngészőben és a szerveren, ülésenkénti kulcsok | 2027. január–február, a 2. próba előtt |
| 3. | **Ellenőrző program** a tanúknak, bővített jegyzőkönyv | a 2. lépéssel együtt |
| 4. | **Infótanári átnézés** a kriptográfiai részre | a 2. próba előtt |

Ez a legnagyobb fejlesztés az egész projektben, különösen a 2. lépés. Az ütemterv ezért így módosul: az **1. próba** már osztályülésekkel megy, a **2. próba** a teljes, kettéválasztott rendszerrel.

### Eldöntendő kérdések
1. Ki kezeli a Hitelesítőt és ki az Urnát? Két különböző ember kell, egyikük sem lehet érintett diák.
2. A jelenlétet a tanár szemre ellenőrzi a névsor alapján, vagy a KRÉTA óra eleji jelenléti adatából?
3. Papíron újraszavazó osztálynál ki számol? Javaslat: a felügyelő tanár és egy DÖK-tag, a lezáráskor a tanúk előtt.
