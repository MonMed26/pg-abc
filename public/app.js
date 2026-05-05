'use strict';

const $ = (id) => document.getElementById(id);
const apiTokenInput = $('apiToken');
const toastEl = $('toast');
let activePaymentId = null;
let pollTimer = null;
let countdownTimer = null;

// Load API token dari localStorage kalau ada
apiTokenInput.value = localStorage.getItem('apiToken') || '';
apiTokenInput.addEventListener('change', () => {
  localStorage.setItem('apiToken', apiTokenInput.value.trim());
});

function authHeaders() {
  const t = apiTokenInput.value.trim();
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
  return data;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function fmtRp(n) {
  return Number(n || 0).toLocaleString('id-ID');
}
function fmtTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
}

function setStatusBadge(status) {
  const el = $('statusBadge');
  el.className = 'badge ' + status;
  el.textContent = status;
}

function updateCountdown(expiresAt, status) {
  clearInterval(countdownTimer);
  const el = $('countdown');
  if (status !== 'pending') { el.textContent = ''; return; }
  const tick = () => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) { el.textContent = 'Expired'; clearInterval(countdownTimer); return; }
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    el.textContent = 'Expires in ' + mm + ':' + ss;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function renderActive(p) {
  $('qrCard').style.display = '';
  $('qrImg').src = p.qrImageDataUrl || ('/api/payments/' + p.id + '/qr.png?size=360&t=' + Date.now());
  $('totalAmount').textContent = fmtRp(p.totalAmount);
  $('uniqueCode').textContent = p.uniqueCode;
  $('uniqueCodeFull').textContent = p.uniqueCode;
  $('payId').textContent = p.id;
  $('baseAmount').textContent = fmtRp(p.baseAmount);
  $('expiresAt').textContent = fmtTime(p.expiresAt);
  $('qrisString').textContent = p.qrisString;
  setStatusBadge(p.status);
  updateCountdown(p.expiresAt, p.status);
  const showPaid = p.status === 'paid';
  ['paidAtRow', 'paidAtVal', 'rrnRow', 'rrnVal', 'issuerRow', 'issuerVal'].forEach(function (id) {
    $(id).style.display = showPaid ? '' : 'none';
  });
  if (showPaid) {
    $('paidAtVal').textContent = fmtTime(p.paidAt);
    $('rrnVal').textContent = p.rrn || '-';
    $('issuerVal').textContent = (p.issuer || '-') + (p.customer ? ' (' + p.customer + ')' : '');
  }
  $('btnCancel').style.display = p.status === 'pending' ? '' : 'none';
}

async function pollActive() {
  if (!activePaymentId) return;
  try {
    const p = await api('GET', '/api/payments/' + activePaymentId);
    renderActive(p);
    if (p.status !== 'pending') {
      clearInterval(pollTimer);
      pollTimer = null;
      toast('Payment ' + p.status + '!');
      refreshList();
    }
  } catch (e) {
    console.warn('poll error', e);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollActive, 3000);
}

async function refreshList() {
  try {
    const data = await api('GET', '/api/payments?limit=20');
    const tbody = document.querySelector('#historyTable tbody');
    tbody.innerHTML = '';
    if (data.count === 0) {
      $('emptyMsg').style.display = '';
      $('historyTable').style.display = 'none';
      return;
    }
    $('emptyMsg').style.display = 'none';
    $('historyTable').style.display = '';
    for (const p of data.data) {
      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td><a href="#" data-id="' + p.id + '">' + p.id.slice(0, 18) + '…</a></td>',
        '<td><span class="badge ' + p.status + '">' + p.status + '</span></td>',
        '<td>Rp ' + fmtRp(p.baseAmount) + '</td>',
        '<td>+' + p.uniqueCode + '</td>',
        '<td><strong>Rp ' + fmtRp(p.totalAmount) + '</strong></td>',
        '<td>' + fmtTime(p.createdAt) + '</td>',
        '<td>' + (p.status === 'paid' ? (p.issuer || '-') + (p.customer ? ' / ' + p.customer : '') : '-') + '</td>',
      ].join('');
      tr.querySelector('a').addEventListener('click', async function (ev) {
        ev.preventDefault();
        const id = this.getAttribute('data-id');
        try {
          const detail = await api('GET', '/api/payments/' + id + '?includeQr=1');
          activePaymentId = detail.id;
          renderActive(detail);
          if (detail.status === 'pending') startPolling();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
          toast('Error: ' + e.message);
        }
      });
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.warn('list error', e);
  }
}

$('btnCreate').addEventListener('click', async function () {
  const amount = parseInt($('amount').value, 10);
  if (!Number.isFinite(amount) || amount <= 0) { toast('Amount tidak valid'); return; }
  const webhookUrl = $('webhook').value.trim() || undefined;
  const ttl = parseInt($('ttl').value, 10);
  const expiresInSeconds = Number.isFinite(ttl) && ttl > 0 ? ttl : undefined;
  let metadata;
  const metaRaw = $('meta').value.trim();
  if (metaRaw) {
    try { metadata = JSON.parse(metaRaw); }
    catch (e) { toast('Metadata bukan JSON valid'); return; }
  }
  this.disabled = true;
  try {
    const p = await api('POST', '/api/payments', { amount, webhookUrl, expiresInSeconds, metadata });
    activePaymentId = p.id;
    renderActive(p);
    startPolling();
    refreshList();
    toast('Payment created!');
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    this.disabled = false;
  }
});

$('btnRefresh').addEventListener('click', refreshList);

$('btnCancel').addEventListener('click', async function () {
  if (!activePaymentId) return;
  if (!confirm('Cancel payment ini?')) return;
  try {
    const p = await api('POST', '/api/payments/' + activePaymentId + '/cancel');
    renderActive(p);
    clearInterval(pollTimer);
    refreshList();
    toast('Payment dibatalkan');
  } catch (e) {
    toast('Error: ' + e.message);
  }
});

document.addEventListener('click', function (e) {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const targetId = btn.getAttribute('data-copy');
  const text = $(targetId).textContent;
  navigator.clipboard.writeText(text).then(function () { toast('Disalin: ' + text.slice(0, 30) + '…'); });
});

// Initial
refreshList();
