'use strict';

const { OAuth2Client } = require('google-auth-library');

// A Google ID token ellenőrzése SZERVEROLDALON történik:
// aláírás, lejárat, audience (a mi client ID-nk), igazolt email, és a Workspace domain (hd).
// A kliensoldali `hd` paraméter csak kényelmi szűrés, arra nem lehet építeni.

function createGoogleVerifier(cfg) {
  const client = new OAuth2Client(cfg.googleClientId);
  return async function verify(idToken) {
    const ticket = await client.verifyIdToken({ idToken, audience: cfg.googleClientId });
    const p = ticket.getPayload();
    if (!p || !p.email || !p.email_verified) throw new Error('A Google-fiók emailcíme nincs igazolva.');
    const email = p.email.toLowerCase();
    const domain = email.split('@')[1];
    if (p.hd !== cfg.allowedDomain || domain !== cfg.allowedDomain) {
      throw new Error(`Csak @${cfg.allowedDomain} fiókkal lehet belépni.`);
    }
    return email;
  };
}

module.exports = { createGoogleVerifier };
