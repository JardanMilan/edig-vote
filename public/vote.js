'use strict';

const VIEWS = ['loginView', 'blockedView', 'codeView', 'ballotView', 'doneView'];
function show(view) {
  VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== view));
}

const REASONS = {
  no_open_election: ['Most nincs nyitott szavazás', 'Ha a szavazás elindul, frissítsd az oldalt.'],
  not_on_list: ['Nem szerepelsz a névjegyzékben', 'Ha szerinted tévedés, szólj a szavazást felügyelő tanárnak.'],
  absent: ['Ma hiányzóként vagy nyilvántartva', 'Szavazni csak az aznap jelen lévő diákok tudnak. Ha tévedés, szólj a felügyelő tanárnak.'],
  class_not_in_round: ['Ebben a szavazásban nem veszel részt', 'Ezen a szavazáson csak a kijelölt osztályok és csoportok szavaznak. A diáknapon a versengő osztályok nem szavaznak.'],
  already_voted: ['Már szavaztál', 'Köszönjük! Egy diák csak egyszer szavazhat.'],
};

// A kivetítőről beolvasott QR-kód a ?kod= paraméterben hozza a jelenléti kódot.
// Azonnal (még a Google-belépés előtt) jelezzük a szervernek, hogy a beolvasás MOST történt,
// így a lassabb belépés (fiókválasztás, jelszó) alatt nem jár le a 30 mp-es kód.
const urlCode = new URLSearchParams(location.search).get('kod');
const scanDone = urlCode
  ? api('/api/presence/scan', { code: urlCode }).catch(() => {}).finally(() =>
      history.replaceState(null, '', location.pathname))
  : Promise.resolve();

let me = null;
let pollTimer = null;

async function refresh() {
  showMsg('');
  clearTimeout(pollTimer);
  await scanDone;
  try {
    me = await api('/api/me');
  } catch (e) {
    if (e.status === 401) {
      $('logoutBtn').classList.add('hidden');
      show('loginView');
      return;
    }
    showMsg(e.message);
    return;
  }
  $('logoutBtn').classList.remove('hidden');

  if (!me.canVote) {
    const [title, text] = REASONS[me.reason] || ['Most nem szavazhatsz', ''];
    $('blockedTitle').textContent = title;
    $('blockedText').textContent = text;
    $('whoami').textContent = `Bejelentkezve: ${me.email}` + (me.class ? ` (${me.class})` : '');
    if (me.isAdmin) $('whoami').textContent += ' · adminként a /admin oldalon kezelheted a szavazást.';
    show(me.reason === 'already_voted' ? 'doneView' : 'blockedView');
    // Ha még nem indult el a szavazás, magától frissül.
    if (me.reason === 'no_open_election') pollTimer = setTimeout(refresh, 10000);
    return;
  }

  if (!me.present) {
    show('codeView');
    if (me.hasScan) {
      // QR-ről jött: a beolvasáskori kódot ellenőrizzük, nem kell semmit beírni.
      try {
        await api('/api/presence', {});
        return refresh();
      } catch (e) {
        showMsg('A beolvasott kód lejárt. Írd be a kivetítőn most látható kódot.', 'warn');
      }
    }
    $('codeInput').focus();
    return;
  }

  renderBallot();
  show('ballotView');
}

async function submitCode() {
  try {
    await api('/api/presence', { code: $('codeInput').value });
    $('codeInput').value = '';
    refresh();
  } catch (e) {
    showMsg(e.message);
    $('codeInput').select();
  }
}

function renderBallot() {
  $('electionName').textContent = me.election.name;
  $('trialBadge').classList.toggle('hidden', !me.election.isTrial);
  const box = $('choices');
  box.innerHTML = '';
  me.election.candidates.forEach((c) => {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'candidate';
    input.value = c.id;
    input.dataset.label = c.label;
    label.append(input, document.createTextNode(c.label));
    if (me.election.blockedCandidate === c.id) {
      input.disabled = true;
      label.classList.add('disabled');
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = ' – saját osztályodra nem szavazhatsz';
      label.appendChild(note);
    }
    box.appendChild(label);
  });
}

$('codeForm').onsubmit = (ev) => { ev.preventDefault(); submitCode(); };
// A kivetítőn "947 969" formában látszik: a szóközt és egyéb karaktert kiszűrjük.
$('codeInput').addEventListener('input', () => {
  const clean = $('codeInput').value.replace(/\D/g, '').slice(0, 6);
  if (clean !== $('codeInput').value) $('codeInput').value = clean;
  if (clean.length === 6) submitCode();
});
$('logoutBtn').onclick = logout;

$('voteForm').onsubmit = (ev) => {
  ev.preventDefault();
  const picked = document.querySelector('input[name=candidate]:checked');
  if (!picked) return showMsg('Válassz egy osztályt!', 'warn');
  $('confirmChoice').textContent = picked.dataset.label;
  $('confirmDlg').showModal();
};
$('confirmNo').onclick = (ev) => { ev.preventDefault(); $('confirmDlg').close(); };
$('confirmYes').onclick = async (ev) => {
  ev.preventDefault();
  const picked = document.querySelector('input[name=candidate]:checked');
  $('confirmYes').disabled = true;
  try {
    await api('/api/vote', { candidateId: picked.value });
    $('confirmDlg').close();
    showMsg('');
    // A szerver szavazás után kiléptet; a Google se lépjen be automatikusan a következő diákként.
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    $('logoutBtn').classList.add('hidden');
    $('sharedHint').classList.remove('hidden');
    show('doneView');
  } catch (e) {
    $('confirmDlg').close();
    if (e.code === 'not_present') { refresh(); showMsg('Lejárt az idő, írd be újra a kivetített kódot.', 'warn'); }
    else { showMsg(e.message); if (e.code === 'already_voted') refresh(); }
  } finally {
    $('confirmYes').disabled = false;
  }
};

setupLogin(refresh);
refresh();
