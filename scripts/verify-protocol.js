'use strict';

// Jegyzőkönyv ellenőrzése: kiszámolja a letöltött JSON SHA-256 lenyomatát, és kiírja a lényeget.
// Használat:  npm run verify -- jegyzokonyv-1.json [várt-lenyomat]
// Ha a kinyomtatott és aláírt jegyzőkönyvön szereplő lenyomat egyezik, a fájl tartalma nem változott.

const fs = require('fs');
const crypto = require('crypto');

const [file, expected] = process.argv.slice(2);
if (!file) {
  console.error('Használat: npm run verify -- <jegyzokonyv.json> [várt lenyomat]');
  process.exit(2);
}

const raw = fs.readFileSync(file);
const hash = crypto.createHash('sha256').update(raw).digest('hex');
const p = JSON.parse(raw.toString('utf8'));

console.log(`Szavazás:    ${p.name}${p.isTrial ? ' (próbakör)' : ''}`);
console.log(`Lezárva:     ${p.closedAt}`);
console.log(`Jogosult:    ${p.eligibleCount}   Szavazott: ${p.votedCount}   Szavazat: ${p.ballotCount}`);
console.log(`Egyezés:     ${p.votedCount === p.ballotCount && p.consistent ? 'RENDBEN' : 'ELTÉRÉS!'}`);
console.log('Eredmény:');
p.results.forEach((r) => console.log(`  ${String(r.count).padStart(5)}  ${r.label}`));
const sum = p.results.reduce((s, r) => s + r.count, 0);
if (sum !== p.ballotCount) console.log(`  FIGYELEM: a jelöltenkénti összeg (${sum}) nem egyezik a szavazatszámmal!`);
console.log(`\nSHA-256:     ${hash}`);

if (expected) {
  const ok = expected.trim().toLowerCase() === hash;
  console.log(ok ? 'A lenyomat EGYEZIK a megadottal.' : 'A lenyomat NEM egyezik – a fájl eltér az eredetitől!');
  process.exit(ok ? 0 : 1);
}
