'use strict';

// Osztályfőnöki / csoportfelelősi felület: a saját osztály névsora, reggeli jelenlét, ki szavazott már.
// Telefonon is használható: egy koppintás = jelen / hiányzik, azonnal mentődik.

const STATUS = { draft: 'Előkészítve – még nem indult', open: 'Folyamatban', closed: 'Lezárva' };
let data = null;
let busy = false;
let timer = null;
let authMsgShown = false; // „nincs osztály rendelve” üzenet – sikeres betöltés után eltüntetjük

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

async function load() {
  clearTimeout(timer);
  try {
    data = await api('/api/teacher/overview');
  } catch (e) {
    if (e.status === 401) {
      $('mainView').classList.add('hidden');
      $('loginView').classList.remove('hidden');
      showMsg('');
      return;
    }
    $('logoutBtn').classList.remove('hidden');
    if (e.code === 'not_leader') {
      $('loginView').classList.add('hidden');
      showMsg('Ehhez a fiókhoz nincs osztály vagy csoport rendelve. Ha osztályfőnök vagy, szólj a szavazás adminisztrátorának.', 'warn');
      authMsgShown = true;
      try {
        const me = await api('/api/me');
        if (me.isAdmin) $('adminLink').classList.remove('hidden');
      } catch (_) {}
      return;
    }
    return showMsg(e.message);
  }
  // Sikeres betöltés: a korábbi hiba- vagy „nincs osztály” üzenet már nem érvényes.
  if (authMsgShown) { showMsg(''); authMsgShown = false; }
  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('adminLink').classList.toggle('hidden', !data.isAdmin);
  $('who').textContent = 'Bejelentkezve: ' + data.me;
  render();
  // Szavazás közben frissítjük, hogy látszódjon, ki szavazott már.
  if (data.election && data.election.status === 'open') timer = setTimeout(() => !busy && load(), 8000);
}

function render() {
  const e = data.election;
  const card = $('electionCard');
  card.innerHTML = '';
  if (!e) {
    card.append(
      el('h2', {}, 'Nincs előkészített szavazás'),
      el('p', { class: 'muted' }, 'A jelenlétet akkor tudod rögzíteni, ha az adminisztrátor előkészítette a szavazást.')
    );
    $('groups').innerHTML = '';
    return;
  }
  // A DOM append() a null-t "null" szövegként írná ki, ezért a feltételes elemeket kiszűrjük.
  card.append(...[
    el('div', { class: 'group-head' },
      el('h2', { style: 'margin:0' }, e.name),
      el('span', { class: 'badge ' + (e.status === 'open' ? 'ok' : 'gray') }, STATUS[e.status])
    ),
    el('p', { class: 'muted', style: 'margin:8px 0 0' },
      e.requireAttendance
        ? 'Csak azok szavazhatnak, akiket itt jelennek jelölsz. Koppints a névre – azonnal mentődik.'
        : 'Ebben a szavazásban nincs jelenlét-ellenőrzés, de a névsorban látod, ki szavazott már.'),
    e.requireAttendance && e.status === 'draft'
      ? el('p', { class: 'notice ok', style: 'margin:12px 0 0' },
          'A szavazás később indul (a programok után). A jelenlétet már most, reggel rögzítheted. ' +
          'Szavazás előtt nézd át újra, és vedd ki, aki közben elment.')
      : null,
    e.requireAttendance && e.status === 'open'
      ? el('p', { class: 'notice warn', style: 'margin:12px 0 0' },
          'A szavazás folyamatban. Ha valaki reggel óta elment, most vedd ki a jelenlévők közül.')
      : null,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('a', { class: 'btn', href: '/kiosk', target: '_blank' }, 'Kivetítő megnyitása'))
  ].filter(Boolean));

  const box = $('groups');
  box.innerHTML = '';
  for (const g of data.groups) box.append(renderGroup(g, e));
}

function renderGroup(g, e) {
  const card = el('section', { class: 'card' });
  const total = g.members.length;
  const present = g.members.filter((m) => m.present === true).length;
  const absent = g.members.filter((m) => m.present === false).length;
  const unset = total - present - absent;
  const voted = g.members.filter((m) => m.voted).length;

  card.append(el('div', { class: 'group-head' },
    el('h2', { style: 'margin:0' }, g.name),
    el('span', { class: 'muted' }, g.kind === 'osztaly' ? 'osztály' : 'csoport')));

  if (g.votes === false) {
    card.append(el('p', { class: 'notice warn' }, 'Ez a csoport ebben a szavazásban nem szavaz (pl. versengő osztály). Nincs teendőd.'));
    return card;
  }

  const stats = el('div', { class: 'stats' },
    el('span', { class: 'stat' }, 'Létszám: ', el('b', {}, String(total))),
    el('span', { class: 'stat' }, 'Jelen: ', el('b', {}, String(present))),
    el('span', { class: 'stat' }, 'Hiányzik: ', el('b', {}, String(absent))));
  if (unset) stats.append(el('span', { class: 'stat', style: 'color:var(--warn)' }, 'Nincs rögzítve: ', el('b', {}, String(unset))));
  if (e.status === 'open') stats.append(el('span', { class: 'stat', style: 'color:var(--ok)' }, 'Szavazott: ', el('b', {}, `${voted}/${present}`)));
  card.append(stats);

  const editable = e.status !== 'closed' && e.requireAttendance;
  if (editable && unset) {
    card.append(el('div', { class: 'sticky' },
      el('button', { style: 'width:100%', onclick: () => markAll(g) }, `Mindenki más jelen (${unset} fő)`),
      el('p', { class: 'muted', style: 'margin:6px 0 0;font-size:0.85rem' }, 'Tipp: előbb jelöld a hiányzókat, aztán nyomd meg ezt.')));
  }

  const list = el('ul', { class: 'people' });
  for (const m of g.members) {
    const state = m.present === true ? 'present' : m.present === false ? 'absent' : 'unset';
    const cb = el('input', { type: 'checkbox', 'aria-label': `${m.name || m.email} jelen` });
    cb.checked = m.present === true;
    const locked = !editable || m.voted;
    cb.disabled = locked;
    const right = m.voted
      ? el('span', { class: 'badge ok' }, '✓ szavazott')
      : state === 'unset' ? el('span', { class: 'badge' }, 'nincs rögzítve')
      : state === 'absent' ? el('span', { class: 'badge gray' }, 'hiányzik') : null;
    const row = el('li', { class: `person ${state}`, 'aria-disabled': String(locked) },
      cb,
      el('div', { class: 'who' }, el('div', { class: 'nm' }, m.name || m.email), el('div', { class: 'em' }, m.email)),
      right);
    if (!locked) {
      // Az egész sor kattintható (telefonon nagyobb célfelület).
      row.onclick = (ev) => {
        if (ev.target !== cb) cb.checked = !cb.checked;
        setOne(g, m, cb.checked);
      };
    }
    list.append(row);
  }
  card.append(list);
  return card;
}

async function save(group, present, absent) {
  busy = true;
  try {
    await apiRaw('/api/teacher/attendance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group, present, absent }),
    });
    showMsg('');
  } catch (e) {
    showMsg(e.message);
  } finally {
    busy = false;
    load();
  }
}

function setOne(g, m, isPresent) {
  m.present = isPresent; // azonnali visszajelzés, a szerver válasza után újratöltjük
  render();
  save(g.name, isPresent ? [m.email] : [], isPresent ? [] : [m.email]);
}

function markAll(g) {
  const rest = g.members.filter((m) => m.present === null).map((m) => m.email);
  if (!rest.length) return;
  if (!confirm(`${rest.length} még nem rögzített diákot jelennek jelölsz. Rendben?`)) return;
  save(g.name, rest, []);
}

$('logoutBtn').onclick = logout;
setupLogin(load);
load();
