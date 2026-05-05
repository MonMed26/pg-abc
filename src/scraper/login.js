'use strict';

const config = require('../config');
const { saveSession } = require('../browser');

/**
 * Login flow untuk https://qr.klikbca.com/
 *
 * Halaman login: input email + input password (name="password") + button "Masuk".
 * Form pakai Angular (bukan POST tradisional). Setelah login redirect ke
 *   https://qr.klikbca.com/home?mid=<merchantId>
 *
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<{ page: import('playwright').Page, mid: string }>}
 */
async function login(context) {
  const page = await context.newPage();
  await page.goto(config.portal.url, { waitUntil: 'domcontentloaded' });

  // Kalau sesi sebelumnya sudah valid, beri waktu Angular auto-redirect ke /home?mid=...
  await page.waitForURL(/\/home\?mid=/i, { timeout: 8000 }).catch(() => {});
  if (await isLoggedIn(page)) {
    // mid baru di-append ke URL setelah Angular fetch profil; tunggu hingga ada.
    if (!extractMid(page.url())) {
      await page.waitForURL(/\/home\?mid=/i, { timeout: 8000 }).catch(() => {});
    }
    return { page, mid: extractMid(page.url()) };
  }

  await page.waitForSelector('input[type="email"]', { state: 'visible' });
  await page.locator('input[type="email"]').first().fill(config.portal.username);
  await page.locator('input[type="password"][name="password"]').first().fill(config.portal.password);

  await Promise.all([
    page.waitForURL(/\/home/i, { timeout: config.playwright.timeout }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ]);

  // Beri Angular waktu render dashboard.
  await page.waitForTimeout(1500);

  if (!(await isLoggedIn(page))) {
    const snippet = ((await page.textContent('body').catch(() => '')) || '')
      .replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`Login gagal. URL=${page.url()} Snippet="${snippet}"`);
  }

  await saveSession(context);
  return { page, mid: extractMid(page.url()) };
}

/**
 * Heuristik: dianggap login kalau URL sudah berada di /home dan ada query mid.
 */
async function isLoggedIn(page) {
  const url = page.url();
  if (/\/login/i.test(url)) return false;
  if (/\/home/i.test(url)) return true;
  // Kalau URL bukan /login dan bukan /home, cek apakah masih ada form password.
  const hasPwd = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  return !hasPwd;
}

function extractMid(url) {
  try {
    return new URL(url).searchParams.get('mid') || '';
  } catch (_) {
    return '';
  }
}

module.exports = { login, isLoggedIn, extractMid };
