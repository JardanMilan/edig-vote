'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const put = (path, body) =>
  apiRaw(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = (path) => apiRaw(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('hu-HU') : '–');

const STATUS = {
  draft: ['Előkészítve', 'gray'],
  open: ['Folyamatban', 'ok'],
  closed: ['Lezárva', 'blue'],
};

let state = null;
let refreshTimer = null;

async function load() {
  try {
    state = await api('/api/admin/overview');
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      $('adminView').classList.add('hidden');
      $('loginView').classList.remove('hidden');
      $('logoutBtn').classList.toggle('hidden', e.status === 401);
      if (e.status === 403) showMsg('Ez a fiók nem admin. Lépj ki, és lépj be egy admin fiókkal.');
      return;
    }
    return showMsg(e.message);
  }
  $('loginView').classList.add('hidden');
  $('adminView').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('who').textContent = 'Bejelentkezve: ' + state.me;
  renderElections();
  renderClasses();
  renderAudit();
  // Nyitott szavazásnál 5 mp-enként frissítjük a részvételt.
  clearTimeout(refreshTimer);
  if (state.elections.some((e) => e.status === 'open')) refreshTimer = setTimeout(load, 5000);
}

function renderElections() {
  const box = $('elections');
  if (!state.elections.length) {
    box.innerHTML = '<p class="muted">Még nincs szavazás. Hozz létre egyet lent.</p>';
    return;
  }
  box.innerHTML = state.elections.map((e) => {
    const [st, cls] = STATUS[e.status];
    const pct = e.eligibleCount ? Math.round((100 * e.votedCount) / e.eligibleCount) : 0;
    const who = e.allowedClasses ? e.allowedClasses.join(', ') : 'minden osztály';
    let actions = '';
    if (e.status === 'draft') {
      actions = `<button class="secondary" data-act="delete" data-id="${e.id}">Törlés</button>
                 <button data-act="open" data-id="${e.id}">Megnyitás</button>`;
    }
    if (e.status === 'open') actions = `<button class="danger" data-act="close" data-id="${e.id}">Lezárás</button>`;
    if (e.status === 'closed') {
      actions = `<button class="secondary" data-act="publish" data-id="${e.id}">
                   ${e.published ? 'Kivetítőről levétel' : 'Eredmény a kivetítőre'}</button>
                 <button data-act="protocol" data-id="${e.id}">Jegyzőkönyv</button>`;
    }
    return `
      <div class="card" style="margin:12px 0">
        <div class="el-head">
          <div>
            <b>${esc(e.name)}</b>
            <span class="badge ${cls}">${st}</span>
            ${e.isTrial ? '<span class="badge">Próbakör</span>' : ''}
            ${e.noSelfVote ? '<span class="badge gray">Saját osztályra nem</span>' : ''}
            ${e.published ? '<span class="badge ok">Kivetítőn</span>' : ''}
          </div>
          <div class="row">${actions}</div>
        </div>
        <p class="muted" style="margin:8px 0 4px">Szavaz: ${esc(who)} · Jelöltek: ${e.candidates.map((c) => esc(c.label)).join(', ')}</p>
        <p class="muted" style="margin:0">Létrehozva ${fmt(e.createdAt)} · Nyitva ${fmt(e.openedAt)} · Zárva ${fmt(e.closedAt)}</p>
        ${e.status !== 'draft' ? `
          <p style="margin:10px 0 4px">Részvétel: <b>${e.votedCount}</b> / ${e.eligibleCount} jogosult (${pct}%)</p>
          <div style="background:var(--line);border-radius:4px"><div class="bar" style="width:${Math.min(pct, 100)}%"></div></div>
          ${e.status === 'open' ? '<p class="muted" style="margin-top:6px">Az eredmény lezárásig senki számára nem látható.</p>' : ''}
        ` : ''}
      </div>`;
  }).join('');
}

function renderClasses() {
  const rows = [...state.classes].sort((a, b) => a.class.localeCompare(b.class, 'hu', { numeric: true }));
  const total = rows.reduce((s, r) => s + r.total, 0);
  const absent = rows.reduce((s, r) => s + (r.absent || 0), 0);
  $('classTable').innerHTML = rows.length
    ? `<tr><th>Osztály</th><th class="num">Létszám</th><th class="num">Hiányzó</th></tr>` +
      rows.map((r) => `<tr><td>${esc(r.class)}</td><td class="num">${r.total}</td><td class="num">${r.absent || 0}</td></tr>`).join('') +
      `<tr><th>Összesen</th><th class="num">${total}</th><th class="num">${absent}</th></tr>`
    : '<tr><td class="muted">A névjegyzék üres – tölts fel egy CSV-t.</td></tr>';

  const pick = $('classPick');
  const checked = new Set([...pick.querySelectorAll('input:checked')].map((i) => i.value));
  pick.innerHTML = rows.map((r) =>
    `<label><input type="checkbox" value="${esc(r.class)}" ${checked.has(r.class) ? 'checked' : ''}> ${esc(r.class)}</label>`
  ).join('') || '<span class="muted">Előbb töltsd fel a névjegyzéket.</span>';
}

const ACTIONS = {
  election_created: 'Szavazás létrehozva',
  election_opened: 'Szavazás megnyitva',
  election_closed: 'Szavazás lezárva',
  voters_replaced: 'Névjegyzék cserélve',
  absent_set: 'Hiányzók beállítva',
  absent_toggled: 'Hiányzás módosítva',
  election_deleted: 'Szavazás törölve',
  results_published: 'Eredmény kivetítőre téve',
  results_unpublished: 'Eredmény levéve a kivetítőről',
  personal_data_purged: 'Személyes adatok törölve',
};

async function renderAudit() {
  try {
    const { log } = await api('/api/admin/audit');
    $('auditTable').innerHTML = '<tr><th>Időpont</th><th>Ki</th><th>Művelet</th><th>Részletek</th></tr>' +
      log.map((l) => `<tr><td>${fmt(l.at)}</td><td>${esc(l.actor)}</td><td>${esc(ACTIONS[l.action] || l.action)}</td><td class="muted" style="font-size:0.8rem">${esc(l.details || '')}</td></tr>`).join('');
  } catch (_) {}
}

async function showProtocol(id) {
  const { protocol: p, resultHash } = await api(`/api/admin/elections/${id}/protocol`);
  const max = Math.max(1, ...p.results.map((r) => r.count));
  $('protocolView').innerHTML = `
    <div class="el-head">
      <h2>Szavazási jegyzőkönyv</h2>
      <div class="row noprint">
        <button>Nyomtatás</button>
        <a class="btn secondary" style="background:transparent;color:var(--accent);border:1px solid var(--line)" href="/api/admin/elections/${id}/protocol.json" download>JSON letöltése</a>
        <button class="secondary">Bezárás</button>
      </div>
    </div>
    <p><b>${esc(p.name)}</b> ${p.isTrial ? '<span class="badge">Próbakör</span>' : ''}</p>
    <p class="muted">Nyitás: ${fmt(p.openedAt)} · Lezárás: ${fmt(p.closedAt)} · Szavazó osztályok: ${esc(p.allowedClasses ? p.allowedClasses.join(', ') : 'mind')}</p>
    <div class="notice ${p.consistent ? 'ok' : 'err'}">
      ${p.consistent
        ? `Ellenőrzés rendben: ${p.votedCount} diák szavazott, és pontosan ${p.ballotCount} szavazat van a számlálókban.`
        : `ELTÉRÉS: ${p.votedCount} szavazó, de ${p.ballotCount} szavazat! Az eredmény nem hitelesíthető.`}
    </div>
    <table>
      <tr><th>Jelölt</th><th class="num">Szavazat</th><th class="num">%</th><th style="width:40%"></th></tr>
      ${p.results.map((r) => `
        <tr>
          <td>${esc(r.label)}${p.winners.includes(r.label) ? ' 🏆' : ''}</td>
          <td class="num"><b>${r.count}</b></td>
          <td class="num">${p.ballotCount ? ((100 * r.count) / p.ballotCount).toFixed(1) : '0.0'}</td>
          <td><div class="bar" style="width:${(100 * r.count) / max}%"></div></td>
        </tr>`).join('')}
    </table>
    ${p.winners.length > 1 ? '<div class="notice warn">Holtverseny az első helyen.</div>' : ''}
    <p style="margin-top:16px">Részvétel: <b>${p.votedCount}</b> / ${p.eligibleCount} jogosult
      (${p.eligibleCount ? ((100 * p.votedCount) / p.eligibleCount).toFixed(1) : 0}%)</p>
    <p class="muted">Részvétel osztályonként: ${p.turnoutByClass.map((t) => `${esc(t.class)}: ${t.n}`).join(' · ') || '–'}</p>
    <p class="muted" style="margin-top:16px">Jegyzőkönyv lenyomata (SHA-256):</p>
    <p class="hash">${esc(resultHash)}</p>
    <p class="muted noprint">Ellenőrzés: a letöltött JSON-ra <code>npm run verify -- jegyzokonyv-${id}.json</code> ugyanezt a lenyomatot kell kiírja.</p>
    <div style="margin-top:40px" class="grid2">
      <p>…………………………………<br>igazgató</p>
      <p>…………………………………<br>DÖK-segítő tanár</p>
    </div>`;
  const [printBtn, closeBtn] = $('protocolView').querySelectorAll('.noprint button');
  printBtn.onclick = () => window.print();
  closeBtn.onclick = () => {
    $('protocolView').classList.add('hidden');
    document.body.classList.remove('protocol-open');
  };
  $('protocolView').classList.remove('hidden');
  document.body.classList.add('protocol-open');
  $('protocolView').scrollIntoView({ behavior: 'smooth' });
}

$('elections').onclick = async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  const el = state.elections.find((e) => String(e.id) === id);
  try {
    if (act === 'open') {
      if (!confirm(`Megnyitod: „${el.name}”? Ezután a jogosult diákok szavazhatnak.`)) return;
      await api(`/api/admin/elections/${id}/open`, {});
    } else if (act === 'close') {
      if (!confirm(`Lezárod: „${el.name}”? Lezárás után több szavazat nem adható le, és ez nem vonható vissza.`)) return;
      await api(`/api/admin/elections/${id}/close`, {});
      await load();
      return showProtocol(id);
    } else if (act === 'protocol') {
      return showProtocol(id);
    } else if (act === 'delete') {
      if (!confirm(`Törlöd: „${el.name}”?`)) return;
      await del(`/api/admin/elections/${id}`);
    } else if (act === 'publish') {
      const msg = el.published
        ? 'Leveszed az eredményt a kivetítőről?'
        : 'Megjelenjen az eredmény a kivetítőn (/kiosk)? Mindenki látni fogja, aki a kivetítőt nézi.';
      if (!confirm(msg)) return;
      await api(`/api/admin/elections/${id}/publish`, { published: !el.published });
    }
    showMsg('');
    load();
  } catch (e) { showMsg(e.message); }
};

$('newForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const candidates = $('elCands').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, label] = l.split(/[;\t]/).map((s) => s.trim());
    return { id, label: label || id };
  });
  const allowedClasses = [...$('classPick').querySelectorAll('input:checked')].map((i) => i.value);
  try {
    await api('/api/admin/elections', {
      name: $('elName').value, isTrial: $('elTrial').checked, noSelfVote: $('elNoSelf').checked, candidates, allowedClasses,
    });
    showMsg('Szavazás létrehozva. A listában megnyithatod.', 'ok');
    $('newForm').reset();
    load();
  } catch (e) { showMsg(e.message); }
};

$('votersFile').onchange = async () => {
  const f = $('votersFile').files[0];
  if (f) $('votersCsv').value = await f.text();
};

$('votersBtn').onclick = async () => {
  try {
    const r = await put('/api/admin/voters', { csv: $('votersCsv').value });
    showMsg(`Névjegyzék betöltve: ${r.count} diák.`, 'ok');
    $('votersCsv').value = '';
    load();
  } catch (e) {
    showMsg(e.message + (e.details ? '\n' + e.details.join('\n') : ''));
  }
};

$('absentBtn').onclick = async () => {
  try {
    const r = await put('/api/admin/absent', { emails: $('absentList').value });
    showMsg(`Hiányzók: ${r.matched} diák megjelölve` + (r.unknown ? `, ${r.unknown} cím nincs a névjegyzékben.` : '.'), r.unknown ? 'warn' : 'ok');
    load();
  } catch (e) { showMsg(e.message); }
};

// ----- Ügyelet: diák keresése -----
let searchTimer = null;
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});

async function runSearch() {
  const term = $('searchInput').value.trim();
  if (term.length < 2) { $('searchTable').innerHTML = ''; return; }
  try {
    const r = await api('/api/admin/voters/search?q=' + encodeURIComponent(term));
    if (!r.voters.length) {
      $('searchTable').innerHTML = '<tr><td class="muted">Nincs találat a névjegyzékben – ez a diák nem szavazhat. Ha tévedés, a névjegyzéket kell javítani (nyitott szavazás alatt nem lehet).</td></tr>';
      return;
    }
    $('searchTable').innerHTML =
      `<tr><th>Email</th><th>Osztály</th><th>Szavazott?</th><th></th></tr>` +
      r.voters.map((v) => `
        <tr>
          <td>${esc(v.email)}</td>
          <td>${esc(v.class)}</td>
          <td>${v.voted === null ? '<span class="muted">nincs nyitott szavazás</span>' : v.voted ? '<span class="badge ok">igen</span>' : 'még nem'}</td>
          <td class="num"><button class="${v.absent ? '' : 'secondary'}" data-email="${esc(v.email)}" data-absent="${v.absent ? 0 : 1}">
            ${v.absent ? 'Hiányzó → jelen' : 'Jelen → hiányzó'}</button></td>
        </tr>`).join('');
  } catch (e) { showMsg(e.message); }
}

$('searchTable').onclick = async (ev) => {
  const b = ev.target.closest('button[data-email]');
  if (!b) return;
  try {
    await put('/api/admin/voters/absent', { email: b.dataset.email, absent: b.dataset.absent === '1' });
    runSearch();
    load();
  } catch (e) { showMsg(e.message); }
};

// ----- Adatvédelem -----
$('purgeBtn').onclick = async () => {
  const c = prompt('A névjegyzék, a "ki szavazott" lista és a munkamenetek végleg törlődnek. A jegyzőkönyvek megmaradnak.\n\nMegerősítéshez írd be: TÖRLÉS');
  if (c === null) return;
  try {
    const r = await api('/api/admin/purge', { confirm: c });
    showMsg(`Törölve: ${r.voters} diák a névjegyzékből, ${r.voted} szavazott-bejegyzés, ${r.sessions} munkamenet.`, 'ok');
    load();
  } catch (e) { showMsg(e.message); }
};

$('logoutBtn').onclick = logout;
setupLogin(load);
load();
