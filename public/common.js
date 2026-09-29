'use strict';

// Közös segédfüggvények minden oldalhoz.

async function api(path, body) {
  const opts = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  return apiRaw(path, opts);
}

async function apiRaw(path, opts) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.error || `Hiba (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    err.details = data.details;
    throw err;
  }
  return data;
}

function $(id) { return document.getElementById(id); }

function showMsg(text, kind = 'err') {
  const box = $('msg');
  if (!box) return;
  box.innerHTML = '';
  if (!text) return;
  const div = document.createElement('div');
  div.className = `notice ${kind}`;
  div.textContent = text;
  box.appendChild(div);
}

// Bejelentkezés: Google Identity Services, vagy fejlesztői módban egyszerű űrlap.
async function setupLogin(onLoggedIn) {
  const cfg = await api('/api/config');
  if ($('domainLabel')) $('domainLabel').textContent = '@' + cfg.domain;

  if (cfg.devLogin) {
    $('devForm').classList.remove('hidden');
    $('devForm').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('/api/login/dev', { email: $('devEmail').value });
        onLoggedIn();
      } catch (e) { showMsg(e.message); }
    };
  }

  if (cfg.googleClientId) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        hd: cfg.domain, // csak kényelmi szűrés – a szerver újra ellenőrzi
        callback: async (resp) => {
          try {
            await api('/api/login/google', { credential: resp.credential });
            onLoggedIn();
          } catch (e) { showMsg(e.message); }
        },
      });
      google.accounts.id.renderButton($('googleBtn'), { theme: 'outline', size: 'large', locale: 'hu', text: 'signin_with' });
    };
    document.head.appendChild(s);
  }
}

async function logout() {
  await api('/api/logout', {});
  location.href = location.pathname;
}
