# Biztonsági terv – a fennmaradó kockázatok kizárása

**Állapot:** terv, még nincs megvalósítva. Megvalósítás a próbaszavazások előtt (lásd 6. pont).

## 1. Cél

A v0.2 négy kockázata **figyelemre és bizalomra** épült: „a tanár figyel”, „az üzemeltető nem érintett diák”. Ez a terv ezeket **szerkezeti** megoldásokra cseréli. Utána egyik sem múlik azon, hogy valaki ügyes vagy jó szándékú.

A mérce a papír. Papíron is kijátszható a szavazás, ha **több ember összejátszik**. Ha például a névsort aláírató és az urnát kezelő ember egyezteti, ki milyen sorrendben dobott, az urnában lévő lapok sorrendjéből kideríthető, ki mire szavazott. A cél ezért az, hogy **egyetlen ember egyedül semmit ne tudjon megtenni**, és minden szabálytalanság a lezárás előtt kiderüljön.

## 2. A két új építőelem

### 2.0. Eszköz: saját telefon, „Kahoot-szerűen”

**Döntés:** a diákok a **saját telefonjukon** szavaznak, az osztályteremben, a kivetített kód (vagy QR) beírásával. Ez ugyanaz a forma, mint egy tanórai Kahoot-játék. A többi lehetőséget ezért vetettük el:

| | Miért nem |
|---|---|
| Szavazófülke a tanári gépen | Lassú, és a takarás nehezen megoldható |
| Gépterem | Két gépterembe egyszerre egy osztály fér be, 14 osztálynál ez túl sok idő |
| Iskolai wifi | Diákoknak nem használható (több hálózat, MAC-cím szűrés), ezért **mobilnet** kell |

**Telefontilalom.** A [245/2024. (VIII. 8.) Korm. rendelet](https://njt.hu/jogszabaly/2024-245-20-22) szerint a pedagógus **pedagógiai célból** engedélyezheti az okoseszköz használatát. A célt és az időtartamot a KRÉTA-ban rögzíteni kell. A javasolt eljárás:
- A szavazás idejére (kb. 12:00–12:20) az osztályfőnök kiadja a telefonokat, és a KRÉTA-ban rögzíti: **cél:** „diáknapi elektronikus szavazás (DÖK, közösségi döntéshozatal)”, **időtartam:** a szavazás ideje. Utána a telefonokat visszaszedi.
- Hogy ez pedagógiai célnak számít-e, arról **a vezetőség dönt**. Mellette szól, hogy ugyanaz a forma, mint egy tanórai Kahoot, és a diákönkormányzati részvétel a közösségi nevelés része. Ha szükséges, a házirendben is rögzíthető.

**Akinek nincs telefonja,** az egy osztálytársa telefonján szavaz, **a saját fiókjával, privát (inkognitó) lapon**. Így a fiókja nem marad bejelentkezve a másik telefonján. A rendszer szavazás után kilépteti, és erre a belépő oldalon és a végén is figyelmeztet.

**Következmény a hálózatra:** mobilnet miatt a szerver az internetről érhető el, és iskolai IP-címre szűrni sem lehet. Hogy csak az szavazhasson, aki bent van, azt a **jelenléti lista** biztosítja (2.1), nem a hálózat. A kiberbiztonsági következményeket a [KIBERBIZTONSAG.md](KIBERBIZTONSAG.md) 2. pontja írja le.

### 2.1. Osztályülés: jelenlét reggel, szavazás a programok után

A diáknap reggel osztályfőnöki órával kezdődik, a szavazás viszont **12–13 óra körül, a programok után** van, hogy a diákok előbb minden programot lássanak. Ezért a jelenlét és a szavazás két lépés:

1. **Reggel – belépés.** Az osztályfőnök telefonon vagy laptopon a saját `@edig.hu` fiókjával belép, és **csak a saját osztályát** látja. A tanár–osztály párosítást az admin előre beállítja. *(Kész, v0.3.)*
2. **Reggel – jelenlét, egy kattintás hiányzónként.** A tanár az osztály **névsorát** látja (neveket, nem emailcímeket). Kikattintja a hiányzókat, majd egy gombbal mindenki mást jelennek jelöl. Papíron semmit nem kell gyűjteni. A szavazás ekkor még nem indult el, senki nem tud szavazni. *(Kész, v0.3.)*
3. **12 körül – ellenőrzés és indítás.** A szavazás előtt az osztályfőnök átnézi a listát, és kiveszi, aki közben hazament. Ezután indul a szavazás, és **csak a jelennek jelöltek** szavazhatnak. A jelenlét szavazás közben is javítható, de aki már szavazott, nem jelölhető hiányzónak. *(Kész, v0.3: a jelenlét javítható, a szavazást az admin nyitja meg.)*
4. **Kivetítés.** A kivetítőn a kód és a QR-kód látszik, alatta **a névsor**: ki szavazott már ✓, ki még nem. Azt, hogy kire szavazott, sehol nem mutatja. Ez a papíros aláírt névsor megfelelője, és a tanár egy pillantással látja, ki van még hátra.
5. **Zárás.** Ha mindenki végzett, a tanár lezárja és jóváhagyja az ülést. Ha valami nem stimmel, például egy diák szól, hogy „Már szavaztál” üzenetet kapott, pedig nem szavazott, a tanár **érvényteleníti** az ülést. Ilyenkor az osztály szavazatai kimaradnak, és az osztály papíron szavaz újra.

**Miért zárja ki ez a visszaéléseket?**
- **Otthonról szavazás:** aki nincs bent, azt a tanár hiányzónak jelöli, így nem tud szavazni, még ha valaki át is küldi neki a kódot.
- **Más osztályból szavazás:** a kód és az ülés csak egy osztályé.
- **Más nevében szavazás:** a hiányzók nevében nem lehet. Ha egy jelen lévő diák nevében szavaz valaki, a diák a saját telefonján azonnal látja, hogy „Már szavaztál”, és a neve a kivetítőn is pipát kap. Ilyenkor az ülést érvénytelenítik.
- **A kód szerepe ezek után:** a fő védelem a jelenléti lista. A kód és a QR mégis marad, mert QR-ral gyorsabb a belépés, és plusz akadály annak, aki valaki más jelszavával próbálkozna.

Egy osztály így **vagy teljesen elektronikusan, vagy teljesen papíron** szavaz, a kettő soha nem keveredik.

> A névjegyzékhez ezért a **nevek** is kellenek, nem csak az emailcímek. A Google Admin felhasználói exportja tartalmazza őket (név, email, szervezeti egység), így a rendszergazdának ez nem jelent plusz munkát.

### 2.1.1. Tanárok

A tanárok is szavaznak. A névjegyzékben külön csoportként szerepelnek (pl. `TANÁR`), és **saját ülésük** van:

- A **tanári ülést** az igazgató vagy egy igazgatóhelyettes nyitja meg, például a tanáriban, kivetítővel vagy a saját gépén, ugyanúgy, mint egy osztályfőnök.
- A jelenlétet ő jelöli a tanári névsorban, és az ülést ő hagyja jóvá vagy érvényteleníti.
- Aki osztályfőnöki órát tart, a saját osztálya ülésének lezárása után szavaz a tanári ülésben. A diákok ülésében nem szavaz.

**Titkosság kis csoportnál.** A tanárok kevesen vannak, és ha a tanári ülésben csak néhányan szavaznak, a tanári részeredményből következtetni lehetne. Ezért a tanári szavazatokat **nem mutatjuk külön**, csak a végeredménybe számítanak bele. Ha egy ülésben kevés a szavazó, akkor egy másik üléssel összevonva kerül az összesítésbe.

**Szabályok (DÖK-döntés):**
- Egy tanári szavazat **ugyanannyit ér**, mint egy diáké, és ugyanúgy szavaznak, mint a diákok.
- A **versengő 11. évfolyam nem szavaz**, és az **osztályfőnökeik sem**. Minden más diák és tanár szavaz.
- A saját osztályra szavazás kérdése így nem merül fel.

> A mostani prototípusban ez már beállítható: a tanárok `TANÁR` „osztályként” kerülnek a névjegyzékbe (a 11. évfolyam osztályfőnökei nélkül), a szavazásnál pedig a 11. évfolyamon kívül minden osztály és a `TANÁR` csoport van kijelölve. A demó is így indul.

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
| **A kódot továbbküldik valakinek, aki nincs bent** | Aki nincs bent, azt az osztályfőnök hiányzónak jelöli, így a kóddal sem tud szavazni. Aki mégis szavaz, a neve megjelenik a tanár névsorában, az ülés érvénytelen lesz, és az osztály papíron szavaz. Az elkövető neve is kiderül. | Senki észrevétlenül |
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
| 1. | **Osztályülés:** ✅ *kész (v0.3):* osztályok és csoportok, osztályfőnökök hozzárendelése, külön osztályfőnöki felület, reggeli jelenlét jelölőnégyzetekkel, csak a jelennek jelöltek szavazhatnak, a tanár látja, ki szavazott már. *Hátra van:* ülés indítása és zárása osztályonként, névsor a kivetítőn, jóváhagyás vagy érvénytelenítés, papíros osztályeredmény rögzítése | 2026. december, az 1. próba előtt |
| 2. | **Kettéválasztás:** Hitelesítő és Urna külön szolgáltatásként, vak aláírás a böngészőben és a szerveren, ülésenkénti kulcsok | 2027. január–február, a 2. próba előtt |
| 3. | **Ellenőrző program** a tanúknak, bővített jegyzőkönyv | a 2. lépéssel együtt |
| 4. | **Infótanári átnézés** a kriptográfiai részre | a 2. próba előtt |

Ez a legnagyobb fejlesztés az egész projektben, különösen a 2. lépés. Az ütemterv ezért így módosul: az **1. próba** már osztályülésekkel megy, a **2. próba** a teljes, kettéválasztott rendszerrel.

### Eldöntendő kérdések
1. Ki kezeli a Hitelesítőt és ki az Urnát? Két különböző ember kell, egyikük sem lehet érintett diák.
2. Papíron újraszavazó osztálynál ki számol? Javaslat: a felügyelő tanár és egy DÖK-tag, a lezáráskor a tanúk előtt.
