'use strict';

const crypto = require('crypto');

// Jelenléti kód: TOTP-szerű, 6 jegyű szám, ami `windowSec` másodpercenként változik.
// A kivetítőn (kiosk) jelenik meg, csak az tudja beírni, aki a teremben látja.
// A kód választásonként eltér (az election id benne van a HMAC-ban).

function codeFor(secret, electionId, windowIndex) {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`presence:${electionId}:${windowIndex}`)
    .digest();
  const n = mac.readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

function currentWindow(windowSec, nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / windowSec);
}

function currentCode(cfg, electionId, nowMs = Date.now()) {
  const w = currentWindow(cfg.codeWindowSec, nowMs);
  const secondsLeft = cfg.codeWindowSec - (Math.floor(nowMs / 1000) % cfg.codeWindowSec);
  return { code: codeFor(cfg.secret, electionId, w), secondsLeft, windowSec: cfg.codeWindowSec };
}

function verifyCode(cfg, electionId, input, nowMs = Date.now()) {
  const clean = String(input || '').replace(/\D/g, '');
  if (clean.length !== 6) return false;
  const w = currentWindow(cfg.codeWindowSec, nowMs);
  for (let i = 0; i <= cfg.codeGraceWindows; i++) {
    const expected = codeFor(cfg.secret, electionId, w - i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

module.exports = { currentCode, verifyCode };
