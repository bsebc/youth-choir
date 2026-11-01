// Accessibility check of every main screen with axe-core (WCAG 2.1 A/AA rules),
// light and dark, as a guest and as the director.
//   PORT=8796 CHOIR=senior node a11y.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openApp, settle, sql, DIRECTOR } from './pw.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AXE = fs.readFileSync(path.join(HERE, 'node_modules/axe-core/axe.min.js'), 'utf8');
const PORT = +(process.env.PORT || 8796), CHOIR = process.env.CHOIR || 'senior';
const [ids] = await sql(PORT, `select (select id from singers where photo_path is not null order by sort_order limit 1) m,
  (select id from events where date <= '2026-11-01' and not cancelled order by date desc limit 1) e`);
const SCREENS = [['home', '#/home'], ['attendance-grid', '#/attendance/grid'], ['attendance-summary', '#/attendance/summary'], ['songs', '#/songs/summary'],
  ['services', '#/services'], ['sheets', '#/sheets'], ['learning', '#/learning'], ['lyrics', '#/lyrics'], ['leaders', '#/leaders'],
  ['member', '#/member/' + ids.m], ['seating', '#/seating'], ['rules', '#/rules'], ['login', '#/login']];
const ADMIN = [['admin-mark', '#/admin/attendance/' + ids.e], ['admin-songs', '#/admin/songlist'], ['admin-members', '#/admin/members'], ['usage', '#/usage']];
const browser = await launch();
const totals = {}; const perScreen = [];
for (const theme of ['light', 'dark']) {
  const page = await openApp(browser, { port: PORT, choir: CHOIR, theme });
  // finished animations only: a fade caught halfway reads as a contrast failure
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const run = async (name, hash) => {
    await page.evaluate(h => { location.hash = h; }, hash); await settle(page, 600);
    await page.evaluate(AXE);
    const r = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })).violations
      .map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0] && v.nodes[0].target.join(' '),
        // colour pairs, so a contrast failure can be fixed at its token
        pairs: v.id !== 'color-contrast' ? undefined : [...new Set(v.nodes.map(nd => { const d = (nd.any[0] || {}).data || {};
          return `${nd.target.join(' ').slice(-60)} | ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}`; }))].slice(0, 12) })));
    perScreen.push({ name, theme, violations: r });
    r.forEach(v => { const k = v.id; totals[k] = totals[k] || { impact: v.impact, nodes: 0, screens: 0 }; totals[k].nodes += v.n; totals[k].screens++; });
  };
  for (const [n, h] of SCREENS) await run(n, h);
  await page.evaluate(() => { location.hash = '#/login'; }); await page.waitForSelector('#em');
  await page.fill('#em', DIRECTOR.email); await page.fill('#pw', DIRECTOR.password); await page.press('#pw', 'Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/admin')); await settle(page);
  for (const [n, h] of ADMIN) await run(n, h);
  await page.context().close();
}
await browser.close();
const out = process.env.OUT || `/tmp/a11y-${CHOIR}.json`;
fs.writeFileSync(out, JSON.stringify({ totals, perScreen }, null, 1));
const rows = Object.entries(totals).sort((a, b) => b[1].nodes - a[1].nodes);
console.log(`axe violations (WCAG 2.1 A/AA), ${perScreen.length} screen views:`);
rows.forEach(([id, t]) => console.log(`  ${t.impact.padEnd(9)} ${id.padEnd(28)} ${String(t.nodes).padStart(5)} elements on ${t.screens} views`));
console.log(`  total: ${rows.reduce((s, [, t]) => s + t.nodes, 0)} elements, ${rows.length} rules`);
