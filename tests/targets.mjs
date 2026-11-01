// Phone ergonomics on every main screen at 390 px: tap targets smaller than
// 44 px, and text fields under 16 px (iOS zooms the page when one is focused).
//   PORT=8790 CHOIR=senior node targets.mjs
import { launch, openApp, settle, sql, DIRECTOR } from './pw.mjs';

const PORT = +(process.env.PORT || 8790), CHOIR = process.env.CHOIR || 'senior', MIN = 44;
const [ids] = await sql(PORT, `select (select id from singers where photo_path is not null order by sort_order limit 1) m,
  (select id from events where date <= '2026-11-01' and not cancelled order by date desc limit 1) e,
  (select id from events where date <= '2026-11-01' and not cancelled and kind <> 'rehearsal' order by date desc limit 1) s`);
const PUBLIC = [['home', '#/home'], ['attendance-grid', '#/attendance/grid'], ['attendance-summary', '#/attendance/summary'],
  ['songs', '#/songs/summary'], ['services', '#/services'], ['sheets', '#/sheets'], ['learning', '#/learning'], ['lyrics', '#/lyrics'],
  ['leaders', '#/leaders'], ['member', '#/member/' + ids.m], ['seating', '#/seating'], ['rules', '#/rules'], ['login', '#/login']];
const ADMIN = [['admin-events', '#/admin/attendance'], ['admin-mark', '#/admin/attendance/' + ids.e], ['admin-order', '#/admin/songs/' + ids.s],
  ['admin-songs', '#/admin/songlist'], ['admin-members', '#/admin/members'], ['usage', '#/usage']];

const scan = page => page.evaluate(MIN => {
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const name = el => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
    + [...el.attributes].filter(a => a.name.startsWith('data-')).slice(0, 1).map(a => `[${a.name}]`).join('');
  const small = {}, fields = {};
  document.querySelectorAll('a[href],button,select,input:not([type=hidden]),textarea,[role=button],label.mini').forEach(el => {
    if (!vis(el) || el.closest('.dock,[aria-hidden="true"]')) return;
    const r = el.getBoundingClientRect();
    // a link inside running text is exempt (WCAG 2.5.8 inline exception)
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return;
    // an invisible ::before hit area counts as part of the target
    const pb = getComputedStyle(el, '::before');
    const hw = pb.content !== 'none' && pb.position === 'absolute' ? parseFloat(pb.width) || 0 : 0;
    const hh = pb.content !== 'none' && pb.position === 'absolute' ? parseFloat(pb.height) || 0 : 0;
    if (Math.max(r.width, hw) < MIN - 0.5 || Math.max(r.height, hh) < MIN - 0.5) {
      const k = el.tagName.toLowerCase() + name(el);
      small[k] = small[k] || { n: 0, w: Math.round(r.width), h: Math.round(r.height) }; small[k].n++;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|file|range)$/.test(el.type)) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) fields[el.tagName.toLowerCase() + name(el) + (el.id ? '#' + el.id : '')] = fs;
    }
  });
  return { small, fields };
}, MIN);

const browser = await launch();
const page = await openApp(browser, { port: PORT, choir: CHOIR });
const report = async (n, h) => {
  await page.evaluate(x => { location.hash = x; }, h); await settle(page, 500);
  const { small, fields } = await scan(page);
  const s = Object.entries(small).sort((a, b) => b[1].n - a[1].n);
  console.log(`\n${n}: ${s.length} small target kinds${Object.keys(fields).length ? ', fields < 16px: ' + JSON.stringify(fields) : ''}`);
  s.slice(0, 12).forEach(([k, v]) => console.log(`   ${v.w}x${v.h}  ×${v.n}  ${k}`));
};
for (const [n, h] of PUBLIC) await report(n, h);
await page.evaluate(() => { location.hash = '#/login'; }); await page.waitForSelector('#em');
await page.fill('#em', DIRECTOR.email); await page.fill('#pw', DIRECTOR.password); await page.press('#pw', 'Enter');
await page.waitForFunction(() => location.hash.startsWith('#/admin')); await settle(page);
for (const [n, h] of ADMIN) await report(n, h);
await browser.close();
