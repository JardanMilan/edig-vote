# Telepítés éles szerverre

Egy kis Linux szerver (VPS vagy iskolai gép) Ubuntu/Debian rendszerrel, nyilvános IP-vel és egy domainnel/aldomainnel. 550 diákhoz 1 vCPU és 1 GB RAM bőven elég.

## 1. Node.js és a program

```bash
# Node.js 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# külön felhasználó, a program a /opt/edig-vote mappába
sudo useradd --system --home /opt/edig-vote --shell /usr/sbin/nologin edigvote
sudo git clone https://github.com/JardanMilan/edig-vote.git /opt/edig-vote
cd /opt/edig-vote
sudo git checkout v0.2.0        # mindig egy megjelölt, nyilvános verzió fusson
sudo npm ci --omit=dev
sudo mkdir -p data && sudo chown edigvote:edigvote data
```

## 2. Beállítások

```bash
sudo cp .env.example .env
sudo nano .env
sudo chown root:edigvote .env && sudo chmod 640 .env
```

Kötelező kitölteni: `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `APP_SECRET`, `KIOSK_KEY`, valamint `TRUST_PROXY=loopback` (mert Caddy mögött fut). Titkok generálása: `openssl rand -hex 32`.

**`DEV_LOGIN` élesben soha ne legyen beállítva.**

## 3. Szolgáltatás

```bash
sudo cp deploy/edig-vote.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edig-vote
sudo systemctl status edig-vote
curl http://127.0.0.1:3000/healthz      # {"ok":true,...}
```

## 4. HTTPS (Caddy)

```bash
sudo apt-get install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # domain átírása
sudo systemctl reload caddy
```

A Google OAuth kliensnél az *Authorized JavaScript origins* közé fel kell venni a `https://<domain>` címet.

## 5. A szavazás napján

- Előtte: `curl https://<domain>/healthz`, próbabelépés egy diákfiókkal, kivetítő megnyitása.
- Közben senki ne lépjen be a szerverre (hitelesség, lásd rendszerleírás 8. pont).
- Lezárás után mentés:
  ```bash
  sudo apt-get install -y sqlite3   # egyszer
  sudo sqlite3 /opt/edig-vote/data/szavazas.db ".backup '/root/szavazas-$(date +%F).db'"
  ```
  (vagy a szolgáltatás leállítása után a `data/` mappa másolása)
- A jegyzőkönyvet az admin felületen kinyomtatni és JSON-ban letölteni.

## Frissítés új verzióra

```bash
cd /opt/edig-vote
sudo git fetch --tags && sudo git checkout v0.X.Y
sudo npm ci --omit=dev
sudo systemctl restart edig-vote
```

Nyitott szavazás alatt ne frissíts.
