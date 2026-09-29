'use strict';

// Egyszerű CSV/lista feldolgozás a névjegyzékhez.
// Elfogadott formátum soronként: email,osztály   (vesszővel vagy pontosvesszővel)
// Fejléc sor (pl. "email;osztaly") és üres sorok kimaradnak.

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
      const [emailRaw, classRaw] = line.split(/[;,\t]/).map((s) => (s || '').trim());
      const email = (emailRaw || '').toLowerCase();
      if (i === 0 && !email.includes('@')) return; // fejléc
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return errors.push(`${i + 1}. sor: hibás email (${emailRaw})`);
      if (email.split('@')[1] !== domain) return errors.push(`${i + 1}. sor: nem @${domain} cím (${email})`);
      const cls = normalizeClass(classRaw);
      if (!cls) return errors.push(`${i + 1}. sor: hiányzik az osztály (${email})`);
      if (seen.has(email)) return errors.push(`${i + 1}. sor: ismétlődő cím (${email})`);
      seen.add(email);
      voters.push({ email, class: cls });
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

module.exports = { parseVoters, parseEmailList, normalizeClass };
