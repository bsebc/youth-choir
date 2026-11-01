// Playwright helpers shared by the browser tests and the screenshot script.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPA = path.join(HERE, 'vendor', 'supabase-js-2.118.0.mjs');

export const DIRECTOR = { email: 'director@example.test', password: 'choir-test-pass' };

export async function launch() {
  const env = Object.assign({}, process.env);
  if (fs.existsSync('/tmp/fontconfig/fonts.conf')) env.FONTCONFIG_FILE = '/tmp/fontconfig/fonts.conf';
  return chromium.launch({ env });
}

// Storage keys differ between the two apps; derive them from the page itself.
export const KEYS = {
  senior: { lang: 'bsebc-lang', me: 'bsebc-me', theme: 'bsebc-theme-mode' },
  youth:  { lang: 'bsebc-youth-lang', me: 'bsebc-youth-me', theme: 'bsebc-youth-theme' }
};

// Opens the app on a phone-sized screen (iPhone 14/15: 390 x 844) with a fixed clock.
export async function openApp(browser, { port, choir = 'senior', lang = 'en', theme = 'light', me = null, hash = '#/home',
    now = '2026-11-01T15:30:00Z', viewport = { width: 390, height: 844 }, colorScheme, wait = true } = {}) {
  const mobile = viewport.width < 700;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: colorScheme || (theme === 'dark' ? 'dark' : 'light'),
    hasTouch: mobile, isMobile: mobile, timezoneId: 'America/New_York', locale: lang === 'ru' ? 'ru-RU' : 'en-US',
    serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|status of 40[0-9]/.test(m.text())) page.__errors.push(m.text()); });
  await page.route(/https:\/\/esm\.sh\/@supabase\/supabase-js@2.*/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(SUPA), headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.clock.install({ time: new Date(now) });
  const K = KEYS[choir];
  await page.addInitScript(([K, lang, theme, me]) => {
    if (sessionStorage.getItem('__seeded')) return;
    localStorage.setItem(K.lang, lang);
    localStorage.setItem(K.theme, theme);
    if (me) localStorage.setItem(K.me, me);
    sessionStorage.setItem('__seeded', '1');
  }, [K, lang, theme, me]);
  await page.goto(`http://127.0.0.1:${port}/${hash}`);
  if (wait) await settle(page);
  return page;
}

// Waits until data has loaded and nothing is animating.
export async function settle(page, ms = 500) {
  await page.waitForFunction(() => document.body && document.body.innerText.length > 40 && !document.querySelector('.skel, .loading, [aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

export async function sql(port, q) {
  const r = await fetch(`http://127.0.0.1:${port}/__test/sql`, { method: 'POST', body: q });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
