// The offline messages (5.62): every place that needs the server, tried with the device offline,
// on Wi-Fi with no internet, and with the server down — in English and Russian, light and dark.
// Runs against a stack started with start.sh (it reads ids from its database, writes nothing).
//   PORT=8790 CHOIR=senior node offline_test.mjs          (SHOTS=1 OUT=/tmp/x saves a screenshot of each state)
import fs from 'node:fs';
import { launch, openApp, settle, sql, DIRECTOR } from './pw.mjs';
const PORT = +(process.env.PORT || 8790), CHOIR = process.env.CHOIR === 'youth' ? 'youth' : 'senior', OUT = process.env.OUT || '/tmp/shots/offline-' + CHOIR;
const SHOTS = process.env.SHOTS === '1';
if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const msg = p => p.evaluate(() => { const e = document.querySelector('#loginmsg .lmsg'); return e ? { text: e.textContent, off: e.classList.contains('off'), nudge: e.classList.contains('nudge'), role: e.getAttribute('role') } : null; });
const shot = (p, name) => SHOTS ? p.screenshot({ path: `${OUT}/${name}.png` }) : null;
const T = {
  en: { off: 'You’re offline. Signing in needs an internet connection — check the Wi-Fi or mobile data.', srv: 'The choir’s server isn’t answering. Try again in a few minutes.',
        bad: 'That email and password don’t match. Check them and try again.', offAdmin: 'You’re offline. Changes can’t be saved until you’re back online.',
        offSave: 'You’re offline, so nothing was saved. Try again when you’re back online.', srvSave: 'The server isn’t answering, so nothing was saved. Try again in a few minutes.',
        busy: 'Signing in…', shvOff: 'You’re offline, and this sheet isn’t saved on this device yet. Connect to the internet to open it.', plOff: 'You’re offline — can’t play',
        offTitle: 'You’re offline', offStale: 'You’re offline — showing what was loaded earlier.' },
  ru: { off: 'Нет сети. Для входа нужен интернет — проверьте Wi-Fi или мобильную связь.', srv: 'Сервер хора не отвечает. Попробуйте ещё раз через несколько минут.',
        bad: 'Эл. почта или пароль не подходят. Проверьте их и попробуйте снова.', offAdmin: 'Нет сети. Изменения нельзя сохранить, пока не появится связь.',
        offSave: 'Нет сети, поэтому ничего не сохранено. Попробуйте снова, когда появится связь.', srvSave: 'Сервер не отвечает, поэтому ничего не сохранено. Попробуйте ещё раз через несколько минут.',
        busy: 'Входим…', shvOff: 'Нет сети, а эти ноты ещё не сохранены на устройстве. Подключитесь к интернету, чтобы открыть их.', plOff: 'Нет сети — запись недоступна',
        offTitle: 'Нет сети', offStale: 'Нет сети — показаны данные, загруженные ранее.' }
};
// "Wi-Fi with no internet": the device thinks it's online, every request fails (the probe included)
const noInternet = p => p.route('**/*', r => r.abort('internetdisconnected'));
// "the server is down": the site answers, the choir's database doesn't
const serverDown = p => p.route(/\/(auth|rest|storage)\/v1\//, r => r.abort('connectionrefused'));
const fill = async p => { await p.fill('#em', DIRECTOR.email); await p.fill('#pw', DIRECTOR.password); };
const browser = await launch();
const [ids] = await sql(PORT, `select (select id from events where date <= '2026-11-01' and not cancelled order by date desc limit 1) as recent,
  (select id from songs where pdf_path is not null and not coalesce(pdf_locked, false) and active and not learning order by title limit 1) as sheet,
  (select id || ':' || (select k from jsonb_object_keys(part_audio) k where part_audio->k ? 'path' and part_audio->k->>'path' like '%.mp3' limit 1)
     from songs where part_audio is not null and active and not learning
       and exists (select 1 from jsonb_object_keys(part_audio) k where part_audio->k ? 'path' and part_audio->k->>'path' like '%.mp3') order by title limit 1) as rec`);
const tapSel = async (p, sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.click(); await p.waitForTimeout(350); };

for (const lang of (process.env.LANGS || 'en,ru').split(',')) for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
  const L = T[lang], tag = `${lang}-${theme}`, full = theme === 'light';
  console.log(`\n== ${tag}`);
  // 1. device offline on the sign-in page: said before anything is typed; a try says it again, with a shake
  let p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/login' });
  await p.context().setOffline(true); await p.waitForTimeout(450);
  let m = await msg(p);
  ok(m && m.text === L.off && m.off && m.role === 'status', 'offline notice before signing in: ' + JSON.stringify(m && m.text));
  await shot(p, `login-offline-${tag}`);
  if (full) {
    await fill(p); await p.click('[data-login]'); await p.waitForTimeout(700);
    m = await msg(p);
    ok(m && m.text === L.off && m.nudge && m.role === 'alert', 'offline sign-in attempt: same words, a shake, announced');
    ok(await p.inputValue('#em') === DIRECTOR.email && (await p.inputValue('#pw')).length > 0, 'what was typed is kept');
    ok(await p.evaluate(() => !document.querySelector('[data-login]').disabled), 'the button is usable again');
    // back online: the notice goes, and signing in works
    await p.context().setOffline(false); await p.waitForTimeout(300);
    ok(!(await msg(p)), 'back online: the notice is gone');
    await p.click('[data-login]');
    await p.waitForFunction(() => location.hash.startsWith('#/admin'), null, { timeout: 10000 }).then(() => ok(true, 'signed in once back online'), () => ok(false, 'signed in once back online'));
  }
  await p.context().close();

  // 2. Wi-Fi with no internet: the browser still says "online"; the try ends in "you're offline"
  p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/login' });
  ok(!(await msg(p)), 'online: no notice on the sign-in page');
  await noInternet(p); await fill(p);
  await p.click('[data-login]'); await p.waitForSelector('#loginmsg .lmsg', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
  m = await msg(p);
  ok(m && m.text === L.off, 'no internet: ' + JSON.stringify(m && m.text));
  await shot(p, `login-nointernet-tried-${tag}`);
  await p.context().close();

  if (!full) continue;
  // 3. the server is down but the internet works: "the server isn't answering"
  p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/login' });
  await serverDown(p); await fill(p);
  await p.click('[data-login]'); await p.waitForSelector('#loginmsg .lmsg', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(450);                         // the message has finished sliding in
  m = await msg(p);
  ok(m && m.text === L.srv && !m.off, 'server down: ' + JSON.stringify(m && m.text));
  await shot(p, `login-serverdown-${tag}`);
  await p.unroute(/\/(auth|rest|storage)\/v1\//);
  // 4. a wrong password, in the reader's language; then the right one at once (as D1 does)
  await p.fill('#pw', 'not-the-password'); await p.press('#pw', 'Enter');
  await p.waitForFunction(t => { const e = document.querySelector('#loginmsg .lmsg'); return e && e.textContent === t; }, L.bad, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(450);
  m = await msg(p);
  ok(m && m.text === L.bad && !m.off, 'wrong password: ' + JSON.stringify(m && m.text));
  await shot(p, `login-wrongpass-${tag}`);
  await p.fill('#pw', DIRECTOR.password); await p.press('#pw', 'Enter');
  await p.waitForFunction(() => location.hash.startsWith('#/admin'), null, { timeout: 10000 }).then(() => ok(true, 'right password straight after: signed in'), () => ok(false, 'right password straight after: signed in'));
  await settle(p, 300);

  // 5. director page: offline banner; a save says offline; back online clears both
  await p.evaluate(id => { location.hash = '#/admin/attendance/' + id; }, ids.recent); await settle(p, 400);
  await p.context().setOffline(true); await p.waitForTimeout(400);
  const banner = () => p.evaluate(() => { const b = document.querySelector('.banner.off'); return b ? b.textContent.trim() : null; });
  ok(await banner() === L.offAdmin, 'admin offline banner: ' + JSON.stringify(await banner()));
  const pill = await p.$('[data-toggle-absent]');
  if (pill) { await pill.click(); await p.waitForTimeout(200); }
  const save = await p.$('[data-save-marks]');
  if (save) { await save.click(); await p.waitForTimeout(900); }
  const toast = () => p.evaluate(() => { const x = document.querySelector('.toast .m'); return x ? x.textContent : null; });
  ok(await toast() === L.offSave, 'save while offline: ' + JSON.stringify(await toast()));
  await shot(p, `admin-offline-save-${tag}`);
  await p.context().setOffline(false); await p.waitForTimeout(600);
  ok(!(await banner()) && !(await toast()), 'back online: banner and message gone');
  // the server down while saving: "the server isn't answering"
  await serverDown(p);
  const save2 = await p.$('[data-save-marks]');
  if (save2) { await save2.click(); await p.waitForTimeout(1200); }
  ok(await toast() === L.srvSave, 'save with the server down: ' + JSON.stringify(await toast()));
  await p.unroute(/\/(auth|rest|storage)\/v1\//);
  // the usage page offline
  await p.context().setOffline(true);
  p.once('dialog', d => d.accept());           // the unsaved marks: leave them (they survived both failed saves)
  await p.evaluate(() => { location.hash = '#/usage'; }); await p.waitForTimeout(900);
  const st = await p.evaluate(() => { const s = document.querySelector('.state'); return s ? s.querySelector('.state-t').textContent : null; });
  ok(st === L.offTitle, 'usage page offline: ' + JSON.stringify(st));
  await shot(p, `usage-offline-${tag}`);
  await p.context().close();

  // 6. a sheet not on the device, offline; a recording offline
  p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/sheets' });
  await p.context().setOffline(true); await p.waitForTimeout(200);
  await tapSel(p, `[data-srow="${ids.sheet}"] [data-tray]`);
  await tapSel(p, `[data-open="sheets:${ids.sheet}"]`); await p.waitForTimeout(700);
  const sv = await p.evaluate(() => { const x = document.querySelector('.shv-msg:not([hidden]) p'); return x ? x.textContent : null; });
  ok(sv === L.shvOff, 'sheet offline: ' + JSON.stringify(sv));
  await shot(p, `sheet-offline-${tag}`);
  await p.context().close();
  p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/sheets' });
  const [rid, rpart] = ids.rec.split(':'), lp = true;
  await tapSel(p, `[data-srow="${rid}"] [data-tray]`);
  await tapSel(p, `[data-listen="sheets:${rid}"]`);
  await p.context().setOffline(true);
  await tapSel(p, `[data-lp="${rid}:${rpart}"]`); await p.waitForTimeout(1500);
  const pl = await p.evaluate(() => { const b = document.querySelector('.plbar .pl-part b'); return b ? b.textContent : null; });
  ok(pl === L.plOff, 'recording offline: ' + JSON.stringify(pl) + (lp ? '' : ' (no recording found)'));
  await shot(p, `player-offline-${tag}`);
  await p.context().close();

  // 7. first visit with no internet and nothing saved: "you're offline"
  p = await openApp(browser, { port: PORT, choir: CHOIR, lang, theme, hash: '#/home', wait: false });
  await p.context().close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: theme, locale: lang === 'ru' ? 'ru-RU' : 'en-US' });
  const p2 = await ctx.newPage();
  await p2.addInitScript(([lang, theme, choir]) => { const k = choir === 'youth' ? ['bsebc-youth-lang', 'bsebc-youth-theme'] : ['bsebc-lang', 'bsebc-theme-mode']; localStorage.setItem(k[0], lang); localStorage.setItem(k[1], theme); }, [lang, theme, CHOIR]);
  await p2.route(/\/(auth|rest|storage)\/v1\//, r => r.abort('internetdisconnected'));
  await p2.route(/\?online=/, r => r.abort('internetdisconnected'));
  await p2.goto(`http://127.0.0.1:${PORT}/#/home`);
  await p2.waitForSelector('.state .state-t', { timeout: 20000 }).catch(() => {});
  const fst = await p2.evaluate(() => { const s = document.querySelector('.state'); return s ? s.querySelector('.state-t').textContent + ' | ' + (s.querySelector('.state-b') || {}).textContent + ' | detail:' + !!s.querySelector('.state-x') : null; });
  ok(fst && fst.startsWith(L.offTitle + ' |') && fst.endsWith('detail:false'), 'first load, no internet: ' + JSON.stringify(fst));
  await p2.screenshot({ path: `${OUT}/firstload-offline-${tag}.png` });
  await ctx.close();
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
