'use strict';

const config = require('./config');
const db = require('./db');
const payment = require('./payment');
const webhook = require('./webhook');
const { fetchMutasi } = require('./scraper/mutasi');

let running = false;
let stopRequested = false;
let timer = null;
let lastPollAt = 0;
let pollingNow = false;

/**
 * Hari ini di timezone Asia/Jakarta (WIB) sebagai yyyy-MM-dd.
 */
function todayInTz(tz = 'Asia/Jakarta') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA -> "yyyy-MM-dd"
}

async function tick(reason = 'interval') {
  if (stopRequested || pollingNow) return;
  const now = Date.now();
  if (now - lastPollAt < config.poller.minIntervalMs) return;

  // Expire stale dulu (cepat, gak perlu hit portal).
  const expiredIds = payment.expireStale();
  if (expiredIds.length > 0) {
    console.log(`[poller] expired ${expiredIds.length} stale payment(s)`);
  }

  // Skip kalau tidak ada pending — irit resource.
  const pending = db.listPendingPayments();
  if (pending.length === 0) {
    // Tetap flush webhook tertunda.
    await webhook.flushPending().catch((e) => console.error('[poller] webhook flush:', e.message));
    return;
  }

  pollingNow = true;
  lastPollAt = now;
  try {
    const today = todayInTz(config.payment.timezone);
    console.log(`[poller] (${reason}) scraping ${today} for ${pending.length} pending payment(s)`);
    const result = await fetchMutasi({ startDate: today, endDate: today });
    const matches = payment.tryMatchTransactions(result.data);
    if (matches.length > 0) {
      console.log(`[poller] matched ${matches.length} payment(s)`);
      for (const m of matches) {
        try {
          await webhook.deliverOne(m.payment);
        } catch (e) {
          console.error('[poller] webhook deliver error:', e.message);
        }
      }
    }
    // Flush webhook tertunda (dari run sebelumnya yg gagal).
    await webhook.flushPending();
  } catch (err) {
    console.error('[poller] error:', err.message);
  } finally {
    pollingNow = false;
  }
}

function start() {
  if (running) return;
  running = true;
  stopRequested = false;
  console.log(`[poller] start, interval=${config.poller.intervalMs}ms tz=${config.payment.timezone}`);
  // Kick-off awal
  setTimeout(() => tick('startup'), 1500);
  timer = setInterval(() => tick('interval'), config.poller.intervalMs);
}

function stop() {
  stopRequested = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  console.log('[poller] stopped');
}

/** Trigger poll manual (mis. setelah create payment, biar cek lebih cepat). */
function kick() {
  setTimeout(() => tick('manual'), 100);
}

module.exports = { start, stop, kick, todayInTz };
