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
    $('results').classList.add('hidden');
    $('keyForm').classList.remove('hidden');
    if (key) showMsg(e.message);
    return false;
  }
  sessionStorage.setItem('kioskKey', key);
  $('keyForm').classList.add('hidden');
  if (!d.open) {
    $('live').classList.add('hidden');
    $('closed').classList.toggle('hidden', !!d.results);
    $('results').classList.toggle('hidden', !d.results);
    if (d.results) renderResults(d.results);
    lastCode = null;
    return true;
  }
  $('closed').classList.add('hidden');
  $('results').classList.add('hidden');
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

function renderResults(r) {
  $('resName').textContent = r.name + (r.isTrial ? ' (próbakör)' : '');
  $('resLabel').textContent = r.winners.length > 1 ? 'Holtverseny' : 'A győztes';
  $('resWinner').textContent = r.winners.join(' · ') || '–';
  const max = Math.max(1, ...r.results.map((x) => x.count));
  const rows = $('resRows');
  rows.innerHTML = '';
  r.results.forEach((x) => {
    const row = document.createElement('div');
    row.className = 'res-row';
    const name = document.createElement('div');
    name.textContent = x.label;
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = x.count;
    const track = document.createElement('div');
    track.className = 'track';
    const bar = document.createElement('div');
    bar.style.width = (100 * x.count) / max + '%';
    track.appendChild(bar);
    row.append(name, n, track);
    rows.appendChild(row);
  });
  $('resMeta').textContent = `${r.ballotCount} szavazat · részvétel ${r.votedCount} / ${r.eligibleCount}`;
}

$('fsBtn').onclick = () => document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();

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
