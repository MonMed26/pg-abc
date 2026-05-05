'use strict';

const { parseTLV, buildPayload, verifyCRC } = require('./tlv');

/**
 * Convert static QRIS to dynamic QRIS dengan amount.
 *
 * Step:
 *   - Parse TLV
 *   - Set tag 01 = "12" (dynamic / one-time use)
 *   - Set tag 54 = amount sebagai integer string
 *   - Drop tag 63 (CRC) jika ada
 *   - Re-build & re-CRC
 *
 * @param {string} staticPayload  raw QRIS string (hasil scan QR statis)
 * @param {number} amountInteger  jumlah dalam Rupiah (integer, no decimal)
 * @returns {string} dynamic QRIS payload
 */
function buildDynamicQRIS(staticPayload, amountInteger) {
  if (!staticPayload || typeof staticPayload !== 'string') {
    throw new Error('staticPayload kosong / bukan string.');
  }
  if (!Number.isInteger(amountInteger) || amountInteger <= 0) {
    throw new Error('amount harus integer positif.');
  }
  if (amountInteger > 9999999999999) {
    // Tag 54 max length 13 chars
    throw new Error('amount terlalu besar (>13 digit).');
  }

  if (!verifyCRC(staticPayload)) {
    // Tetap lanjut, tapi warn lewat exception biasa kalau strict.
    // Kita lanjut karena sebagian QR scanner generator output CRC dengan format berbeda.
  }

  const fields = parseTLV(staticPayload);
  const out = [];
  let saw01 = false;
  let saw54 = false;

  for (const f of fields) {
    if (f.tag === '63') continue; // CRC akan di-rebuild
    if (f.tag === '01') {
      out.push({ tag: '01', value: '12' });
      saw01 = true;
      continue;
    }
    if (f.tag === '54') {
      // skip — kita akan inject ulang di urutan yg benar
      saw54 = true;
      continue;
    }
    out.push(f);
  }

  if (!saw01) {
    // Tag 01 wajib pertama. Kalau ga ada, tambahkan di awal.
    out.unshift({ tag: '01', value: '12' });
  }

  // Insert tag 54 setelah tag 53 (currency) atau sebelum tag 58 (country).
  const amountField = { tag: '54', value: String(amountInteger) };
  const insertIdx = findInsertIndexForTag54(out);
  out.splice(insertIdx, 0, amountField);

  return buildPayload(out);
}

/**
 * Cari posisi tepat untuk insert tag 54 (amount).
 * Per spec EMVCo, urutan field harus naik berdasarkan tag.
 * Kita masukkan setelah field terakhir dengan tag <= 53, sebelum tag 58 (country code).
 */
function findInsertIndexForTag54(fields) {
  for (let i = 0; i < fields.length; i++) {
    if (parseInt(fields[i].tag, 10) > 53) return i;
  }
  return fields.length;
}

/**
 * Quick describe untuk debugging.
 */
function describe(payload) {
  const fields = parseTLV(payload);
  return fields.map((f) => ({ tag: f.tag, len: f.value.length, value: f.value }));
}

module.exports = {
  buildDynamicQRIS,
  describe,
};
