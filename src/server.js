'use strict';

const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const qrisRouter = require('./routes/qris');
const paymentsRouter = require('./routes/payments');
const { bearerAuth } = require('./middleware/auth');
const poller = require('./poller');
const db = require('./db');
const { buildSpec } = require('./docs/openapi');

const app = express();

app.use(express.json({ limit: '256kb' }));

// Demo page (static files dari public/)
app.use(express.static(path.resolve('public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: config.server.nodeEnv, ts: new Date().toISOString() });
});

// API Docs (Swagger UI + raw OpenAPI spec)
const openapiSpec = buildSpec();
app.get('/docs.json', (_req, res) => res.json(openapiSpec));
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'BCA QRIS Gateway API Docs',
    customCss: '.swagger-ui .topbar { background: #005caa; }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
    },
  })
);

app.use('/api/qris', bearerAuth, qrisRouter);
app.use('/api/payments', bearerAuth, paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

const server = app.listen(config.server.port, () => {
  console.log(`[server] listening on http://localhost:${config.server.port}`);
  console.log(`[server] env=${config.server.nodeEnv} headless=${config.playwright.headless}`);
  if (!config.payment.qrisStatic) {
    console.warn('[server] WARNING: BCA_QRIS_STATIC kosong — endpoint /api/payments akan gagal create.');
  }
  // Init DB & start poller
  db.getDb();
  poller.start();
});

function shutdown(signal) {
  console.log(`\n[server] received ${signal}, shutting down...`);
  poller.stop();
  server.close(() => {
    db.close();
    console.log('[server] closed cleanly');
    process.exit(0);
  });
  // Force exit setelah 8 detik
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
