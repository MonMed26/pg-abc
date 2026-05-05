'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');

/**
 * Launch a Chromium browser instance.
 * Reuse one browser across requests when possible to save startup cost.
 */
async function launchBrowser() {
  return chromium.launch({
    headless: config.playwright.headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

/**
 * Create a new browser context. If a session file exists, restore it
 * (cookies + localStorage) so we don't have to login every request.
 */
async function newContext(browser) {
  const opts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
  };

  if (fs.existsSync(config.playwright.sessionFile)) {
    opts.storageState = config.playwright.sessionFile;
  }

  const ctx = await browser.newContext(opts);
  ctx.setDefaultTimeout(config.playwright.timeout);
  ctx.setDefaultNavigationTimeout(config.playwright.timeout);
  return ctx;
}

/**
 * Persist context cookies + storage to disk so subsequent runs reuse session.
 */
async function saveSession(context) {
  const dir = path.dirname(config.playwright.sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: config.playwright.sessionFile });
}

/**
 * Delete saved session (force re-login next time).
 */
function clearSession() {
  if (fs.existsSync(config.playwright.sessionFile)) {
    fs.unlinkSync(config.playwright.sessionFile);
  }
}

module.exports = {
  launchBrowser,
  newContext,
  saveSession,
  clearSession,
};
