'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('./config');
const db = require('./db');
const { buildDynamicQRIS } = require('./qris/dynamic');

/**
 * Buat kode unik antara MIN..MAX yang belum dipakai untuk pending payment dengan
 * base_amount yang sama. Lempar error 409 kalau semua kode sudah terpakai.
 */
function generateUniqueCode(baseAmount) {
  const min = config.payment.uniqueCodeMin;
  const max = config.payment.uniqueCodeMax;
  if (min < 0 || max < min) {
    throw new Error('UNIQUE_CODE_MIN/MAX tidak valid.');
  }

  const used = new Set(db.getPendingUniqueCodesForBase(baseAmount));
  const range = max - min + 1;
  if (used.size >= range) {
    const err = new Error(`Semua kode unik (${min}..${max}) sedang dipakai untuk amount ${baseAmount}. Coba lagi nanti atau perluas range.`);
    err.code = 'UNIQUE_CODE_EXHAUSTED';
    throw err;
  }

  // Coba random dulu, fallback ke linear scan kalau ramai.
  for (let i = 0; i < 50; i++) {
    const candidate = min + Math.floor(Math.random() * range);
    if (!used.has(candidate)) return candidate;
  }
  for (let c = min; c <= max; c++) {
    if (!used.has(c)) return c;
  }
  // Tidak akan sampai sini karena guard di atas.
  throw new Error('UNIQUE_CODE_EXHAUSTED');
}

/**
 * Create new payment.
 *
 * @param {Object} input
 * @param {number} input.amount         baseAmount in Rupiah (integer)
 * @param {string} [input.webhookUrl]   override default webhook
 * @param {number} [input.expiresInSeconds]
 * @param {Object} [input.metadata]
 * @returns {Promise<Object>} payment record + qrImageDataUrl
 */
async function createPayment({ amount, webhookUrl, expiresInSeconds, metadata } = {}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    const err = new Error('amount harus integer Rupiah > 0.');
    err.status = 400;
    throw err;
  }
  if (!config.payment.qrisStatic) {
    const err = new Error('BCA_QRIS_STATIC belum di-set di .env.');
    err.status = 500;
    throw err;
  }

  const uniqueCode = generateUniqueCode(amount);
  const totalAmount = amount + uniqueCode;
  const qrisString = buildDynamicQRIS(config.payment.qrisStatic, totalAmount);
  const id = `pay_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

  const ttlSec = Math.max(30, Math.min(86400, expiresInSeconds || config.payment.expiresSeconds));
  const now = new Date();
  const exp = new Date(now.getTime() + ttlSec * 1000);

  const finalWebhookUrl = webhookUrl || config.webhook.url || null;

  const record = {
    id,
    baseAmount: amount,
    uniqueCode,
    totalAmount,
    qrisString,
    webhookUrl: finalWebhookUrl,
    metadata: metadata || null,
    createdAt: now.toISOString(),
    expiresAt: exp.toISOString(),
  };

  db.insertPayment(record);

  const qrImageDataUrl = await QRCode.toDataURL(qrisString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
  });

  return {
    ...record,
    qrImageDataUrl,
    status: 'pending',
  };
}

function getPayment(id) {
  return db.getPayment(id);
}

function listPayments(opts) {
  return db.listPayments(opts);
}

function cancelPayment(id) {
  return db.cancelPayment(id);
}

/**
 * Coba match transaksi mutasi ke pending payment.
 *
 * @param {Array<{ amount: number, time: string, rrn: string, issuer: string, customerName: string, date: string }>} transactions
 * @returns {Array<{ payment: Object, transaction: Object }>} pasangan yg berhasil di-match
 */
function tryMatchTransactions(transactions) {
  const matches = [];
  // Tracking RRN yg sudah dipakai biar 1 trx tidak match 2 payment
  const usedRrn = new Set();

  for (const trx of transactions || []) {
    if (!trx || !Number.isFinite(trx.amount) || trx.amount <= 0) continue;
    if (trx.type && trx.type !== 'credit') continue;
    if (trx.rrn && usedRrn.has(trx.rrn)) continue;

    const candidates = db.getPendingByTotalAmount(trx.amount);
    if (candidates.length === 0) continue;

    // Pilih payment terlama yg dibuat sebelum waktu transaksi.
    // Karena scraper hanya kasih jam:menit (dalam timezone WIB), kita longgar:
    // ambil pending paling lama yg total_amount-nya match.
    const target = candidates[0];

    const updated = db.markPaid({
      id: target.id,
      paidAt: new Date().toISOString(),
      rrn: trx.rrn,
      issuer: trx.issuer,
      customer: trx.customerName,
    });
    if (updated) {
      if (trx.rrn) usedRrn.add(trx.rrn);
      matches.push({ payment: updated, transaction: trx });
    }
  }

  return matches;
}

function expireStale() {
  return db.expireStale(new Date().toISOString());
}

module.exports = {
  createPayment,
  getPayment,
  listPayments,
  cancelPayment,
  tryMatchTransactions,
  expireStale,
  generateUniqueCode,
};
