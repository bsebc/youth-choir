// Screenshots of every main screen, light and dark, English and Russian, on a
// 390 px phone (and optionally a desktop width), for before/after comparisons.
//   PORT=8796 CHOIR=senior OUT=/tmp/shots/before node shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, openApp, settle, sql, DIRECTOR } from './pw.mjs';

const PORT = +(process.env.PORT || 8796);
const CHOIR = process.env.CHOIR || 'senior';
const OUT = process.env.OUT || '/tmp/shots/' + CHOIR;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const LANGS = (process.env.LANGS || 'en,ru').split(',');
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const WIDE = process.env.WIDE === '1';
fs.mkdirSync(OUT, { recursive: true });

const [ids] = await sql(PORT, `select
  (select id from singers where photo_path is not null order by sort_order limit 1) as member,
  (select id from events where date <= '2026-11-01' and not cancelled and kind <> 'rehearsal' order by date desc limit 1) as service,
  (select id from events where date <= '2026-11-01' and not cancelled order by date desc limit 1) as recent`);

const PUBLIC = [
  ['home', '#/home'], ['attendance-grid', '#/attendance/grid'], ['attendance-summary', '#/attendance/summary'],
  ['songs', '#/songs/summary'], ['services', '#/services'], ['sheets', '#/sheets'], ['learning', '#/learning'],
  ['lyrics', '#/lyrics'], ['leaders', '#/leaders'], ['member', '#/member/' + ids.member], ['seating', '#/seating'],
  ['rules', '#/rules'], ['login', '#/login']
];
const DIRECTOR_SCREENS = [
  ['admin-events', '#/admin/attendance'], ['admin-mark', '#/admin/attendance/' + ids.recent],
  ['admin-order', '#/admin/songs/' + ids.service], ['admin-songs', '#/admin/songlist'],
  ['admin-members', '#/admin/members'], ['usage', '#/usage']
];

async function signIn(page) {
  await page.evaluate(() => { location.hash = '#/login'; });
  await page.waitForSelector('#em', { timeout: 10000 });
  await page.fill('#em', DIRECTOR.email);
  await page.fill('#pw', DIRECTOR.password);
  await page.press('#pw', 'Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/admin'), null, { timeout: 10000 });
  await settle(page);
}

const browser = await launch();
const sizes = [['phone', { width: 390, height: 844 }]].concat(WIDE ? [['desktop', { width: 1280, height: 860 }]] : []);
const index = [];
for (const [sizeName, viewport] of sizes) for (const lang of LANGS) for (const theme of THEMES) {
  const page = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, viewport, hash: '#/home' });
  const shoot = async (name, hash) => {
    if (ONLY && !ONLY.includes(name)) return;
    await page.evaluate(h => { location.hash = h; }, hash);
    await settle(page, 700);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const file = `${name}.${sizeName}.${lang}.${theme}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    index.push({ name, size: sizeName, lang, theme, file, overflow, errors: page.__errors.splice(0) });
  };
  for (const [name, hash] of PUBLIC) await shoot(name, hash);
  if (!ONLY || DIRECTOR_SCREENS.some(([n]) => ONLY.includes(n))) {
    await signIn(page);
    for (const [name, hash] of DIRECTOR_SCREENS) await shoot(name, hash);
  }
  await page.context().close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
const bad = index.filter(x => x.overflow > 0 || x.errors.length);
console.log(`${index.length} screenshots in ${OUT}`);
bad.forEach(x => console.log(`  ${x.file}: overflow ${x.overflow}px${x.errors.length ? ', errors: ' + x.errors.join(' | ') : ''}`));
