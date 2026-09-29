'use strict';

// Demó indítása egy paranccsal (Windows-on is): npm run demo
// Friss demó adatbázist készít, majd fejlesztői módban elindítja a szervert.

const path = require('path');
const { execFileSync } = require('child_process');

const dbPath = './data/demo.db';
execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.js'), dbPath], { stdio: 'inherit' });

Object.assign(process.env, {
  DEV_LOGIN: '1',
  COOKIE_SECURE: '0',
  DB_PATH: dbPath,
  ADMIN_EMAILS: 'admin@edig.hu',
  KIOSK_KEY: 'demo',
});
require('../src/server');
