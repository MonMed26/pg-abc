'use strict';

const express = require('express');
const QRCode = require('qrcode');
const payment = require('../payment');
const poller = require('../poller');

const router = express.Router();

function paymentResponse(p, qrImageDataUrl) {
  if (!p) return null;
  return {
    id: p.id,
    status: p.status,
    baseAmount: p.base_amount ?? p.baseAmount,
    uniqueCode: p.unique_code ?? p.uniqueCode,
    totalAmount: p.total_amount ?? p.totalAmount,
    qrisString: p.qris_string ?? p.qrisString,
    qrImageDataUrl: qrImageDataUrl || null,
    webhookUrl: p.webhook_url ?? p.webhookUrl ?? null,
    metadata: p.metadata ?? null,
    createdAt: p.created_at ?? p.createdAt,
    expiresAt: p.expires_at ?? p.expiresAt,
    paidAt: p.paid_at ?? p.paidAt ?? null,
    rrn: p.paid_rrn ?? null,
    issuer: p.paid_issuer ?? null,
    customer: p.paid_customer ?? null,
    webhookStatus: p.webhook_status ?? null,
    webhookAttempts: p.webhook_attempts ?? 0,
  };
}

/**
 * POST /api/payments
 * Body: { amount, webhookUrl?, expiresInSeconds?, metadata? }
 */
router.post('/', async (req, res) => {
  try {
    const { amount, webhookUrl, expiresInSeconds, metadata } = req.body || {};
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({ error: 'invalid_amount', message: 'amount harus integer Rupiah > 0.' });
    }
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      return res.status(400).json({ error: 'invalid_webhook', message: 'webhookUrl harus URL http(s)://...' });
    }
    const p = await payment.createPayment({ amount, webhookUrl, expiresInSeconds, metadata });
    // Trigger poll cepat (kalau orang langsung bayar dalam <interval, kita catch lebih cepat).
    poller.kick();
    return res.status(201).json(paymentResponse({
      id: p.id,
      status: p.status,
      base_amount: p.baseAmount,
      unique_code: p.uniqueCode,
      total_amount: p.totalAmount,
      qris_string: p.qrisString,
      webhook_url: p.webhookUrl,
      metadata: p.metadata,
      created_at: p.createdAt,
      expires_at: p.expiresAt,
    }, p.qrImageDataUrl));
  } catch (err) {
    if (err.code === 'UNIQUE_CODE_EXHAUSTED') {
      return res.status(409).json({ error: 'unique_code_exhausted', message: err.message });
    }
    console.error('[POST /payments]', err);
    return res.status(err.status || 500).json({ error: 'create_failed', message: err.message });
  }
});

/**
 * GET /api/payments
 * Query: status?, limit?, offset?
 */
router.get('/', (req, res) => {
  const status = req.query.status || undefined;
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  if (status && !['pending', 'paid', 'expired', 'canceled'].includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  const list = payment.listPayments({ status, limit, offset });
  return res.json({
    count: list.length,
    data: list.map((p) => paymentResponse(p)),
  });
});

/**
 * GET /api/payments/:id
 * Query: includeQr=1 untuk include qrImageDataUrl
 */
router.get('/:id', async (req, res) => {
  const p = payment.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  let qrDataUrl = null;
  if (req.query.includeQr === '1' || req.query.includeQr === 'true') {
    try {
      qrDataUrl = await QRCode.toDataURL(p.qris_string, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
      });
    } catch (_) {}
  }
  return res.json(paymentResponse(p, qrDataUrl));
});

/**
 * GET /api/payments/:id/qr.png
 * Render QR sebagai PNG image langsung (untuk <img src="...">).
 */
router.get('/:id/qr.png', async (req, res) => {
  const p = payment.getPayment(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  try {
    const buf = await QRCode.toBuffer(p.qris_string, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: parseInt(req.query.size || '360', 10) || 360,
      type: 'png',
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buf);
  } catch (err) {
    return res.status(500).json({ error: 'qr_generate_failed', message: err.message });
  }
});

/**
 * POST /api/payments/:id/cancel
 */
router.post('/:id/cancel', (req, res) => {
  const p = payment.cancelPayment(req.params.id);
  if (!p) return res.status(409).json({ error: 'cannot_cancel', message: 'Payment tidak ditemukan atau sudah tidak pending.' });
  return res.json(paymentResponse(p));
});

module.exports = router;
