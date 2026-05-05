'use strict';

const express = require('express');
const { fetchMutasi } = require('../scraper/mutasi');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/qris/mutasi?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get('/mutasi', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) {
    return res.status(400).json({
      error: 'invalid_query',
      message: 'startDate & endDate wajib format YYYY-MM-DD',
    });
  }

  if (startDate > endDate) {
    return res.status(400).json({
      error: 'invalid_query',
      message: 'startDate tidak boleh lebih besar dari endDate',
    });
  }

  try {
    const result = await fetchMutasi({ startDate, endDate });
    return res.json({
      success: true,
      query: { startDate, endDate },
      merchantId: result.merchantId,
      count: result.data.length,
      perDay: result.perDay,
      warnings: result.warnings,
      fetchedAt: result.fetchedAt,
      data: result.data,
    });
  } catch (err) {
    console.error('[mutasi] error:', err);
    const status = /maksimal|hari terakhir|masa depan/i.test(err.message) ? 400 : 502;
    return res.status(status).json({
      error: status === 400 ? 'invalid_query' : 'scrape_failed',
      message: err.message || String(err),
    });
  }
});

module.exports = router;
