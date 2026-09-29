'use strict';

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createGoogleVerifier } = require('./auth');

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const verifyGoogle = cfg.googleClientId
  ? createGoogleVerifier(cfg)
  : async () => {
      throw new Error('Google-bejelentkezés nincs beállítva (GOOGLE_CLIENT_ID).');
    };

const app = createApp({ cfg, db, verifyGoogle });

app.listen(cfg.port, () => {
  console.log(`Diáknapi szavazás fut: http://localhost:${cfg.port}`);
  if (cfg.devLogin) {
    console.warn('\n⚠️  FEJLESZTŐI MÓD (DEV_LOGIN=1): bárki beléphet tetszőleges címmel. ÉLESBEN TILOS!\n');
  }
  if (!cfg.adminEmails.length) console.warn('Figyelem: nincs ADMIN_EMAILS beállítva, az admin felület elérhetetlen.');
});

// Rendes leállás: az SQLite fájl konzisztens marad.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
