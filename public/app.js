// app.js — frontend admin DeadpoolCHK
'use strict';

const state = {
  page: 1,
  limit: 50,
  q: '',
  status: 'all',
  sortBy: 'id',
  sortDir: 'desc',
  minCredits: '', maxCredits: '',
  minSms: '', maxSms: '',
  totalPages: 1,
};

// ─── helpers ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });
const fmtInt = (n) => (parseInt(n) || 0).toLocaleString('es-AR');
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mn}`;
};
const vipStatus = (u) => {
  if (!u.isVip) return 'free';
  if (!u.expiry) return 'vip_expired';
  return new Date(u.expiry) > new Date() ? 'vip_active' : 'vip_expired';
};
const toastShow = (msg, kind = '') => {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
};
const debounce = (fn, ms) => {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

// ─── theme ───
(function initTheme(){
  const KEY = 'ppv-theme';
  const root = document.documentElement;
  const btn = $('#themeBtn');
  const lbl = $('#themeLabel');
  const icon = $('#themeIcon');
  const sunPath = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  const moonPath = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';
  const apply = (mode) => {
    if (mode === 'dark' || mode === 'light') root.setAttribute('data-theme', mode);
    const isDark = (root.getAttribute('data-theme') === 'dark')
      || (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    lbl.textContent = isDark ? 'claro' : 'oscuro';
    icon.innerHTML = isDark ? sunPath : moonPath;
  };
  const saved = (() => { try { return localStorage.getItem(KEY); } catch(_) { return null; } })();
  if (saved) apply(saved);
  else apply();
  btn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch(_) {}
    apply(next);
  });
})();

// ─── logout ───
$('#logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(_){}
  location.href = '/login';
});

// ─── stats ───
async function loadStats() {
  try {
    const r = await fetch('/api/stats');
    if (r.status === 401) { location.href = '/login'; return; }
    const d = await r.json();
    $('#stTotal').textContent = fmtInt(d.total);
    $('#stVipActive').textContent = fmtInt(d.vipActive);
    $('#stVipExpired').textContent = fmtInt(d.vipExpired);
    $('#stFree').textContent = fmtInt(d.free);
    $('#stSumC').textContent = fmtInt(d.sumCredits);
    $('#stSumSms').textContent = fmtNum(d.sumCreditsms);
    $('#stSumCh').textContent = fmtInt(d.sumCharged);
  } catch (e) {
    console.error('stats', e);
  }
}

// ─── users list ───
async function loadUsers() {
  const body = $('#usersBody');
  body.innerHTML = '<tr><td colspan="9" class="empty">cargando…</td></tr>';
  const params = new URLSearchParams({
    page: state.page, limit: state.limit,
    q: state.q, status: state.status,
    sortBy: state.sortBy, sortDir: state.sortDir,
    minCredits: state.minCredits, maxCredits: state.maxCredits,
    minSms: state.minSms, maxSms: state.maxSms,
  });
  try {
    const r = await fetch('/api/users?' + params.toString());
    if (r.status === 401) { location.href = '/login'; return; }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'error');
    renderUsers(d.rows);
    state.totalPages = d.totalPages;
    $('#resultsCount').textContent = `${fmtInt(d.total)} resultados`;
    $('#resultsPage').textContent = `pág ${d.page} · ${d.limit} por pág`;
    $('#pgCur').textContent = d.page;
    $('#pgTotal').textContent = d.totalPages;
    $('#pgFirst').disabled = $('#pgPrev').disabled = (d.page <= 1);
    $('#pgNext').disabled = $('#pgLast').disabled = (d.page >= d.totalPages);
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9" class="empty">error: ${esc(e.message)}</td></tr>`;
  }
}

function renderUsers(rows) {
  const body = $('#usersBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">sin resultados — probá otro filtro</td></tr>';
    return;
  }
  body.innerHTML = rows.map(u => {
    const st = vipStatus(u);
    const badge = st === 'vip_active'
      ? '<span class="badge vip-active">VIP</span>'
      : st === 'vip_expired'
        ? '<span class="badge vip-expired">vencido</span>'
        : '<span class="badge free">free</span>';
    return `
      <tr>
        <td class="col-id">#${u.id}</td>
        <td><strong>${esc(u.username)}</strong>${u.email ? `<div class="col-tg">${esc(u.email)}</div>` : ''}</td>
        <td class="col-tg">${esc(u.telegramUsername || '—')}</td>
        <td class="col-vip">${badge}</td>
        <td class="col-expiry">${fmtDate(u.expiry)}</td>
        <td class="col-num">${fmtInt(u.credits)}</td>
        <td class="col-num">${fmtNum(u.creditsms)}</td>
        <td class="col-num">${fmtInt(u.charged)}</td>
        <td class="col-actions">
          <button class="edit-btn" data-id="${u.id}" aria-label="Editar user ${u.id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
            editar
          </button>
        </td>
      </tr>`;
  }).join('');
  body.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
}

// ─── toolbar bindings ───
const refresh = () => { loadStats(); loadUsers(); };

$('#refreshBtn').addEventListener('click', refresh);

$('#qSearch').addEventListener('input', debounce(e => {
  state.q = e.target.value.trim();
  state.page = 1;
  loadUsers();
}, 300));
$('#qClear').addEventListener('click', () => {
  $('#qSearch').value = '';
  state.q = '';
  state.page = 1;
  loadUsers();
});

$$('.pill[data-status]').forEach(p => {
  p.addEventListener('click', () => {
    $$('.pill[data-status]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    p.setAttribute('aria-pressed', 'true');
    state.status = p.dataset.status;
    state.page = 1;
    loadUsers();
  });
});

$('#sortBy').addEventListener('change', e => {
  state.sortBy = e.target.value;
  state.page = 1;
  loadUsers();
});
$('#sortDir').addEventListener('click', () => {
  const btn = $('#sortDir');
  const cur = btn.dataset.dir;
  const next = cur === 'desc' ? 'asc' : 'desc';
  btn.dataset.dir = next;
  btn.textContent = next === 'desc' ? '↓' : '↑';
  state.sortDir = next;
  state.page = 1;
  loadUsers();
});
$('#pageLimit').addEventListener('change', e => {
  state.limit = +e.target.value;
  state.page = 1;
  loadUsers();
});

$('#filterApply').addEventListener('click', e => {
  e.preventDefault();
  state.minCredits = $('#minCredits').value;
  state.maxCredits = $('#maxCredits').value;
  state.minSms = $('#minSms').value;
  state.maxSms = $('#maxSms').value;
  state.page = 1;
  loadUsers();
});
$('#filterReset').addEventListener('click', e => {
  e.preventDefault();
  ['minCredits','maxCredits','minSms','maxSms'].forEach(k => { $('#' + k).value = ''; state[k] = ''; });
  state.page = 1;
  loadUsers();
});

$('#pgFirst').addEventListener('click', () => { state.page = 1; loadUsers(); });
$('#pgPrev').addEventListener('click',  () => { state.page = Math.max(1, state.page - 1); loadUsers(); });
$('#pgNext').addEventListener('click',  () => { state.page = Math.min(state.totalPages, state.page + 1); loadUsers(); });
$('#pgLast').addEventListener('click',  () => { state.page = state.totalPages; loadUsers(); });

// ─── edit modal ───
let currentUser = null;
async function openEditModal(id) {
  const modal = $('#editModal');
  const err = $('#modalErr');
  err.textContent = '';
  $('#modalTitle').textContent = 'cargando…';
  $('#modalMeta').textContent = '';
  $('#beforeAfter').textContent = '';
  if (typeof modal.showModal === 'function') modal.showModal();
  else modal.setAttribute('open', '');
  try {
    const r = await fetch(`/api/users/${id}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const u = await r.json();
    currentUser = u;
    $('#modalTitle').textContent = u.username || `#${u.id}`;
    $('#modalMeta').textContent = `#${u.id} · ${u.email || '—'} · tg: ${u.telegramUsername || '—'}`;
    $('#fIsVip').checked = !!u.isVip;
    $('#fExpiry').value = u.expiry ? toLocalInput(u.expiry) : '';
    $('#fCredits').value = u.credits ?? 0;
    $('#fCreditsms').value = u.creditsms ?? 0;
    $('#fCharged').value = u.charged ?? 0;
    updateDiff();
  } catch (e) {
    err.textContent = 'error cargando: ' + e.message;
  }
}
function toLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function closeEditModal() {
  const modal = $('#editModal');
  if (typeof modal.close === 'function') modal.close();
  else modal.removeAttribute('open');
  currentUser = null;
}
$('#modalCancel').addEventListener('click', closeEditModal);
$('#modalClose').addEventListener('click', closeEditModal);
$('#fExpiryClear').addEventListener('click', () => { $('#fExpiry').value = ''; updateDiff(); });

['fIsVip','fExpiry','fCredits','fCreditsms','fCharged'].forEach(id => {
  $('#' + id).addEventListener('input', updateDiff);
  $('#' + id).addEventListener('change', updateDiff);
});

function diffPayload() {
  if (!currentUser) return {};
  const payload = {};
  const newVip = $('#fIsVip').checked ? 1 : 0;
  if (newVip !== (currentUser.isVip ? 1 : 0)) payload.isVip = newVip;
  const curExp = currentUser.expiry ? toLocalInput(currentUser.expiry) : '';
  const newExp = $('#fExpiry').value;
  if (newExp !== curExp) payload.expiry = newExp || null;
  const nCredits = parseInt($('#fCredits').value);
  if (!Number.isNaN(nCredits) && nCredits !== (parseInt(currentUser.credits) || 0)) payload.credits = nCredits;
  const nSms = Number($('#fCreditsms').value);
  if (!Number.isNaN(nSms) && nSms !== Number(currentUser.creditsms || 0)) payload.creditsms = nSms;
  const nCh = parseInt($('#fCharged').value);
  if (!Number.isNaN(nCh) && nCh !== (parseInt(currentUser.charged) || 0)) payload.charged = nCh;
  return payload;
}
function updateDiff() {
  const payload = diffPayload();
  const el = $('#beforeAfter');
  if (!currentUser) { el.textContent = ''; return; }
  const keys = Object.keys(payload);
  if (keys.length === 0) { el.innerHTML = '<em style="color:var(--text-subtle)">(sin cambios aún)</em>'; return; }
  el.innerHTML = 'cambios: ' + keys.map(k => {
    const oldv = k === 'expiry'
      ? (currentUser.expiry ? fmtDate(currentUser.expiry) : 'null')
      : String(currentUser[k] ?? '');
    const newv = k === 'expiry'
      ? (payload.expiry ? fmtDate(payload.expiry) : 'null')
      : String(payload[k]);
    return `<span class="diff-field">${k}</span>: <span class="diff-old">${esc(oldv)}</span> → <span class="diff-new">${esc(newv)}</span>`;
  }).join(' · ');
}

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const payload = diffPayload();
  const err = $('#modalErr');
  err.textContent = '';
  if (Object.keys(payload).length === 0) {
    err.textContent = 'no hay cambios';
    return;
  }
  const confirm = window.confirm(`Confirmá cambios en user ${currentUser.username}:\n\n` +
    Object.entries(payload).map(([k,v]) => `  ${k}: ${v === null ? 'null' : v}`).join('\n'));
  if (!confirm) return;
  const btn = $('#modalSave');
  btn.disabled = true; btn.textContent = 'guardando…';
  try {
    const r = await fetch(`/api/users/${currentUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'error');
    toastShow(`guardado: ${currentUser.username} ✓`, 'ok');
    closeEditModal();
    loadUsers();
    loadStats();
  } catch (e) {
    err.textContent = e.message;
    toastShow('error: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
});

// Keyboard shortcut: '/' focus search, Esc cierra modal
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('#qSearch') && !$('#editModal').open) {
    e.preventDefault(); $('#qSearch').focus();
  }
  if (e.key === 'Escape' && $('#editModal').open) closeEditModal();
});

// ─── boot ───
loadStats();
loadUsers();
