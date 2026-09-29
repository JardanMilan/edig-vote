'use strict';

const VIEWS = ['loginView', 'blockedView', 'codeView', 'ballotView', 'doneView'];
function show(view) {
  VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== view));
}

const REASONS = {
  no_open_election: ['Most nincs nyitott szavazás', 'Ha a szavazás elindul, frissítsd az oldalt.'],
  not_on_list: ['Nem szerepelsz a névjegyzékben', 'Ha szerinted tévedés, szólj a szavazást felügyelő tanárnak.'],
  absent: ['Ma hiányzóként vagy nyilvántartva', 'Szavazni csak az aznap jelen lévő diákok tudnak. Ha tévedés, szólj a felügyelő tanárnak.'],
  class_not_in_round: ['Az osztályod ebben a körben nem szavaz', 'Ez egy próbakör, csak a kijelölt osztályok vesznek részt benne.'],
  already_voted: ['Már szavaztál', 'Köszönjük! Egy diák csak egyszer szavazhat.'],
};

// A kivetítőről beolvasott QR-kód a ?kod= paraméterben hozza a jelenléti kódot.
const urlCode = new URLSearchParams(location.search).get('kod');
if (urlCode) {
  sessionStorage.setItem('kod', urlCode);
  history.replaceState(null, '', location.pathname);
}

let me = null;

async function refresh() {
  showMsg('');
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
    return;
  }

  if (!me.present) {
    show('codeView');
    const pending = sessionStorage.getItem('kod');
    if (pending) {
      $('codeInput').value = pending;
      sessionStorage.removeItem('kod');
      submitCode();
    } else {
      $('codeInput').focus();
    }
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
    box.appendChild(label);
  });
}

$('codeForm').onsubmit = (ev) => { ev.preventDefault(); submitCode(); };
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
