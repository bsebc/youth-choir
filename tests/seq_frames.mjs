// Frame-by-frame look at one transition: start on HASH, run the trigger, pause every
// running animation at once, then step them through TIMES (ms) and screenshot each.
//   PORT=8800 HASH='#/sheets' CLICK='#app .tabs a:not(.on)' THEME=dark W=390 H=844 node seq_frames.mjs
// CLICK is a selector; JS='...' runs code in the page instead. Frames land in OUT/<name>-<t>.png.
import { launch, openApp, settle } from './pw.mjs';
import fs from 'node:fs';
const E = process.env;
const PORT = +(E.PORT || 8800), CHOIR = E.CHOIR || 'senior', OUT = E.OUT || '/tmp/seq', NAME = E.NAME || 'seq';
const TIMES = (E.TIMES || '0,30,60,90,120,160,200,250,300,380').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const page = await openApp(browser, { port: PORT, choir: CHOIR, hash: E.HASH || '#/sheets', theme: E.THEME || 'light',
  viewport: { width: +(E.W || 390), height: +(E.H || 844) } });
await settle(page, 900);
if (E.SCROLL) { await page.evaluate(y => window.scrollTo(0, y), +E.SCROLL); await page.waitForTimeout(300); }
if (E.PRE) { await page.evaluate(E.PRE); await settle(page, 900); }
if (E.JS) await page.evaluate(E.JS); else await page.click(E.CLICK);
const ok = await page.waitForFunction(vt => vt ? document.getAnimations().some(a => a.effect && /view-transition/.test(a.effect.pseudoElement || ''))
    : document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity),
  !E.NOVT, { timeout: 1500, polling: 'raf' }).then(() => true, () => false);
const cls = await page.evaluate(() => document.documentElement.className);
const list = await page.evaluate(() => {
  const an = document.getAnimations().filter(a => a.effect && a.effect.getComputedTiming().endTime !== Infinity);
  an.forEach(a => a.pause());
  return an.map(a => (a.animationName || a.transitionProperty || 'js') + (a.effect.pseudoElement ? ' ' + a.effect.pseudoElement : '') + ' ' + Math.round(a.effect.getComputedTiming().endTime) + 'ms');
});
console.log(NAME, ok ? '' : '(no view transition)', cls, JSON.stringify(list));
for (const t of TIMES) {
  await page.evaluate(t => document.getAnimations().forEach(a => { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) { a.pause(); a.currentTime = Math.min(t, a.effect.getComputedTiming().endTime - 0.01); } }), t);
  await page.waitForTimeout(40);
  await page.screenshot({ path: `${OUT}/${NAME}-${String(t).padStart(4, '0')}.png` });
}
await page.evaluate(() => document.getAnimations().forEach(a => { try { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); } catch (_) {} }));
await settle(page, 500);
await page.screenshot({ path: `${OUT}/${NAME}-end.png` });
if (page.__errors.length) console.log('errors:', JSON.stringify(page.__errors.slice(0, 4)));
await browser.close();
