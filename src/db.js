'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  const dir = path.dirname(config.payment.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbInstance = new Database(config.payment.dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      base_amount INTEGER NOT NULL,
      unique_code INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','paid','expired','canceled')),
      qris_string TEXT NOT NULL,
      webhook_url TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      paid_at TEXT,
      paid_rrn TEXT,
      paid_issuer TEXT,
      paid_customer TEXT,
      webhook_status TEXT NOT NULL DEFAULT 'pending',
      webhook_attempts INTEGER NOT NULL DEFAULT 0,
      webhook_last_error TEXT,
      webhook_last_attempt_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payments_status_total
      ON payments(status, total_amount);
    CREATE INDEX IF NOT EXISTS idx_payments_status_expires
      ON payments(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_payments_webhook
      ON payments(webhook_status, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_pending_unique_code
      ON payments(unique_code, base_amount)
      WHERE status = 'pending';
  `);
}

function rowToPayment(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? safeJsonParse(row.metadata) : null,
  };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function insertPayment(p) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO payments (
      id, base_amount, unique_code, total_amount, status,
      qris_string, webhook_url, metadata, created_at, expires_at
    ) VALUES (
      @id, @base_amount, @unique_code, @total_amount, 'pending',
      @qris_string, @webhook_url, @metadata, @created_at, @expires_at
    )
  `);
  stmt.run({
    id: p.id,
    base_amount: p.baseAmount,
    unique_code: p.uniqueCode,
    total_amount: p.totalAmount,
    qris_string: p.qrisString,
    webhook_url: p.webhookUrl || null,
    metadata: p.metadata ? JSON.stringify(p.metadata) : null,
    created_at: p.createdAt,
    expires_at: p.expiresAt,
  });
}

function getPayment(id) {
  const db = getDb();
  return rowToPayment(db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
}

function listPayments({ status, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM payments WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset)
      .map(rowToPayment);
  }
  return db
    .prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(rowToPayment);
}

function listPendingPayments() {
  const db = getDb();
  return db
    .prepare('SELECT * FROM payments WHERE status = \'pending\' ORDER BY created_at ASC')
    .all()
    .map(rowToPayment);
}

function getPendingByTotalAmount(totalAmount) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM payments WHERE status = 'pending' AND total_amount = ? ORDER BY created_at ASC")
    .all(totalAmount)
    .map(rowToPayment);
}

/**
 * Atomically mark a pending payment as paid. Returns the updated row, or null
 * if not found / no longer pending.
 */
function markPaid({ id, paidAt, rrn, issuer, customer }) {
  const db = getDb();
  const info = db.prepare(`
    UPDATE payments
       SET status = 'paid', paid_at = ?, paid_rrn = ?, paid_issuer = ?, paid_customer = ?
     WHERE id = ? AND status = 'pending'
  `).run(paidAt, rrn || null, issuer || null, customer || null, id);
  if (info.changes === 0) return null;
  return getPayment(id);
}

function markExpired(idOrIds) {
  const db = getDb();
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`
    UPDATE payments SET status = 'expired'
     WHERE id IN (${placeholders}) AND status = 'pending'
  `).run(...ids);
  return info.changes;
}

function expireStale(nowIso) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id FROM payments WHERE status = 'pending' AND expires_at <= ?
  `);
  const rows = stmt.all(nowIso);
  if (rows.length === 0) return [];
  markExpired(rows.map((r) => r.id));
  return rows.map((r) => r.id);
}

function cancelPayment(id) {
  const db = getDb();
  const info = db.prepare(`
    UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'
  `).run(id);
  return info.changes > 0 ? getPayment(id) : null;
}

/**
 * Cek apakah unique_code sudah dipakai oleh payment lain yg masih pending dengan
 * base_amount yang sama. Dipakai saat generate kode unik untuk hindari bentrok.
 */
function isUniqueCodeAvailable(baseAmount, uniqueCode) {
  const db = getDb();
  const row = db.prepare(`
    SELECT id FROM payments
     WHERE status = 'pending' AND base_amount = ? AND unique_code = ?
  `).get(baseAmount, uniqueCode);
  return !row;
}

function getPendingUniqueCodesForBase(baseAmount) {
  const db = getDb();
  return db.prepare(`
    SELECT unique_code FROM payments
     WHERE status = 'pending' AND base_amount = ?
  `).all(baseAmount).map((r) => r.unique_code);
}

function listPendingWebhooks() {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM payments
       WHERE webhook_url IS NOT NULL
         AND webhook_status IN ('pending','retrying')
         AND status IN ('paid','expired','canceled')
       ORDER BY paid_at ASC
    `)
    .all()
    .map(rowToPayment);
}

function updateWebhookStatus(id, fields) {
  const db = getDb();
  const sets = [];
  const params = [];
  if ('status' in fields) { sets.push('webhook_status = ?'); params.push(fields.status); }
  if ('attempts' in fields) { sets.push('webhook_attempts = ?'); params.push(fields.attempts); }
  if ('lastError' in fields) { sets.push('webhook_last_error = ?'); params.push(fields.lastError); }
  if ('lastAttemptAt' in fields) { sets.push('webhook_last_attempt_at = ?'); params.push(fields.lastAttemptAt); }
  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE payments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function close() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  getDb,
  insertPayment,
  getPayment,
  listPayments,
  listPendingPayments,
  getPendingByTotalAmount,
  markPaid,
  markExpired,
  expireStale,
  cancelPayment,
  isUniqueCodeAvailable,
  getPendingUniqueCodesForBase,
  listPendingWebhooks,
  updateWebhookStatus,
  close,
};
