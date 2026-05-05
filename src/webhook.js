'use strict';

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

/**
 * HMAC SHA256 signature: "sha256=<hex>".
 */
function signPayload(bodyJson, secret) {
  if (!secret) return '';
  const h = crypto.createHmac('sha256', secret);
  h.update(bodyJson);
  return 'sha256=' + h.digest('hex');
}

/**
 * Build webhook payload dari record payment.
 */
function buildPayload(payment) {
  return {
    event: 'payment.' + payment.status,
    id: payment.id,
    status: payment.status,
    baseAmount: payment.base_amount,
    uniqueCode: payment.unique_code,
    totalAmount: payment.total_amount,
    createdAt: payment.created_at,
    expiresAt: payment.expires_at,
    paidAt: payment.paid_at,
    rrn: payment.paid_rrn,
    issuer: payment.paid_issuer,
    customer: payment.paid_customer,
    metadata: payment.metadata || null,
  };
}

/**
 * POST webhook. Tidak melempar exception — selalu return result object.
 */
async function postWebhook(payment) {
  const url = payment.webhook_url;
  if (!url) {
    return { ok: true, skipped: 'no_webhook_url' };
  }

  const payload = buildPayload(payment);
  const body = JSON.stringify(payload);
  const sig = signPayload(body, config.webhook.secret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'bca-merchant-qris-gateway/1.0',
        ...(sig ? { 'X-Signature': sig } : {}),
        'X-Payment-Id': payment.id,
        'X-Payment-Event': 'payment.' + payment.status,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status };
    }
    let text = '';
    try { text = (await res.text()).slice(0, 300); } catch (_) {}
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text}` };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Kirim webhook untuk satu payment dengan retry tracking di DB.
 */
async function deliverOne(payment) {
  if (!payment.webhook_url) {
    db.updateWebhookStatus(payment.id, { status: 'sent' });
    return { ok: true, skipped: true };
  }

  const attempts = (payment.webhook_attempts || 0) + 1;
  const result = await postWebhook(payment);

  if (result.ok) {
    db.updateWebhookStatus(payment.id, {
      status: 'sent',
      attempts,
      lastError: null,
      lastAttemptAt: new Date().toISOString(),
    });
    return result;
  }

  const maxAttempts = config.webhook.maxAttempts;
  const newStatus = attempts >= maxAttempts ? 'failed' : 'retrying';
  db.updateWebhookStatus(payment.id, {
    status: newStatus,
    attempts,
    lastError: result.error,
    lastAttemptAt: new Date().toISOString(),
  });
  return result;
}

/**
 * Drain semua webhook yang pending/retrying.
 */
async function flushPending() {
  const pending = db.listPendingWebhooks();
  const results = [];
  for (const p of pending) {
    const r = await deliverOne(p);
    results.push({ id: p.id, ok: r.ok, error: r.error });
  }
  return results;
}

module.exports = {
  postWebhook,
  deliverOne,
  flushPending,
  signPayload,
  buildPayload,
};
