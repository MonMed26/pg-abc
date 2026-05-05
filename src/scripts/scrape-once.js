'use strict';

/**
 * CLI helper: jalankan satu kali scrape mutasi & cetak JSON ke stdout.
 *
 * Usage:
 *   node src/scripts/scrape-once.js 2025-05-01 2025-05-05
 */

const { fetchMutasi } = require('../scraper/mutasi');

async function main() {
  const [, , startDate, endDate] = process.argv;
  if (!startDate || !endDate) {
    console.error('Usage: node src/scripts/scrape-once.js <YYYY-MM-DD> <YYYY-MM-DD>');
    process.exit(1);
  }
  try {
    const result = await fetchMutasi({ startDate, endDate });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(2);
  }
}

main();
