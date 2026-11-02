// Freeze-frame check of every kind of transition: trigger it, pause the running
// animations at AT ms, screenshot that frame.  PORT=8790 AT=150 node motion_frames.mjs
import { launch, openApp, settle, DIRECTOR } from './pw.mjs';
const PORT = +(process.env.PORT || 8800), CHOIR = process.env.CHOIR || 'senior', OUT = process.env.OUT || '/tmp/motion';
const AT = +(process.env.AT || 180);
import fs from 'node:fs'; fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const page = await openApp(browser, { port: PORT, choir: CHOIR, hash: '#/services' });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await settle(page, 600);
async function freeze(name, trigger) {
  await trigger();
  const ok = await page.waitForFunction(() => document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity), null, { timeout: 3000 }).then(() => true, () => false);
  const info = await page.evaluate(at => {
    const anims = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity);
    anims.forEach(a => { a.pause(); a.currentTime = at; });
    return { n: anims.length, vt: document.documentElement.className, names: [...new Set(anims.map(a => a.animationName || (a.effect && a.effect.pseudoElement) || 'js'))].slice(0, 8) };
  }, AT);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name.padEnd(10), ok ? '' : '(no animation)', JSON.stringify(info));
  await page.evaluate(() => document.getAnimations().forEach(a => { try { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); } catch (_) {} }));
  await settle(page, 700);
}
await freeze('push', () => page.click('a.sbtn'));
await freeze('pop', () => page.evaluate(() => history.back()));
await freeze('tab', () => page.click('.dock [data-tab="att"]'));
await freeze('next', () => page.evaluate(() => { const a = [...document.querySelectorAll('#app .tabs a')].find(x => !x.classList.contains('on')); a.click(); }));
await page.click('[data-toggle-range]'); await settle(page, 400);
await freeze('swap', () => page.click('[data-preset="12"]'));
await page.evaluate(() => { location.hash = '#/leaders'; }); await settle(page, 1500);
await page.click('button.lbwho'); await settle(page, 900);
await freeze('sheet-out', () => page.mouse.click(195, 70));
await page.evaluate(() => { location.hash = '#/login'; }); await page.waitForSelector('#em');
await page.fill('#em', DIRECTOR.email); await page.fill('#pw', DIRECTOR.password); await page.press('#pw', 'Enter');
await page.waitForFunction(() => location.hash.startsWith('#/admin')); await settle(page, 800);
await page.evaluate(() => { location.hash = '#/admin/songlist'; }); await settle(page, 900);
await freeze('modal-in', () => page.click('[data-edit-song]'));
await freeze('modal-out', () => page.mouse.click(195, 16));
await freeze('lang', () => page.click('.mast [data-lang="ru"]'));
console.log('errors:', JSON.stringify(errs.slice(0, 5)));
await browser.close();
