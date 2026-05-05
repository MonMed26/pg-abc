'use strict';

const config = require('../config');

/**
 * Simple bearer-token middleware. Aktif hanya kalau API_TOKEN di-set.
 * Kalau API_TOKEN kosong, middleware ini no-op (cocok untuk dev lokal).
 */
function bearerAuth(req, res, next) {
  const expected = config.server.apiToken;
  if (!expected) return next();

  const header = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || m[1] !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

module.exports = { bearerAuth };
