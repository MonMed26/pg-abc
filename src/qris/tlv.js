'use strict';

/**
 * EMVCo MPM (QRIS) TLV utilities.
 *
 * Format: tag(2) + length(2) + value(length)
 *   - tag: 2 ASCII digits "00".."99"
 *   - length: 2 ASCII digits, value length in chars
 *   - value: arbitrary chars
 *
 * Tag 63 = CRC16-CCITT-FALSE over everything before it (incl. "6304"), uppercase hex.
 */

/**
 * Parse a QRIS payload string into a flat list of { tag, value } objects.
 * Note: nested templates (e.g. tag 26..51 issuer info, tag 62 additional data) are NOT parsed deeper here.
 */
function parseTLV(payload) {
  const out = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) {
      throw new Error(`TLV truncated at index ${i}`);
    }
    const tag = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len)) {
      throw new Error(`Invalid TLV length at index ${i + 2}: "${payload.slice(i + 2, i + 4)}"`);
    }
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length !== len) {
      throw new Error(`TLV value too short for tag ${tag} (expected ${len}, got ${value.length})`);
    }
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

/**
 * Build a TLV chunk: tag + 2-digit length + value.
 */
function buildField(tag, value) {
  if (typeof tag !== 'string' || tag.length !== 2) {
    throw new Error(`Invalid tag: ${tag}`);
  }
  const v = String(value);
  if (v.length > 99) {
    throw new Error(`Value too long for tag ${tag} (${v.length} > 99)`);
  }
  const len = v.length.toString().padStart(2, '0');
  return tag + len + v;
}

/**
 * Build full payload from list of fields, omitting any existing CRC tag,
 * then append CRC16 as tag 63.
 */
function buildPayload(fields) {
  const noCrc = fields.filter((f) => f.tag !== '63');
  const body = noCrc.map((f) => buildField(f.tag, f.value)).join('');
  // CRC is computed over body + "6304"
  const toCrc = body + '6304';
  const crc = crc16ccittFalse(toCrc);
  return body + '63' + '04' + crc;
}

/**
 * CRC16-CCITT-FALSE: poly=0x1021, init=0xFFFF, xorout=0x0000, no reflection.
 * Returns 4-char uppercase hex.
 */
function crc16ccittFalse(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Verify CRC of a complete QRIS payload (tag 63 must be last).
 */
function verifyCRC(payload) {
  if (payload.length < 8) return false;
  const before = payload.slice(0, -4);
  const expected = payload.slice(-4);
  const got = crc16ccittFalse(before);
  return got === expected.toUpperCase();
}

module.exports = {
  parseTLV,
  buildField,
  buildPayload,
  crc16ccittFalse,
  verifyCRC,
};
