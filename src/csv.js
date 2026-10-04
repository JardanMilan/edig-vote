'use strict';

// Egyszerű CSV/lista feldolgozás a névjegyzékhez.
// Elfogadott formátum soronként: email;csoport;név   (pontosvessző, vessző vagy tab; a név elhagyható)
// A csoport egy osztály (pl. 9.A) vagy más csoport (pl. TANÁR).
// Fejléc sor (pl. "email;osztaly;nev") és üres sorok kimaradnak.

function normalizeClass(c) {
  return String(c || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^(\d+)([A-Z])$/, '$1.$2'); // "11a" -> "11.A"
}

function parseVoters(text, domain) {
  const voters = [];
  const errors = [];
  const seen = new Set();
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const [emailRaw, classRaw, ...nameParts] = line.split(/[;,\t]/).map((s) => (s || '').trim());
      const name = nameParts.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 100);
      const email = (emailRaw || '').toLowerCase();
      if (i === 0 && !email.includes('@')) return; // fejléc
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return errors.push(`${i + 1}. sor: hibás email (${emailRaw})`);
      if (email.split('@')[1] !== domain) return errors.push(`${i + 1}. sor: nem @${domain} cím (${email})`);
      const cls = normalizeClass(classRaw);
      if (!cls) return errors.push(`${i + 1}. sor: hiányzik az osztály (${email})`);
      if (seen.has(email)) return errors.push(`${i + 1}. sor: ismétlődő cím (${email})`);
      seen.add(email);
      voters.push({ email, class: cls, name });
    });
  return { voters, errors };
}

function parseEmailList(text) {
  return [
    ...new Set(
      String(text || '')
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes('@'))
    ),
  ];
}

// Osztály (pl. "9.A", "12.B") vagy egyéb csoport (pl. "TANÁR")
function groupKind(name) {
  return /^\d{1,2}\.\S{1,3}$/.test(name) ? 'osztaly' : 'csoport';
}

module.exports = { parseVoters, parseEmailList, normalizeClass, groupKind };
