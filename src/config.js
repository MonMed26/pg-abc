'use strict';

require('dotenv').config();

const path = require('path');

function required(key) {
  const value = process.env[key];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function intEnv(key, def) {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const config = {
  portal: {
    url: process.env.BCA_QR_PORTAL_URL || 'https://qr.klikbca.com/',
    username: required('BCA_QR_USERNAME'),
    password: required('BCA_QR_PASSWORD'),
  },
  server: {
    port: intEnv('PORT', 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    apiToken: process.env.API_TOKEN || '',
  },
  playwright: {
    headless: String(process.env.HEADLESS || 'true').toLowerCase() !== 'false',
    timeout: intEnv('PW_TIMEOUT', 30000),
    sessionFile: path.resolve(
      process.cwd(),
      process.env.SESSION_FILE || './data/session.json'
    ),
  },
  payment: {
    qrisStatic: process.env.BCA_QRIS_STATIC || '',
    uniqueCodeMin: intEnv('UNIQUE_CODE_MIN', 1),
    uniqueCodeMax: intEnv('UNIQUE_CODE_MAX', 999),
    expiresSeconds: intEnv('PAYMENT_EXPIRES_SECONDS', 900),
    dbPath: path.resolve(
      process.cwd(),
      process.env.DB_PATH || './data/payments.db'
    ),
    timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  },
  poller: {
    intervalMs: intEnv('POLL_INTERVAL_MS', 15000),
    minIntervalMs: intEnv('POLL_MIN_INTERVAL_MS', 8000),
  },
  webhook: {
    url: process.env.WEBHOOK_URL || '',
    secret: process.env.WEBHOOK_SECRET || '',
    maxAttempts: intEnv('WEBHOOK_MAX_ATTEMPTS', 5),
  },
};

module.exports = config;
