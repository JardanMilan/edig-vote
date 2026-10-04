# Rendszergazdai teendők

Rövid lista – a cél, hogy ez a lehető legkevesebb munka legyen. **Sürgős nincs benne:** a cél a 2027-es diáknap, addig két próbaszavazás lesz ([UTEMTERV.md](UTEMTERV.md)).

## Mikor mi kell?

| Mikor | Mi | Becsült idő |
|---|---|---|
| 2026. november | Google-bejelentkezés engedélyezése (1. pont) | 15–30 perc |
| 2026. november | Döntés: hol fut a tesztszerver (4. pont) | egy beszélgetés |
| Minden próba előtt | Friss névjegyzék-export (2. pont) | 5 perc |
| A próbák napján | Elérhetőség telefonon, ha a wifi vagy a Google-belépés gondot okoz | – |
| 2027. szeptember | Az éles szavazás előtti névjegyzék, végleges szerver | 30 perc |

A szerver telepítését, frissítését és a hibakeresést Milán végzi; ehhez lépésről lépésre leírás is van: [TELEPITES.md](TELEPITES.md).

## 1. Google-bejelentkezés engedélyezése (kötelező)

A rendszer a „Bejelentkezés Google-fiókkal” funkciót használja, **csak alapadatokat kér** (`openid`, `email`, `profile`): nem fér hozzá a diákok Drive-jához, leveleihez vagy más adatához.

### 1a. OAuth kliens létrehozása
Ezt Milán is el tudja végezni, ha kap hozzá jogot – vagy a rendszergazda, pár kattintás:

1. Google Cloud Console → új projekt (pl. `diaknap-szavazas`) **az edig.hu szervezet alatt**.
2. *APIs & Services → OAuth consent screen*: User type = **Internal** (így csak edig.hu fiókkal lehet belépni, és nem kell Google-ellenőrzés).
3. *Credentials → Create credentials → OAuth client ID → Web application*
   - Authorized JavaScript origins: `https://<a szavazás címe>` (+ teszthez `http://localhost:3000`)
4. A kapott **Client ID**-t kell megadni a szervernek (`GOOGLE_CLIENT_ID`). Titkos kulcsra (client secret) nincs szükség.

> Ha a projekt nem az edig.hu szervezet alatt jön létre (hanem pl. személyes fiókban), akkor User type = External, és a consent screent **„In production”** állapotba kell tenni – „Testing” módban csak 100 előre felvett tesztfelhasználó léphet be.

### 1b. 18 év alatti felhasználók hozzáférése
A Workspace for Education a 18 év alattinak jelölt diákokat alapból letiltja a nem konfigurált külső alkalmazásokból. Két lehetőség:

- Ha az Admin Console-ban be van kapcsolva, hogy a 18 év alattiak használhatják a **csak alapadatokat kérő („Sign in with Google”) alkalmazásokat**, akkor **nincs teendő**.
- Egyébként: Admin Console → **App access control** → *Configure new app* / *Review apps* → a Client ID alapján az alkalmazás kiválasztása → szervezeti egységek (diákok) → **Limited** vagy **Trusted** → mentés.

⚠️ A Google szerint a változás **akár 24 óra** alatt lép életbe – ezért ezt érdemes elsőként elintézni.

## 2. Névjegyzék (kötelező, egyszeri)

Egy CSV kell a szavazásra jogosult diákokról, két oszloppal:

```
email;osztaly
kiss.anna@edig.hu;9.A
nagy.bence@edig.hu;11.C
```

Ha az osztályok szervezeti egységekként (OU) szerepelnek az Admin Console-ban, elég a **felhasználólista exportja** (*Users → Download users*) – ebből az átalakítást Milán elvégzi. Alternatíva: KRÉTA-export.

## 3. Opcionális: iskolai hálózat

Ha az iskolának **fix nyilvános IP-címe** van, azt megadva a szerver csak az iskolai hálózatról fogad szavazatot (`ALLOWED_IPS`). Ehhez kérdés még: bírja-e a wifi, ha egy időben pl. 2–3 osztály (60–90 eszköz) szavaz.

## 4. Opcionális: üzemeltetés

Hitelesség szempontjából jobb, ha a szerverhez a szavazás alatt **nem egy érintett diák**, hanem a rendszergazda (vagy egy tanár) fér hozzá. Ha van iskolai szerver, ahol egy Node.js alkalmazás futhat HTTPS mögött, az ideális; ha nincs, Milán felállít egy külső szervert, és a hozzáférést átadja.

A próbaszavazásokhoz elég egy egyszerű tesztszerver is (akár Milán által üzemeltetett), az éles diáknapi szavazáshoz viszont már a fenti elv szerint kell az üzemeltetőt kijelölni.

---

Kérdés esetén: Milán. Részletes leírás: [RENDSZERLEIRAS.md](RENDSZERLEIRAS.md)
