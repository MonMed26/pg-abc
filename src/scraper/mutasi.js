'use strict';

const { launchBrowser, newContext, saveSession, clearSession } = require('../browser');
const { login, isLoggedIn } = require('./login');

const ID_DAY_NAMES = ['M', 'S', 'S', 'R', 'K', 'J', 'S']; // Min, Sen, Sel, Rab, Kam, Jum, Sab
const ID_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * @typedef {Object} MutasiQuery
 * @property {string} startDate  yyyy-MM-dd
 * @property {string} endDate    yyyy-MM-dd
 */

/**
 * @typedef {Object} MutasiTransaction
 * @property {string} date         yyyy-MM-dd (tanggal yang aktif saat row di-scrape)
 * @property {string} text         raw innerText dari row (untuk parsing manual lanjutan)
 * @property {number} amount       nominal Rp (jika berhasil di-parse), 0 kalau tidak ketemu
 * @property {string} [referenceNo]
 * @property {string} [time]       jam:menit jika ditemukan
 */

function parseRupiah(s) {
  if (!s) return 0;
  const m = String(s).match(/Rp\.?\s*([\d.,]+)/i);
  const raw = m ? m[1] : s;
  const cleaned = String(raw)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** yyyy-MM-dd -> Date object (UTC midnight) */
function toDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtYmd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

/**
 * Generate list yyyy-MM-dd dari start..end inclusive.
 */
function dateRange(startStr, endStr) {
  const start = toDate(startStr);
  const end = toDate(endStr);
  if (end < start) throw new Error('endDate < startDate');
  const out = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(fmtYmd(d));
  }
  return out;
}

/**
 * Validasi rentang harus dalam 7 hari terakhir (limitasi portal).
 * Return null kalau valid, error message kalau tidak.
 */
function validateRange(startStr, endStr) {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const start = toDate(startStr);
  const end = toDate(endStr);

  if (end > todayUtc) {
    return 'endDate tidak boleh di masa depan.';
  }
  const daysFromToday = diffDays(start, todayUtc);
  if (daysFromToday > 6) {
    return 'Portal qr.klikbca.com hanya menampilkan 7 hari terakhir. startDate maksimal 6 hari sebelum hari ini.';
  }
  if (daysFromToday < 0) {
    return 'startDate tidak boleh di masa depan.';
  }
  return null;
}

/**
 * Pilih tombol hari berdasarkan tanggal (yyyy-MM-dd).
 * Tombol yang tersedia adalah 7 button di .weekdays > li > button.
 *
 * Setiap button berisi:
 *   <p><strong>R</strong></p>     <- huruf hari (M/S/S/R/K/J/S)
 *   <h4><strong>29</strong></h4>  <- tanggal
 *   <h6>Apr</h6>                  <- bulan singkat
 */
async function selectDay(page, yyyyMmDd) {
  const target = toDate(yyyyMmDd);
  const day = target.getUTCDate();
  const monthShort = ID_MONTHS_SHORT[target.getUTCMonth()];

  const buttons = await page.locator('.weekdays > li > button').all();
  if (buttons.length === 0) {
    throw new Error('Daftar tombol hari tidak ditemukan di halaman /home.');
  }

  for (const btn of buttons) {
    const txt = (await btn.innerText()).replace(/\s+/g, ' ').trim();
    // contoh txt: "R 29 Apr"
    const m = txt.match(/(\d{1,2})\s+([A-Za-z]+)/);
    if (!m) continue;
    const btnDay = parseInt(m[1], 10);
    const btnMonth = m[2];
    if (btnDay === day && btnMonth.toLowerCase().startsWith(monthShort.toLowerCase().slice(0, 3))) {
      await btn.click();
      // Tunggu request XHR + Angular render
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  }
  throw new Error(`Tombol hari untuk ${yyyyMmDd} tidak ada di kalender 7-hari portal.`);
}

/**
 * Scroll tabel sampai habis (infiniteScroll directive).
 */
async function scrollUntilEnd(page) {
  let prevCount = -1;
  for (let i = 0; i < 30; i++) {
    const count = await page.locator('table.table tbody tr').count();
    if (count === prevCount) break;
    prevCount = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }
}

/**
 * Ekstrak baris transaksi dari DOM tabel.
 *
 * Struktur baris (real sample):
 *   <tr class="table-active">
 *     <td class="col-md-11">
 *       <span class="reference-number">RRN: <code> | <HH.mm> WIB </span>
 *       <span class="text-primary"><strong><merchantName> (NMID: <nmid>)</strong></span>
 *       <p class="font-size-detail-trx">
 *         Menerima pembayaran dari <ISSUER> <span>a.n. <maskedName></span>
 *       </p>
 *     </td>
 *     <td class="text-right"><h4>+ Rp <amount></h4></td>
 *   </tr>
 *
 * Saat tidak ada transaksi: 1 row placeholder dengan colspan=2 + "Transaksi tidak ada".
 */
async function extractRows(page, dateLabel) {
  await page.waitForSelector('table.table tbody', { state: 'attached' }).catch(() => {});

  const rows = await page.$$eval('table.table tbody tr', (trs) =>
    trs.map((tr) => {
      const refEl = tr.querySelector('.reference-number');
      const nameEl = tr.querySelector('.text-primary');
      const detailEl = tr.querySelector('.font-size-detail-trx');
      const amountEl = tr.querySelector('td.text-right h4, td.text-right');
      const tds = Array.from(tr.querySelectorAll('td'));
      const isEmptyState = tds.length === 1 && tds[0].getAttribute('colspan') === '2';
      return {
        text: (tr.innerText || '').replace(/\s+/g, ' ').trim(),
        refText: refEl ? (refEl.innerText || '').trim() : '',
        nameText: nameEl ? (nameEl.innerText || '').trim() : '',
        detailText: detailEl ? (detailEl.innerText || '').trim() : '',
        amountText: amountEl ? (amountEl.innerText || '').trim() : '',
        isEmptyState,
        html: tr.outerHTML,
      };
    })
  );

  if (rows.length === 1 && /transaksi tidak ada/i.test(rows[0].text)) {
    return [];
  }

  return rows
    .filter((r) => !r.isEmptyState && r.text)
    .map((r) => {
      // RRN + waktu: "RRN: 1o3io6b33538 | 11.01 WIB"
      const rrnMatch = r.refText.match(/RRN\s*:\s*(\S+)/i);
      const timeMatch = r.refText.match(/(\d{1,2}[.:]\d{2})\s*WIB/i);
      // Merchant + NMID: "J CELL (NMID: ID1026505506810)"
      const nameMatch = r.nameText.match(/^(.*?)\s*\(NMID\s*:\s*([^)]+)\)\s*$/i);
      // Issuer + masked name: "Menerima pembayaran dari DANA a.n. MI******"
      const detailMatch = r.detailText.match(/dari\s+([A-Z0-9\s.\-]+?)(?:\s+a\.n\.\s+(.+))?$/i);
      // Amount: "+ Rp 10" atau "- Rp 5.000"
      const signMatch = r.amountText.match(/^\s*([+\-])/);
      return {
        date: dateLabel,
        time: timeMatch ? timeMatch[1].replace('.', ':') : '',
        rrn: rrnMatch ? rrnMatch[1] : '',
        merchantName: nameMatch ? nameMatch[1].trim() : '',
        nmid: nameMatch ? nameMatch[2].trim() : '',
        issuer: detailMatch ? detailMatch[1].trim() : '',
        customerName: detailMatch && detailMatch[2] ? detailMatch[2].trim() : '',
        type: signMatch && signMatch[1] === '-' ? 'refund' : 'credit',
        amount: parseRupiah(r.amountText),
        text: r.text,
      };
    });
}

/**
 * Public: ambil mutasi untuk rentang tanggal (max 7 hari terakhir).
 *
 * @param {MutasiQuery} q
 * @returns {Promise<{ data: MutasiTransaction[], merchantId: string, fetchedAt: string, perDay: Record<string, number>, warnings: string[] }>}
 */
async function fetchMutasi(q) {
  if (!q || !q.startDate || !q.endDate) {
    throw new Error('startDate & endDate wajib diisi (yyyy-MM-dd).');
  }
  const err = validateRange(q.startDate, q.endDate);
  if (err) throw new Error(err);

  const days = dateRange(q.startDate, q.endDate);
  const warnings = [];

  const browser = await launchBrowser();
  try {
    let context = await newContext(browser);
    let page;
    let mid;
    try {
      ({ page, mid } = await login(context));
    } catch (e) {
      // Session lama mungkin invalid -> reset & coba sekali lagi.
      await context.close().catch(() => {});
      clearSession();
      context = await newContext(browser);
      ({ page, mid } = await login(context));
    }

    if (!(await isLoggedIn(page))) {
      throw new Error('Login tidak terverifikasi setelah submit.');
    }

    const all = [];
    const perDay = {};
    for (const d of days) {
      try {
        await selectDay(page, d);
        await scrollUntilEnd(page);
        const rows = await extractRows(page, d);
        perDay[d] = rows.length;
        all.push(...rows);
      } catch (e) {
        warnings.push(`Gagal proses ${d}: ${e.message}`);
        perDay[d] = 0;
      }
    }

    await saveSession(context).catch(() => {});
    await context.close().catch(() => {});

    return {
      data: all,
      merchantId: mid,
      fetchedAt: new Date().toISOString(),
      perDay,
      warnings,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  fetchMutasi,
  parseRupiah,
  dateRange,
  validateRange,
  toDate,
  fmtYmd,
};
