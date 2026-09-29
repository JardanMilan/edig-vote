'use strict';

// Minden beállítás környezeti változóból jön (lásd .env.example).
// A loadConfig() tesztekben felülírható paraméterekkel is hívható.

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || './data/szavazas.db',

    // Google bejelentkezés
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    allowedDomain: (env.ALLOWED_DOMAIN || 'edig.hu').toLowerCase(),

    // Adminok: csak ezek a (Google-lel igazolt) címek érik el az admin felületet
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),

    // A kivetítő (kiosk) oldal kulcsa – ezzel lehet a jelenléti kódot megjeleníteni
    kioskKey: env.KIOSK_KEY || '',

    // Jelenléti kód: ennyi másodpercenként vált, és ennyi korábbi ablakot fogadunk még el
    codeWindowSec: Number(env.CODE_WINDOW_SEC || 30),
    codeGraceWindows: Number(env.CODE_GRACE_WINDOWS || 1),
    // Sikeres kódbeírás után ennyi ideig lehet szavazni
    presenceTtlSec: Number(env.PRESENCE_TTL_SEC || 300),

    // Opcionális: csak ezekről az IP-kről / tartományokról lehet szavazni (pl. iskolai NAT IP)
    allowedIps: list(env.ALLOWED_IPS),
    trustProxy: env.TRUST_PROXY || '',

    // Titok a jelenléti kódhoz és a munkamenetekhez. Élesben kötelező, hosszú, véletlen.
    secret: env.APP_SECRET || '',

    // FEJLESZTŐI MÓD: Google nélküli bejelentkezés tesztcímekkel. ÉLESBEN TILOS.
    devLogin: env.DEV_LOGIN === '1',

    sessionTtlSec: Number(env.SESSION_TTL_SEC || 60 * 60 * 2),
    cookieSecure: env.COOKIE_SECURE !== '0',
    ...overrides,
  };

  if (!cfg.secret) {
    if (cfg.devLogin) {
      cfg.secret = 'dev-secret-ne-hasznald-elesben';
    } else {
      throw new Error('APP_SECRET hiányzik. Élesben kötelező (pl. `openssl rand -hex 32`).');
    }
  }
  if (!cfg.devLogin && !cfg.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID hiányzik (vagy fejlesztéshez DEV_LOGIN=1).');
  }
  return cfg;
}

module.exports = { loadConfig };
