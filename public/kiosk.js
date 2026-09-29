'use strict';

// A kulcs a # utáni részben érkezik (kiosk.html#KULCS), így az oldal címével nem megy át a szerverre.
// Adminként belépve kulcs nélkül is működik.
let key = decodeURIComponent(location.hash.slice(1)) || sessionStorage.getItem('kioskKey') || '';
let lastCode = null;

async function tick() {
  let d;
  try {
    d = await api('/api/kiosk/code?key=' + encodeURIComponent(key));
  } catch (e) {
    if (e.status !== 403) return true; // átmeneti hálózati hiba: próbáljuk újra
    $('live').classList.add('hidden');
    $('closed').classList.add('hidden');
    $('keyForm').classList.remove('hidden');
    if (key) showMsg(e.message);
    return false;
  }
  sessionStorage.setItem('kioskKey', key);
  $('keyForm').classList.add('hidden');
  if (!d.open) {
    $('live').classList.add('hidden');
    $('closed').classList.remove('hidden');
    return true;
  }
  $('closed').classList.add('hidden');
  $('live').classList.remove('hidden');
  $('title').textContent = d.electionName;
  $('trial').textContent = d.isTrial ? 'Próbakör' : '';
  if (d.code !== lastCode) {
    $('code').textContent = d.code.slice(0, 3) + ' ' + d.code.slice(3);
    $('qr').innerHTML = d.qrSvg; // a szerverünk generálja, saját tartalom
    lastCode = d.code;
  }
  $('bar').style.width = (100 * d.secondsLeft / d.windowSec) + '%';
  $('left').textContent = `Új kód ${d.secondsLeft} mp múlva`;
  return true;
}

let running = false;
async function loop() {
  running = true;
  const ok = await tick();
  if (ok) setTimeout(loop, 1000);
  else running = false; // hibás kulcsnál megállunk, amíg újat nem adnak meg
}

$('keyBtn').onclick = () => {
  key = $('keyInput').value;
  showMsg('');
  if (!running) loop();
};

loop();
