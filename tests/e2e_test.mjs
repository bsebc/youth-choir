// End-to-end browser checks of the core functions listed in CORE_FUNCTIONS.md
// (A1–A20 for everyone, D1–D17 for the signed-in director), run in a real
// browser against the local stack (server.mjs over local Postgres).
//
//   PORT=8792 CHOIR=senior SITE=/home/claude/original/senior node e2e_test.mjs   (pristine copy)
//   PORT=8793 CHOIR=youth  SITE=/home/claude/original/youth  node e2e_test.mjs
//   PORT=8792 CHOIR=senior SITE=/home/claude/bsebc-choir node e2e_test.mjs       (working tree)
//   PORT=8793 CHOIR=youth  SITE=/home/claude/youth-choir  node e2e_test.mjs
//
// Optional: DB=<name> (default e2e_<choir>), SCHEMA=new (reset with the
// ../supabase/migrations files applied; MIGRATIONS=<dir> picks another folder),
// ONLY=<regex of check ids>, VERBOSE=1 (timings, Playwright call logs),
// NO_RESET=1 (reuse the running stack as it is).
//
// Every run rebuilds its own database with reset.sh and restarts its stack with
// start.sh, so runs are repeatable. Expected values are read from the database,
// never hard-coded, so the same file checks both choirs.
//
// Elements are found by data-* attributes, element ids and hash routes; ARIA is only
// read for state (aria-pressed, a button's label); wording comes from the site's own
// i18n table, read from SITE/index.html at start-up, so changed texts follow along.
// The few things only a class or tag identifies, and the few literal texts that
// are not in the app's i18n table, are kept in the UI map below.
//
// Test hooks: window.print, the clipboard and HTMLMediaElement.play are wrapped so
// a print, a copied share message and the playing recording can be checked. Not
// covered: the real print dialog and iOS print paths, PDF rendering in the new
// window (the signed link is fetched instead), the native share sheet, offline
// sheets (pw.mjs blocks the service worker), swipe and drag-and-drop gestures.
// D17b–e make the database refuse writes silently (a restrictive row-level
// policy, dropped afterwards), which is what an expired or wrong session does live.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, openApp, settle, sql as sqlAt, DIRECTOR, KEYS } from './pw.mjs';

process.env.TZ = 'America/New_York';          // the browser's time zone (pw.mjs), so dates agree
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8792);
const CHOIR = process.env.CHOIR === 'youth' ? 'youth' : 'senior';
const SITE = path.resolve(process.env.SITE || path.join(HERE, '..'));
const DB = process.env.DB || 'e2e_' + CHOIR;
const STORE = '/tmp/harness-storage/' + DB;   // where start.sh keeps this stack's files
const BASE = 'http://127.0.0.1:' + PORT;
const NOW = '2026-11-01T15:30:00Z';           // pw.mjs's fixed clock: 10:30 on a Sunday in New York
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const VERBOSE = !!process.env.VERBOSE;
const K = KEYS[CHOIR];

/* ---------- everything a redesign may change: the only class/tag selectors and the
   only literal texts (all other wording comes from the app's own i18n table) ---------- */
const UI = {
  gridCols: 160,          // attendance grid: columns drawn before "Show all"
  /* selectors */
  main: 'main',                                         // the page body (not the bars, menus or dialogs)
  kpi: 'a.kpi',                                         // home stat tiles; told apart by href
  card: 'article',                                      // one learning card
  cardTitle: 'article h3',                              // its song title
  pageTitle: 'main h1',                                 // the song title on a lyrics page
  doc: 'main article',                                  // the rendered rules document
  docHead: 'h1,h2,h3,h4', docItem: 'li',                // its headings and list items
  admTools: 'button[data-adm-row]',                     // phones: the row itself only opens the tray
  gridScroll: '.scroll',                                // the attendance grid's scroll box
  gridHead: '.gwrap > .row.hmonth, .gwrap > .row.hday', // the two sticky header rows
  gridDay: '.gwrap > .row.hday > .d',                   // one header cell per event
  gridRow: '.gwrap > .row:not(.hmonth):not(.hday)',     // one row per singer
  gridName: '.name', gridTally: '.tally', gridCell: '.cell',
  standing: 'ol.lbrank:not(.lbpin) > li', place: '.rk', // leaderboard "Full standings"
  /* texts and formats that are not in the i18n table */
  mark: { present: '✓', absent: 'A', na: '–', cancelled: '×' },   // grid cells (English)
  none: '—',                                            // an empty tally or percentage
  count: (a, b) => a + '/' + b,                         // "came/of" in the summary, "seated/total" on the seating chart
  countRe: /(\d+)\/(\d+)/, pctRe: /(\d+)%/,
  pvTag: /№\d+\s*$/,                                    // the song-book number after a title
  longDate: iso => { const [y, m, d] = iso.split('-').map(Number); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] + ' ' + d + ', ' + y; },
  csvAtt: { head: ['singer', 'part'], present: 'Present', absent: 'Absent', na: 'Not Listed', cancelled: 'Cancelled' },
  csvSongs: ['date', 'event', 'no', 'song', 'subtitle'],
};

/* ---------- the app's own strings, read from index.html ---------- */
function loadConst(file, names) {           // an object literal from the app's source, e.g. its i18n table
  const src = fs.readFileSync(file, 'utf8');
  const m = new RegExp('const\\s+(' + names + ')\\s*=\\s*\\{').exec(src);
  if (!m) return null;
  let i = m.index + m[0].length - 1, depth = 0, q = null;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  return vm.runInNewContext('(' + src.slice(start, i + 1) + ')');
}
const STR = loadConst(path.join(SITE, 'index.html'), 'STR|T');
if (!STR) throw new Error('i18n table (const STR = {…}) not found in ' + path.join(SITE, 'index.html'));
const tr = (lang, key, ...a) => { const v = STR[lang][key]; if (v === undefined) throw new Error('no string ' + key); return typeof v === 'function' ? v(...a) : v; };
const t = (key, ...a) => tr('en', key, ...a);
const PARTS = ['soprano', 'alto', 'tenor', 'bass'];
const KIND_LABEL = loadConst(path.join(SITE, 'index.html'), 'KIND_LABEL') || { en: { rehearsal: 'R', morning: 'M', evening: 'E' }, ru: { rehearsal: 'Сп', morning: 'Ут', evening: 'Вч' } };

/* ---------- small helpers ---------- */
const sql = q => sqlAt(PORT, q);
const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = id => String(id).slice(0, 8);
const show = v => { const s = JSON.stringify(v); return s && s.length > 220 ? s.slice(0, 217) + '…' : s; };
class Fail extends Error {}
const fail = msg => { throw new Fail(msg); };
const ok = (cond, msg) => { if (!cond) fail(msg); };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: expected ${show(want)}, got ${show(got)}`); };
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms; let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) fail('timed out waiting for ' + what + (last instanceof Error ? ' (' + last.message + ')' : ''));
    await sleep(120);
  }
}
/* the texts in order, each found after the previous one */
function inOrder(text, items, what) {
  let pos = 0;
  for (const it of items) {
    const i = text.indexOf(it, pos);
    if (i < 0) fail(`${what}: "${it}" missing or out of order`);
    pos = i + it.length;
  }
}
function localISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const TODAY = localISO(new Date(NOW));
function shift(months) { const d = new Date(NOW); d.setMonth(d.getMonth() - months); return localISO(d); }
const fmtLong = iso => UI.longDate(iso);
const SEL = Object.fromEntries(Object.entries(UI).filter(([, v]) => typeof v === 'string'));   // the selectors, for use inside the page
const ruCmp = (a, b) => a.localeCompare(b, 'ru');
const kindRank = k => k === 'morning' ? 0 : k === 'evening' ? 2 : 1;
const byDateKind = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : kindRank(a.kind) - kindRank(b.kind);
async function post(p, body) { const r = await fetch(BASE + p, { method: 'POST', body: JSON.stringify(body) }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }

/* Russian titles and names typed in English letters (the app's documented search rule) */
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'iu', я: 'ia', і: 'i', ї: 'i', є: 'e', ґ: 'g' };
const lat = x => String(x || '').toLowerCase().replace(/[а-яёіїєґ]/g, c => CYR[c] ?? c)
  .replace(/shch|sch/g, 'sh').replace(/kh/g, 'h').replace(/tz/g, 'ts').replace(/ph/g, 'f').replace(/w/g, 'v').replace(/q/g, 'k').replace(/x/g, 'ks')
  .replace(/[yj]/g, 'i').replace(/c(?!h)/g, 'k').replace(/[^a-z0-9 ]+/g, '').replace(/([a-z])\1+/g, '$1').replace(/ie/g, 'e').replace(/\s+/g, ' ').trim();

/* ---------- what the database says (the expected values) ---------- */
let M;
async function loadModel() {
  const [singers, songs, events, absences, eventSongs, categories, docs] = await Promise.all([
    sql('select * from singers order by part, sort_order, name'),
    sql('select * from songs order by title, id'),
    sql('select * from events order by date, id'),
    sql('select * from absences'),
    sql('select * from event_songs order by event_id, position, song_id'),
    sql('select * from song_categories order by name'),
    sql("select * from documents where key = 'rules'"),
  ]);
  const m = { singers, songs, events, absences, eventSongs, categories, rules: docs[0] || null };
  m.abs = new Map(absences.map(a => [a.event_id + '|' + a.singer_id, a.status]));
  m.absEv = new Set(absences.map(a => a.event_id));
  m.song = new Map(songs.map(s => [s.id, s]));
  m.singer = new Map(singers.map(s => [s.id, s]));
  m.cat = new Map(categories.map(c => [c.id, c.name]));
  const esBy = new Map();
  eventSongs.forEach(x => { if (!esBy.has(x.event_id)) esBy.set(x.event_id, []); esBy.get(x.event_id).push(x); });
  m.esRows = id => (esBy.get(id) || []).slice().sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
  m.songsFor = id => m.esRows(id).map(x => m.song.get(x.song_id)).filter(Boolean);
  m.hasAtt = e => !!e.attendance_taken || m.absEv.has(e.id);
  m.live = songs.filter(s => s.active !== false && !s.learning);
  m.members = singers.filter(s => s.part && s.active !== false);
  m.learn = songs.filter(s => s.learning && s.active !== false)
    .sort((a, b) => (a.learn_order ?? 1e9) - (b.learn_order ?? 1e9) || ruCmp(a.title, b.title));
  /* the rules: before a singer's start date nothing counts (services count from
     "sings at services from"), not_listed is not counted, absent is a miss, no row is present */
  m.countsFrom = (s, kind) => { const j = s.joined_on || null, v = kind === 'rehearsal' ? null : (s.service_start || null); return j && v ? (v > j ? v : j) : (v || j); };
  m.status = (e, s) => {
    const f = m.countsFrom(s, e.kind);
    if (f && e.date < f) return 'na';
    const a = m.abs.get(e.id + '|' + s.id);
    return a ? (a === 'not_listed' ? 'na' : 'absent') : 'present';
  };
  m.attCount = (evs, s) => {
    let miss = 0, na = 0;
    evs.forEach(e => { if (e.cancelled) { na++; return; } const st = m.status(e, s); if (st === 'absent') miss++; else if (st === 'na') na++; });
    const of = evs.length - na;
    return { came: of - miss, of, pct: of ? Math.round((of - miss) / of * 100) : null };
  };
  m.attEvents = (from, to, type = 'all') => events.filter(m.hasAtt).filter(e => e.date >= from && e.date <= to)
    .filter(e => type === 'all' ? true : type === 'services' ? e.kind !== 'rehearsal' : e.kind === 'rehearsal');
  m.songStats = (id, from, to) => {
    const dates = eventSongs.filter(x => x.song_id === id).map(x => events.find(e => e.id === x.event_id))
      .filter(e => e && !e.cancelled && e.date <= TODAY && (!from || (e.date >= from && e.date <= to))).map(e => e.date).sort();
    return { n: dates.length, last: dates[dates.length - 1] || '' };
  };
  m.latestService = () => {
    const c = events.filter(e => e.kind !== 'rehearsal' && !e.cancelled && m.songsFor(e.id).length).slice().sort(byDateKind);
    if (!c.length) return null;
    const day = c.filter(e => e.date === TODAY);
    if (day.length) return new Date(NOW).getHours() < 12 ? day[0] : day[day.length - 1];
    return c.find(e => e.date > TODAY) || c[c.length - 1];
  };
  /* leaderboard: counted events of the period, ranked by percentage then events attended */
  m.board = (from, to) => {
    const all = events.filter(e => !e.cancelled && e.date <= TODAY && m.hasAtt(e)).slice().sort(byDateKind);
    const ev = all.filter(e => e.date >= from && e.date <= to);
    const rows = m.members.map(s => { let came = 0, of = 0; ev.forEach(e => { const st = m.status(e, s); if (st === 'na') return; of++; if (st === 'present') came++; }); return { s, came, of, pct: of ? came / of * 100 : null }; });
    const need = Math.max(3, Math.ceil(ev.length * .5));
    const ranked = rows.filter(r => r.of >= need).sort((a, b) => b.pct - a.pct || b.came - a.came);
    const groups = [];
    ranked.forEach(r => { const g = groups[groups.length - 1], a = g && g.list[0];
      if (a && Math.round(a.pct * 10) === Math.round(r.pct * 10) && a.came === r.came) g.list.push(r); else groups.push({ rank: groups.length + 1, list: [r] }); });
    return { ev, ranked, groups };
  };
  return m;
}

/* ---------- browser plumbing ---------- */
let browser;
const INSTRUMENT = () => {
  window.__printed = 0;
  window.print = () => { window.__printed++; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__media = this; return play.apply(this, arguments); };
  window.__copied = [];
  const clip = { writeText: x => { window.__copied.push(String(x)); return Promise.resolve(); }, readText: () => Promise.resolve('') };
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => clip }); } catch (_) {}
};
let opened = [];                 // pages opened by the check that is running
async function open(opts = {}) {
  const page = await openApp(browser, Object.assign({ port: PORT, choir: CHOIR }, opts, { wait: false }));
  opened.push(page);
  page.__dialogs = [];
  page.on('dialog', d => { page.__dialogs.push(d.type() + ': ' + d.message()); d.accept().catch(() => {}); });
  if (opts.wait !== false) await settle(page, 250);
  return page;
}
async function go(page, hash, ms = 250) {
  await page.evaluate(h => new Promise(res => {      // resolves after the app has handled the change (it may redirect)
    if (location.hash === h) return res();
    addEventListener('hashchange', () => requestAnimationFrame(() => res()), { once: true });
    setTimeout(res, 3000);
    location.hash = h;
  }), hash);
  await settle(page, ms);
}
/* wait for the route; on timeout say where the page is instead */
async function atHash(page, want, ms = 8000) {
  const test = typeof want === 'string' ? h => h === want : h => want.test(h);
  let h = '';
  const end = Date.now() + ms;
  while (Date.now() < end) { h = await page.evaluate(() => location.hash); if (test(h)) return h; await sleep(80); }
  fail(`expected the page at ${want}, it is at ${h}`);
}
const text = (page, sel = UI.main) => page.locator(sel).first().innerText();
const vis = (page, sel) => page.locator(sel).locator('visible=true').first();
async function tap(page, sel) { await vis(page, sel).click(); }
/* the message bar: its close button is data-dismiss */
async function toastText(page) {
  return page.evaluate(() => {
    const b = document.querySelector('[data-dismiss]');
    if (!b) return '';
    const own = el => [...el.querySelectorAll('button')].reduce((x, k) => x.replace(k.innerText, ''), el.innerText).trim();
    let el = b.parentElement;
    for (let i = 0; el && i < 4 && !own(el); i++) el = el.parentElement;
    return el ? own(el) : '';
  });
}
/* shown for real: on screen and not see-through (opacity 0 and pointer-events none hide things too) */
const shown = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) return false;
  if (getComputedStyle(el).pointerEvents === 'none') return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; }
  return true;
}, sel);
async function signIn(page, password = DIRECTOR.password) {
  if (!await page.locator('#em').count()) await go(page, '#/login');
  await page.fill('#em', DIRECTOR.email);
  await page.fill('#pw', password);
  await page.press('#pw', 'Enter');
}
async function director(hash, opts = {}) {
  const page = await open(Object.assign({ hash: '#/login' }, opts));
  await signIn(page);
  await atHash(page, /^#\/admin/, 10000);
  await settle(page, 200);
  if (hash) await go(page, hash);
  return page;
}

/* ---------- the runner ---------- */
const results = [];
async function check(id, what, fn) {
  if (ONLY && !ONLY.test(id)) return;
  const t0 = Date.now();
  opened = [];
  let err = null;
  try {
    await fn();
    const errs = opened.flatMap(p => p.__errors || []);
    if (errs.length) err = new Fail('console/page errors: ' + errs.slice(0, 3).join(' | ').slice(0, 300));
  } catch (e) { err = e; }
  for (const p of opened) await p.context().close().catch(() => {});
  opened = [];
  const why = err ? (err instanceof Fail ? err.message : 'error: ' + String(err && err.message || err).split('\n').slice(0, VERBOSE ? 6 : 1).join(' ').replace(/\x1b\[[0-9;]*m/g, '')) : '';
  console.log((err ? `FAIL ${id} ${what} — ${why}` : `PASS ${id} ${what}`) + (VERBOSE ? `  (${Date.now() - t0} ms)` : ''));
  results.push({ id, ok: !err });
}

/* ---------- fixtures ---------- */
/* At least one locked (admin-only) sheet must exist for A10: lock one exactly the
   way the app does (file under locked/, row pointing at it) if the data has none. */
async function ensureLockedSheet() {
  const have = await sql("select id from songs where pdf_locked and active and not learning");
  if (have.length) return;
  const cand = await sql(`select s.id, s.pdf_path from songs s join storage.objects o on o.bucket_id = 'sheets' and o.name = s.pdf_path
    where s.active and not s.learning and not s.pdf_locked order by s.title desc limit 1`);
  if (!cand.length) return;
  const { id, pdf_path } = cand[0], to = 'locked/' + pdf_path;
  const from = path.join(STORE, 'sheets', pdf_path), dest = path.join(STORE, 'sheets', to);
  if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(from, dest); }
  await sql(`update storage.objects set name = ${lit(to)} where bucket_id = 'sheets' and name = ${lit(pdf_path)};
    update songs set pdf_path = ${lit(to)}, pdf_locked = true where id = ${lit(id)}`);
}

/* =====================================================================
   Everyone (no sign-in)
   ===================================================================== */
async function guestChecks() {
  await check('A1', 'home: stat tiles, the next service with its song order, Learning, Leaderboard; no console errors', async () => {
    const page = await open({ hash: '#/home' });
    const tiles = Object.fromEntries(await page.$$eval(UI.kpi, (as, none) => as.map(a => [a.getAttribute('href'), (a.innerText.match(new RegExp('\\d+|' + none, 'g')) || []).map(x => x === none ? x : Number(x))]), UI.none));
    const cut30 = localISO(new Date(Date.parse(NOW) - 30 * 86400000));
    const month = M.events.filter(e => M.hasAtt(e) && e.date <= TODAY && !e.cancelled && e.date >= cut30);
    let came = 0, of = 0; M.members.forEach(s => { const c = M.attCount(month, s); came += c.came; of += c.of; });
    const svc12 = M.events.filter(e => e.kind !== 'rehearsal' && e.date <= TODAY && !e.cancelled && e.date >= shift(12) && M.songsFor(e.id).length);
    eq(tiles['#/seating'] && tiles['#/seating'][0], M.members.length, 'Singers tile');
    eq(tiles['#/sheets'] && tiles['#/sheets'].slice(0, 2), [M.live.length, M.live.filter(s => s.pdf_path).length], 'Repertoire tile (songs, with sheets)');
    eq(tiles['#/attendance/summary'] && tiles['#/attendance/summary'][0], of ? Math.round(came / of * 100) : UI.none, 'Attendance tile (last 30 days %)');
    eq(tiles['#/songs/services'] && tiles['#/songs/services'].slice(0, 2), [svc12.length, svc12.reduce((n, e) => n + M.songsFor(e.id).length, 0)], 'Services tile (services, songs sung)');
    const svc = M.latestService();
    if (svc) {
      const songs = M.songsFor(svc.id);
      const card = await page.evaluate(([id, s, n]) => {
        let el = document.querySelector(`[data-share-order="${id}"]`);
        while (el && el.querySelectorAll(`a[href="#/sheets/order-${s}"]`).length < n + 1) el = el.parentElement;
        return el ? el.innerText : null;
      }, [svc.id, short(svc.id), songs.length]);
      ok(card, `next service card (${svc.date} ${svc.kind}) with ${songs.length} song links not found`);
      inOrder(card, [svc.name || t(svc.kind), fmtLong(svc.date), ...songs.map(s => s.title)], 'next service card');
    } else ok((await text(page)).includes(t('noOrderYet')), 'no service: "' + t('noOrderYet') + '" expected');
    const lnLinks = await page.$$eval(UI.main + ' a[href="#/learning"]', as => as.map(a => a.innerText));
    if (M.learn.length) {
      const shown = M.learn.slice(0, 5).map(s => s.title);
      inOrder(lnLinks.join('\n'), shown, 'Learning card');
      ok((await text(page)).includes(t('songsCount', M.learn.length)), 'Learning count "' + t('songsCount', M.learn.length) + '" missing');
    }
    const B = M.board(shift(3), TODAY);
    const lb = await page.locator(UI.main + ' a[href="#/leaders"]').filter({ hasText: t('lbTitle') }).first().innerText().catch(() => '');
    if (B.groups.length) {
      ok(lb, 'leaderboard tile missing');
      inOrder(lb, [t('lbTitle'), t('rng3')], 'leaderboard tile');
      for (const r of B.groups[0].list.slice(0, 3)) ok(lb.includes(r.s.name.split(/\s+/)[0]), `leaderboard tile: #1 ${r.s.name} missing`);
    }
  });

  await check('A2', 'language EN ↔ RU re-labels the interface and is remembered; names and titles stay Russian', async () => {
    const page = await open({ hash: '#/attendance/summary' });
    const homeLabel = () => page.$eval('[data-tab="home"]', a => a.getAttribute('aria-label') || a.textContent.trim());
    eq(await homeLabel(), tr('en', 'home'), 'EN tab label');
    await tap(page, '[data-lang="ru"]');
    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    await settle(page, 150);
    eq(await homeLabel(), tr('ru', 'home'), 'RU tab label');
    const body = await text(page);
    ok(body.includes(tr('ru', 'tapName')) && !body.includes(tr('en', 'tapName')), 'summary hint not in Russian');
    const names = await page.$$eval('[data-mrow] [data-lbwho]', b => b.map(x => x.innerText.trim()).filter(Boolean));
    eq(names.slice(0, 5), M.members.filter(s => s.part === 'soprano').slice(0, 5).map(s => s.name), 'singer names in RU');
    eq(await page.evaluate(k => localStorage.getItem(k), K.lang), 'ru', 'stored language');
    await page.reload(); await settle(page, 200);
    eq(await page.evaluate(() => document.documentElement.lang), 'ru', 'language after reload');
    eq(await homeLabel(), tr('ru', 'home'), 'RU tab label after reload');
    await go(page, '#/home');
    const svc = M.latestService();
    if (svc) inOrder(await text(page), M.songsFor(svc.id).map(s => s.title), 'song titles in RU');
    await tap(page, '[data-lang="en"]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    eq(await homeLabel(), tr('en', 'home'), 'EN tab label again');
    eq(await page.evaluate(k => localStorage.getItem(k), K.lang), 'en', 'stored language');
  });

  await check('A3', 'light / dark switch works and is remembered', async () => {
    const page = await open({ hash: '#/home', theme: 'light' });
    const look = () => page.evaluate(() => { const h = getComputedStyle(document.documentElement), b = getComputedStyle(document.body);
      return { theme: document.documentElement.dataset.theme || '', paint: [h.backgroundColor, b.backgroundColor, b.color].join('|') }; });
    const a = await look();
    eq(a.theme, 'light', 'starting theme');
    await tap(page, '[data-theme-flip]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await sleep(400);
    const b = await look();
    ok(a.paint !== b.paint, 'colours did not change: ' + b.paint);
    eq(await page.evaluate(k => localStorage.getItem(k), K.theme), 'dark', 'stored theme');
    await page.reload(); await settle(page, 200);
    eq((await look()).theme, 'dark', 'theme after reload');
    await tap(page, '[data-theme-flip]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    eq(await page.evaluate(k => localStorage.getItem(k), K.theme), 'light', 'stored theme after flipping back');
  });

  /* the grid as text: one line per singer row, one symbol per event */
  async function readGrid(page) {
    return page.evaluate(C => {
      const days = [...document.querySelectorAll(C.gridDay)].map(d => d.innerText.replace(/\s+/g, ' ').trim());
      const rows = [...document.querySelectorAll(C.gridRow)].map(r => ({
        name: (r.querySelector(C.gridName) || {}).innerText || '',
        tally: ((r.querySelector(C.gridTally) || {}).innerText || '').trim(),
        cells: [...r.querySelectorAll(C.gridCell)].map(c => c.innerText.trim() || '·').join('') })).filter(r => r.name);
      return { days, rows };
    }, SEL);
  }
  const sym = (e, s) => e.cancelled ? UI.mark.cancelled : UI.mark[M.status(e, s)];
  function expectGrid(evs) {
    return PARTS.flatMap(p => M.members.filter(s => s.part === p)).map(s => {
      const c = M.attCount(evs, s);
      return { name: s.name, tally: c.of ? UI.count(c.came, c.of) : UI.none, cells: evs.map(e => sym(e, s)).join('') };
    });
  }
  const rangeOf = page => page.evaluate(() => ['from', 'to'].map(k => (document.querySelector(`input[type=date][data-edge="${k}"]`) || {}).value));

  await check('A4', 'attendance grid: every active singer by part, every event in range, absences marked, two-row sticky header', async () => {
    const page = await open({ hash: '#/attendance/grid' });
    const [from, to] = await rangeOf(page);
    eq([from, to], [shift(6), TODAY], 'default range');
    const evs = M.attEvents(from, to);
    const g = await readGrid(page);
    eq(g.days.length, evs.length, 'event columns');
    eq(g.days.map(d => +d.split(' ')[0]), evs.map(e => +e.date.slice(8)), 'column days');
    const want = expectGrid(evs);
    eq(g.rows.map(r => r.name), want.map(r => r.name), 'singer rows (by part)');
    for (let i = 0; i < want.length; i++) {
      if (g.rows[i].cells !== want[i].cells) fail(`${want[i].name}: marks ${g.rows[i].cells} ≠ stored ${want[i].cells}`);
      if (g.rows[i].tally !== want[i].tally) fail(`${want[i].name}: tally ${g.rows[i].tally} ≠ ${want[i].tally}`);
    }
    /* scrolled down, both header rows sit at the top of the grid box, one under the other, and stay there */
    const st = await page.evaluate(async C => {
      const sc = document.querySelector(C.gridScroll), heads = [...document.querySelectorAll(C.gridHead)];
      const top = () => heads.map(h => Math.round(h.getBoundingClientRect().top - sc.getBoundingClientRect().top));
      const row = document.querySelector(C.gridRow), r0 = row.getBoundingClientRect().top;
      const frame = () => new Promise(r => requestAnimationFrame(() => r()));
      sc.scrollTop = 400; await frame(); const a = top(), moved = Math.round(r0 - row.getBoundingClientRect().top);
      sc.scrollTop = 800; await frame(); const b = top();
      return { a, b, moved, h0: Math.round(heads[0].getBoundingClientRect().height), n: heads.length, max: sc.scrollHeight - sc.clientHeight };
    }, SEL);
    eq(st.n, 2, 'header rows');
    ok(st.max < 400 || st.moved > 300, 'grid body did not scroll (moved ' + st.moved + 'px)');
    if (st.max >= 800) {
      ok(Math.abs(st.a[0]) <= 2 && Math.abs(st.a[1] - st.a[0] - st.h0) <= 1, `header rows at the top of the scrolled grid: offsets ${st.a} (row height ${st.h0})`);
      eq(st.b, st.a, 'header rows stay put while scrolling further');
    }
  });

  await check('A5', 'date range presets (3/6/12/36 months, all) and a custom range change the grid and the summary', async () => {
    const page = await open({ hash: '#/attendance/grid' });
    await tap(page, '[data-toggle-range]');
    const first = M.events.reduce((m, e) => e.date < m ? e.date : m, TODAY);
    for (const p of ['3', '6', '12', '36', 'all']) {
      await tap(page, `[data-preset="${p}"][data-range="grid"]`);
      await settle(page, 80);
      const from = p === 'all' ? first : shift(+p);
      eq(await rangeOf(page), [from, TODAY], `range for preset ${p}`);
      const want = M.attEvents(from, TODAY).length;
      if (want > UI.gridCols) {
        // a long range opens on the latest dates; Show all draws every column
        eq((await readGrid(page)).days.length, UI.gridCols, `latest event columns for preset ${p}`);
        await tap(page, '[data-grid-more]');
        await settle(page, 80);
      }
      eq((await readGrid(page)).days.length, want, `event columns for preset ${p}`);
    }
    const att = M.events.filter(M.hasAtt);
    const cf = att[Math.floor(att.length * .4)].date, ct = att[Math.floor(att.length * .7)].date;
    await page.fill('input[type=date][data-range="grid"][data-edge="from"]', cf);
    await settle(page, 80);
    await page.fill('input[type=date][data-range="grid"][data-edge="to"]', ct);
    await settle(page, 120);
    eq(await rangeOf(page), [cf, ct], 'custom range');
    const evs = M.attEvents(cf, ct);
    const g = await readGrid(page);
    eq(g.days.length, evs.length, `event columns for ${cf}..${ct}`);
    eq(g.rows.map(r => r.cells), expectGrid(evs).map(r => r.cells), 'marks for the custom range');
    await go(page, '#/attendance/summary');
    const rows = await readSummary(page);
    const sample = M.members.slice(0, 6);
    for (const s of sample) { const c = M.attCount(evs, s); eq(rows[s.id] && rows[s.id].cnt, UI.count(c.came, c.of), `summary ${s.name} for the custom range`); }
  });

  async function readSummary(page) {
    return Object.fromEntries(await page.$$eval('[data-mrow]', (rs, re) => rs.map(r => {
      const tx = r.innerText; const cnt = (tx.match(new RegExp(re[0])) || [])[0] || ''; const pct = (tx.match(new RegExp(re[1])) || [])[1];
      return [r.dataset.mrow, { cnt, pct: pct == null ? null : +pct }]; }), [UI.countRe.source, UI.pctRe.source]));
  }
  await check('A6', 'attendance summary: every percentage matches the stored data (absent, not listed, before joining, cancelled)', async () => {
    const page = await open({ hash: '#/attendance/summary' });
    await tap(page, '[data-toggle-range]');
    for (const [preset, type] of [['6', 'all'], ['all', 'all'], ['all', 'services'], ['all', 'rehearsals']]) {
      if (preset !== '6') await tap(page, `[data-preset="${preset}"][data-range="sum"]`);
      await tap(page, `[data-type="${type}"][data-scope="sum"]`);
      await settle(page, 80);
      const [from, to] = await rangeOf(page);
      const evs = M.attEvents(from, to, type);
      const rows = await readSummary(page);
      eq(Object.keys(rows).sort(), M.members.map(s => s.id).sort(), `singers listed (${preset}/${type})`);
      for (const s of M.members) {
        const c = M.attCount(evs, s), r = rows[s.id];
        const want = { cnt: UI.count(c.came, c.of), pct: c.pct };
        if (r.cnt !== want.cnt || r.pct !== want.pct) fail(`${s.name} (${preset} mo/${type}): shows ${r.cnt} ${r.pct}% but the data gives ${want.cnt} ${want.pct}%`);
      }
    }
  });

  const songMatch = (s, q) => {
    const qs = q.trim().toLowerCase(); const cn = M.cat.get(s.category_id) || '';
    if ([s.title, s.subtitle, cn].some(v => v && v.toLowerCase().includes(qs))) return true;
    const ql = lat(qs);
    if (/[a-z]/.test(ql) && [s.title, s.subtitle, cn].some(v => v && lat(v).includes(ql))) return true;
    const d = qs.replace(/\D/g, ''); return !!d && s.pv_number != null && String(s.pv_number).includes(d);
  };
  await check('A7', 'songs summary: search, category filter and sort', async () => {
    const page = await open({ hash: '#/songs/summary' });
    const [from, to] = await rangeOf(page);
    eq([from, to], [shift(36), TODAY], 'default range');
    const rows = M.live.map(s => ({ s, st: M.songStats(s.id, from, to) })).filter(r => r.st.n > 0);
    const ids = () => page.$$eval('[data-song-dates]', r => r.map(x => x.dataset.songDates));
    const sorted = key => rows.slice().sort(key === 'old' ? (a, b) => a.st.last.localeCompare(b.st.last) || ruCmp(a.s.title, b.s.title)
      : key === 'new' ? (a, b) => b.st.last.localeCompare(a.st.last) || ruCmp(a.s.title, b.s.title)
      : (a, b) => b.st.n - a.st.n || ruCmp(a.s.title, b.s.title)).map(r => r.s.id);
    eq(await ids(), sorted('n'), 'rows, most sung first');
    const top = rows.find(r => r.s.id === sorted('n')[0]);
    ok((await page.locator(`[data-song-dates="${top.s.id}"]`).innerText()).includes(String(top.st.n)), 'times sung missing on the top row');
    /* search: a word that several titles share */
    const words = {}; rows.forEach(r => r.s.title.toLowerCase().split(/[^а-яё]+/).filter(w => w.length > 3).forEach(w => { words[w] = (words[w] || 0) + 1; }));
    const word = Object.entries(words).sort((a, b) => b[1] - a[1])[0][0];
    await page.fill('#q', word); await settle(page, 100);
    const hit = rows.filter(r => songMatch(r.s, word)).map(r => r.s.id).sort();
    eq((await ids()).sort(), hit, `search "${word}"`);
    ok(hit.length > 0 && hit.length < rows.length, `search "${word}" should narrow the list`);
    await page.fill('#q', ''); await settle(page, 100);
    eq((await ids()).length, rows.length, 'cleared search');
    /* category */
    if (M.categories.length) {
      const counts = M.categories.map(c => [c, rows.filter(r => r.s.category_id === c.id).length]).sort((a, b) => b[1] - a[1]);
      const cat = counts[0][0];
      await page.selectOption('[data-cat-filter]', cat.id); await settle(page, 100);
      eq((await ids()).sort(), rows.filter(r => r.s.category_id === cat.id).map(r => r.s.id).sort(), `category ${cat.name}`);
      await page.selectOption('[data-cat-filter]', 'all'); await settle(page, 100);
    }
    for (const k of ['new', 'old', 'n']) {
      await page.selectOption('[data-song-sort-pick]', k); await settle(page, 100);
      eq(await ids(), sorted(k), `sort "${k}"`);
    }
  });

  /* a service card: the smallest box around its "View & Listen" link that names its songs */
  const cards = page => page.evaluate(main => [...document.querySelectorAll(main + ' a[href^="#/sheets/order-"]')].map(a => {
    let el = a; while (el.parentElement && el.parentElement.querySelectorAll('a[href^="#/sheets/order-"]').length === 1) el = el.parentElement;
    return { id: a.getAttribute('href').split('order-')[1], text: el.innerText };
  }), UI.main);
  await check('A8', 'songs by service: the song order of each service in range', async () => {
    const page = await open({ hash: '#/songs/services' });
    const [from, to] = await rangeOf(page);
    eq([from, to], [shift(12), TODAY], 'default range');
    const evs = M.events.filter(e => e.kind !== 'rehearsal' && M.songsFor(e.id).length && e.date >= from && e.date <= to)
      .slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : kindRank(a.kind) - kindRank(b.kind));
    let n = Math.min(12, evs.length); while (n < evs.length && evs[n].date === evs[n - 1].date) n++;
    const c = await cards(page);
    eq(c.map(x => x.id), evs.slice(0, n).map(e => short(e.id)), 'services shown (newest first, first batch)');
    evs.slice(0, n).forEach((e, i) => inOrder(c[i].text, [e.name || t(e.kind), ...M.songsFor(e.id).map(s => s.title)], `${e.date} ${e.kind}`));
    if (evs.length > n) {
      await tap(page, '[data-hist-more]'); await settle(page, 100);
      let m = Math.min(24, evs.length); while (m < evs.length && evs[m].date === evs[m - 1].date) m++;   // batches of 12, never splitting a day
      eq((await cards(page)).map(x => x.id), evs.slice(0, m).map(e => short(e.id)), 'services after "Show more"');
    }
  });

  await check('A9', 'services page: upcoming and past services; a shared order link (8-character id) opens the right service', async () => {
    const page = await open({ hash: '#/services' });
    const svcOnly = e => e.kind !== 'rehearsal' && !e.cancelled && M.songsFor(e.id).length;
    const up = M.events.filter(e => e.date >= TODAY && svcOnly(e)).slice().sort(byDateKind);
    const past = M.events.filter(e => e.date < TODAY && svcOnly(e)).slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : kindRank(a.kind) - kindRank(b.kind));
    const c = await cards(page);
    eq(c.map(x => x.id), up.map(e => short(e.id)), 'upcoming services');
    up.forEach((e, i) => inOrder(c[i].text, M.songsFor(e.id).map(s => s.title), `upcoming ${e.date}`));
    await go(page, '#/services/past');
    eq((await cards(page)).map(x => x.id), past.slice(0, 12).map(e => short(e.id)), 'past services (first 12)');
    if (past.length > 12) { await tap(page, '[data-tl-more]'); await settle(page, 100); eq((await cards(page)).map(x => x.id), past.slice(0, 24).map(e => short(e.id)), 'past services after "Show older"'); }
    const ev = up[0] || past[0];
    ok(ev, 'no service with songs');
    await go(page, '#/home');
    await tap(page, `[data-share-order="${ev.id}"]`);
    const msg = await until(() => page.evaluate(() => window.__copied[window.__copied.length - 1]), 'the shared message');
    const link = (msg.match(/https?:\/\/\S+#\/o\/([^\s/]+)/) || [])[1];
    eq(link, short(ev.id), 'shared link token');
    inOrder(msg, M.songsFor(ev.id).map(s => s.title), 'shared message');
    const p2 = await open({ hash: '#/o/' + link });
    const ids = await p2.$$eval('[data-srow]', r => r.map(x => x.dataset.srow));
    eq(ids, M.songsFor(ev.id).map(s => s.id), 'songs on the shared order page');
    ok((await text(p2)).includes(fmtLong(ev.date)), 'shared order page does not show the date ' + fmtLong(ev.date));
  });

  await check('A10', 'choir sheets and piano scores: list, open a sheet (signed link); locked sheets are not offered to guests', async () => {
    const page = await open({ hash: '#/sheets' });
    const rows = await page.$$eval('[data-srow]', r => r.map(x => ({ id: x.dataset.srow, open: !!x.querySelector('[data-open]') })));
    eq(rows.map(r => r.id).sort(), M.live.map(s => s.id).sort(), 'songs listed');
    for (const s of M.live) {
      const r = rows.find(x => x.id === s.id);
      if (r.open !== !!(s.pdf_path && !s.pdf_locked)) fail(`${s.title}: ${r.open ? 'offers' : 'does not offer'} a sheet (pdf ${s.pdf_path ? 'yes' : 'no'}, locked ${s.pdf_locked})`);
    }
    const locked = M.live.filter(s => s.pdf_path && s.pdf_locked);
    ok(locked.length, 'no locked sheet to check');
    ok((await page.locator(`[data-srow="${locked[0].id}"]`).innerText()).includes(t('adminOnly')), 'locked sheet not labelled "' + t('adminOnly') + '"');
    const files = new Set((await sql("select bucket_id || ':' || name k from storage.objects")).map(r => r.k));
    for (const [kind, col] of [['sheets', 'pdf_path'], ['piano', 'piano_path']]) {
      if (kind === 'piano') await go(page, '#/sheets/piano');
      const s = M.live.find(x => x[col] && !x[kind === 'piano' ? 'piano_locked' : 'pdf_locked'] && files.has(kind + ':' + x[col]));
      if (!s) { if (kind === 'sheets') fail('no song with a stored sheet'); continue; }
      const got = [];
      const onReq = r => { if (r.url().includes('/storage/v1/object/sign/' + kind + '/') && r.method() === 'GET') got.push(r.url()); };
      page.context().on('request', onReq);
      const before = +(await sql(`select count(*) n from usage_log where kind = 'sheet' and ref = ${lit(s.id)}`))[0].n;
      await tap(page, `[data-srow="${s.id}"] [data-tray]`);
      const [popup] = await Promise.all([page.waitForEvent('popup'), tap(page, `[data-open="${kind}:${s.id}"]`)]);
      const url = await until(() => got[0], 'the signed link to load in the new window');
      page.context().off('request', onReq);
      const res = await fetch(url);
      eq(res.status, 200, `signed ${kind} link`);
      ok((await res.text()).startsWith('%PDF'), `signed ${kind} link is not the PDF`);
      ok(/[?&]token=/.test(url), 'link is not signed');
      await popup.close().catch(() => {});
      if (kind === 'sheets') await until(async () => +(await sql(`select count(*) n from usage_log where kind = 'sheet' and ref = ${lit(s.id)}`))[0].n > before, 'the sheet open to be counted');
    }
  });

  await check('A11', 'learning page: the songs being learned, in the director\'s order', async () => {
    const page = await open({ hash: '#/learning' });
    const got = await page.$$eval(UI.cardTitle, (h, re) => h.map(x => x.innerText.replace(new RegExp(re), '').trim()), UI.pvTag.source);
    eq(got, M.learn.map(s => s.title), 'learning songs in order');
    if (M.learn.length) ok((await text(page)).includes(t('songsCount', M.learn.length)), 'count missing');
    const noted = M.learn.find(s => s.learn_note);
    if (noted) ok((await text(page)).includes(noted.learn_note), 'director\'s note missing');
  });

  await check('A12', 'lyrics: a song\'s lyrics display; print view opens; special characters stay text', async () => {
    const withL = M.live.filter(s => Array.isArray(s.lyrics) && s.lyrics.length).sort((a, b) => b.lyrics.length - a.lyrics.length);
    ok(withL.length, 'no song with lyrics');
    const s = withL[0];
    const page = await open({ hash: '#/lyrics' });
    const listed = await page.$$eval(UI.main + ' a[href^="#/lyrics/"]', a => a.map(x => x.getAttribute('href').split('/')[2]));
    eq(listed.slice().sort(), M.live.map(x => short(x.id)).sort(), 'lyrics index');
    ok((await text(page)).includes(t('lyrWith', withL.length + '/' + M.live.length)), 'lyrics count missing');
    await vis(page, `${UI.main} a[href="#/lyrics/${short(s.id)}"]`).click();
    await page.waitForFunction(h => location.hash === h, '#/lyrics/' + short(s.id)); await settle(page, 150);
    const body = await text(page);
    inOrder(body, [s.title, ...s.lyrics.flatMap(b => String(b.x).split('\n').map(l => l.trim()).filter(Boolean))], 'lyrics page');
    if (s.lyrics.some(b => b.t === 'c')) ok(body.includes(t('bkChorus')), 'chorus label missing');
    await tap(page, `[data-lyr-print="${s.id}"]`);
    await until(() => page.evaluate(() => window.__printed > 0), 'the print dialog');
    const sheet = await page.evaluate(() => { const p = document.getElementById('lyrprint'); return p && p.textContent; });
    ok(sheet && sheet.includes(s.title), 'print sheet has no title');
    inOrder(sheet, s.lyrics.map(b => String(b.x).split('\n')[0].trim()), 'print sheet');
    const odd = M.songs.find(x => /[<>&«]/.test(x.title));
    if (odd) {
      await go(page, '#/lyrics/' + short(odd.id));
      const h = await page.evaluate(sel => { const h1 = document.querySelector(sel); return h1 && { t: h1.textContent, kids: h1.children.length }; }, UI.pageTitle);
      ok(h && h.t.includes(odd.title), `title "${odd.title}" shown as ${show(h && h.t)}`);
      eq(h.kids, 0, 'markup created from a title');
    }
  });

  await check('A13', 'leaderboard and member report card (#/member/<id>)', async () => {
    const page = await open({ hash: '#/leaders' });
    const B = M.board(shift(3), TODAY);
    ok(B.ranked.length, 'nobody ranked in the data');
    ok((await text(page)).includes(t('lbRanked', B.ranked.length)), `"${t('lbRanked', B.ranked.length)}" missing`);
    const flat = B.groups.flatMap((g, gi) => g.list.map(r => ({ id: r.s.id, place: g.rank, top: gi < 3 })));
    const nTop = flat.filter(x => x.top).length, shown = flat.length > nTop + 6 ? flat.slice(0, nTop + 6) : flat;
    const got = await page.$$eval(UI.standing, (li, C) => li.map(l => ({ id: (l.querySelector('[data-lbwho]') || {}).dataset?.lbwho, place: +((l.querySelector(C.place) || {}).innerText || 0) })), SEL);
    eq(got.map(x => x.place), shown.map(x => x.place), 'places in the standings');
    shown.forEach((x, i) => { if (got[i].place === x.place && !shown.some(y => y.place === x.place && y.id === got[i].id)) fail(`place ${x.place}: ${M.singer.get(got[i].id)?.name} should not be there`); });
    /* a name opens their badges, and from there the report card */
    const who = B.groups[0].list[0].s;
    await tap(page, `[data-lbwho="${who.id}"]`);
    await page.locator('[data-lbme]').waitFor();                  // their badge sheet is open
    await tap(page, `a[href="#/member/${short(who.id)}"]`);
    await page.waitForFunction(h => location.hash.startsWith(h), '#/member/' + short(who.id)); await settle(page, 200);
    /* the report card of the singer with the most misses this year */
    const from = shift(12);
    const evs = M.events.filter(e => M.hasAtt(e) && !e.cancelled && e.date >= from && e.date <= TODAY);
    const card = s => { const c = evs.filter(e => M.status(e, s) !== 'na'); const came = c.filter(e => M.status(e, s) === 'present').length; return { came, of: c.length, miss: c.length - came }; };
    const s = M.members.slice().sort((a, b) => card(b).miss - card(a).miss)[0], c = card(s);
    await go(page, '#/member/' + short(s.id), 400);
    const tx = await text(page);
    inOrder(tx, [s.name, `${Math.round(c.came / c.of * 100)}%`, t('mOf', c.came, c.of)], 'report card (12 months)');
    ok(tx.includes(t('mEvents', c.of)), 'counted events missing');
    await tap(page, '[data-toggle-range="member"]');
    await tap(page, '[data-mpreset="3"]'); await settle(page, 200);
    ok(page.url().includes('?p=3'), 'period not in the address');
    const e3 = M.events.filter(e => M.hasAtt(e) && !e.cancelled && e.date >= shift(3) && e.date <= TODAY).filter(e => M.status(e, s) !== 'na');
    const came3 = e3.filter(e => M.status(e, s) === 'present').length;
    ok((await text(page)).includes(t('mOf', came3, e3.length)), `3-month figures "${t('mOf', came3, e3.length)}" missing`);
  });

  await check('A14', 'seating chart renders every seated singer in their block', async () => {
    const page = await open({ hash: '#/seating' });
    const roster = M.singers.filter(s => PARTS.includes(s.part) && s.active !== false);
    const seated = roster.filter(s => s.seat_block && s.seat_row && s.seat_col);
    const seats = Object.fromEntries(await page.$$eval('[data-seat]', b => b.map(x => [x.dataset.seat, x.getAttribute('aria-label') || x.getAttribute('title') || ''])));
    for (const s of seated) eq(seats[`${s.seat_block}:${s.seat_row}:${s.seat_col}`], s.name, `chair ${s.seat_block} row ${s.seat_row} seat ${s.seat_col}`);
    eq(Object.values(seats).filter(Boolean).length, seated.length, 'occupied chairs');
    ok((await text(page)).includes(UI.count(seated.length, roster.length)), `"${UI.count(seated.length, roster.length)}" seated count missing`);
  });

  await check('A15', 'choir rules render from the stored document', async () => {
    ok(M.rules, 'no rules document');
    const page = await open({ hash: '#/rules' });
    const lines = src => src.split('\n').map(l => l.replace(/^\s*(#+|[-*•]|\d+\.|>)\s*/, '').replace(/==|\*\*/g, '').trim()).filter(Boolean);
    const h3 = (M.rules.body_en.match(/^#+\s/gm) || []).length;
    const got = await page.evaluate(C => { const a = document.querySelector(C.doc) || document.querySelector(C.main); return { tx: a.innerText, h: a.querySelectorAll(C.docHead).length, li: a.querySelectorAll(C.docItem).length }; }, SEL);
    inOrder(got.tx, lines(M.rules.body_en), 'rules (EN)');
    eq(got.h, h3, 'headings'); eq(got.li, (M.rules.body_en.match(/^\s*[-*•]\s/gm) || []).length, 'list items');
    ok((await text(page)).includes(t('rulesUpdated', fmtLong(M.rules.updated_at.slice(0, 10)))), 'updated date missing');
    await tap(page, '[data-lang="ru"]'); await settle(page, 150);
    inOrder(await text(page), lines(M.rules.body_ru), 'rules (RU)');
  });

  await check('A16', 'part player: plays a recording, pause, back / forward 10 s', async () => {
    const s = M.live.find(x => Object.values(x.part_audio || {}).some(r => r && r.path));
    ok(s, 'no song with a part recording');
    const part = ['soprano', 'alto', 'tenor', 'bass', 'full'].find(p => s.part_audio[p] && s.part_audio[p].path);
    const page = await open({ hash: '#/sheets' });
    const before = +(await sql(`select count(*) n from usage_log where kind = 'audio' and ref = ${lit(s.id)}`))[0].n;
    await tap(page, `[data-srow="${s.id}"] [data-tray]`);
    await tap(page, `[data-listen="sheets:${s.id}"]`);
    await tap(page, `[data-lp="${s.id}:${part}"]`);
    const media = () => page.evaluate(() => { const a = window.__media; return a ? { paused: a.paused, t: a.currentTime, d: a.duration, err: a.error && a.error.code, src: a.currentSrc } : null; });
    const m0 = await until(async () => { const m = await media(); return m && !m.paused && m.t > .3 && m; }, 'the recording to play');
    ok(m0.src.includes('/storage/v1/object/public/parts/'), 'not playing the stored file: ' + m0.src);
    /* the player bar: the smallest box holding both its play/pause and its close control */
    await page.locator('[data-pl="toggle"]').waitFor();
    const barText = () => page.evaluate(() => { let el = document.querySelector('[data-pl="toggle"]'); while (el && !el.querySelector('[data-pl="close"]')) el = el.parentElement; return el ? el.innerText : ''; });
    ok((await barText()).includes(s.title), 'player does not name the song');
    eq(await page.getAttribute('[data-pl="toggle"]', 'aria-label'), t('plPause'), 'play/pause button while playing');
    eq(await page.getAttribute(`[data-lp="${s.id}:${part}"]`, 'aria-pressed'), 'true', 'part button pressed');
    let a = (await media()).t; await page.click('[data-pl="fwd"]'); let b = (await media()).t;
    ok(b - a > 9 && b - a < 11.5, `forward 10 s moved ${(b - a).toFixed(1)} s`);
    a = b; await page.click('[data-pl="back"]'); b = (await media()).t;
    ok(a - b > 8.5 && a - b < 10.5, `back 10 s moved ${(a - b).toFixed(1)} s`);
    await page.click('[data-pl="toggle"]');
    await until(async () => (await media()).paused, 'pause');
    await until(async () => await page.getAttribute('[data-pl="toggle"]', 'aria-label') === t('plPlay'), 'the button to read "' + t('plPlay') + '" once paused', 3000);
    eq(await page.getAttribute(`[data-lp="${s.id}:${part}"]`, 'aria-pressed'), 'false', 'part button released');
    const p1 = (await media()).t; await sleep(600);
    ok(Math.abs((await media()).t - p1) < .05, 'still playing after pause');
    await page.click('[data-pl="close"]');
    await until(async () => !await shown(page, '[data-pl="toggle"]'), 'the player to close', 3000);
    eq(await page.evaluate(() => window.__media.getAttribute('src')), null, 'recording still loaded after close');
    await until(async () => +(await sql(`select count(*) n from usage_log where kind = 'audio' and ref = ${lit(s.id)}`))[0].n > before, 'the listen to be counted');
  });

  await check('A17', 'search finds a song and a singer', async () => {
    const page = await open({ hash: '#/home' });
    const find = async q => {     // on a phone the search field opens out of its button
      if (!await shown(page, '#msearch') && await page.locator('[data-msearch-open]').count()) {
        await tap(page, '[data-msearch-open]');
        await until(() => shown(page, '#msearch'), 'the search field to open', 3000);
      }
      await page.fill('#msearch', q);
      await until(() => page.locator('[data-ts]').count(), `suggestions for "${q}"`);
      return page.$$eval('[data-ts]', a => a.map(x => ({ k: x.dataset.ts, tx: x.innerText })));
    };
    const s = M.live.find(x => x.title.split(' ').length >= 2 && x.title.length > 8) || M.live[0];
    let list = await find(s.title.slice(0, 7));
    ok(list.some(x => x.k === 's:' + s.id), `song "${s.title}" not suggested for "${s.title.slice(0, 7)}"`);
    await page.locator(`[data-ts="s:${s.id}"]`).click();
    await atHash(page, '#/sheets');
    const row = page.locator(`[data-srow="${s.id}"]`);
    await row.waitFor();
    await until(async () => { const b = await row.boundingBox(); return b && b.y >= 0 && b.y < 844; }, 'the song row to scroll into view');
    const m = M.members.find(x => x.name.split(' ')[0].length >= 5) || M.members[0];
    const sur = m.name.split(' ')[0];
    list = await find(sur.slice(0, 5));
    ok(list.some(x => x.k === 'm:' + m.id), `singer ${m.name} not suggested for "${sur.slice(0, 5)}"`);
    const la = lat(sur);
    list = await find(la);
    ok(list.some(x => x.k === 'm:' + m.id), `singer ${m.name} not found typed in English letters ("${la}")`);
    await page.locator(`[data-ts="m:${m.id}"]`).click();
    await page.waitForFunction(h => location.hash.startsWith(h), '#/member/' + short(m.id));
    const odd = M.live.find(x => /[<>&]/.test(x.title));
    if (odd) {
      list = await find('<Тест>');
      ok(list.some(x => x.k === 's:' + odd.id && x.tx.includes(odd.title)), `"${odd.title}" not suggested as plain text`);
    }
  });

  await check('A18', '"That\'s me": picking yourself is remembered', async () => {
    const page = await open({ hash: '#/leaders' });
    const s = M.board(shift(3), TODAY).groups[0].list[0].s;     // on the podium, so on screen
    const pick = async () => { await tap(page, `[data-lbwho="${s.id}"]`); const d = page.locator('[data-lbme]'); await d.waitFor(); return d; };
    let d = await pick();
    eq(await d.getAttribute('aria-pressed'), 'false', '"That\'s me" before');
    await d.click(); await settle(page, 100);
    eq(await page.evaluate(k => localStorage.getItem(k), K.me), s.id, 'stored "me"');
    await page.reload(); await settle(page, 300);
    d = await pick();
    eq(await d.getAttribute('aria-pressed'), 'true', '"That\'s me" after reload');
    await d.click(); await settle(page, 100);
    eq(await page.evaluate(k => localStorage.getItem(k), K.me), null, '"me" cleared on second tap');
  });

  await check('A19', 'anonymous usage counting records page views, never for the signed-in director', async () => {
    const page = await open({ hash: '#/home' });
    for (const h of ['#/sheets', '#/leaders', '#/sheets/piano', '#/sheets', '#/home']) await go(page, h, 120);
    const vid = await page.evaluate(() => localStorage.getItem('bsebc-vid'));
    ok(vid, 'no visitor id stored');
    const rows = await until(async () => { const r = await sql(`select kind, ref, lang, device from usage_log where vid = ${lit(vid)} order by id`); return r.length >= 4 && r; }, 'page views to be logged');
    eq(rows.map(r => r.kind + ':' + r.ref), ['page:home', 'page:sheets', 'page:leaders', 'page:piano'], 'logged page views (once per page per visit)');
    ok(rows.every(r => r.lang === 'en' && r.device), 'language or device missing');
    const count = async () => +(await sql('select count(*) n from usage_log'))[0].n;
    const p = await director();
    const n0 = await count();
    for (const h of ['#/home', '#/sheets', '#/leaders', '#/learning', '#/attendance/summary']) await go(p, h, 120);
    await p.reload(); await settle(p, 300);
    const withPdf = M.live.find(x => x.pdf_path && !x.pdf_locked);
    if (withPdf) { await go(p, '#/sheets'); await tap(p, `[data-srow="${withPdf.id}"] [data-tray]`); const [w] = await Promise.all([p.waitForEvent('popup'), tap(p, `[data-open="sheets:${withPdf.id}"]`)]); await sleep(500); await w.close().catch(() => {}); }
    await sleep(500);
    eq(await count(), n0, 'usage rows written while the director was signed in');
  });

  await check('A20', 'every main screen fits a 390 px phone with no sideways page scroll (EN and RU)', async () => {
    const svc = M.latestService(), m = M.members[0], ly = M.live.find(s => Array.isArray(s.lyrics) && s.lyrics.length) || M.live[0];
    const routes = ['#/home', '#/attendance/grid', '#/attendance/summary', '#/songs/summary', '#/songs/services', '#/songs/people', '#/services', '#/services/past',
      '#/sheets', '#/sheets/piano', '#/learning', '#/lyrics', '#/lyrics/' + short(ly.id), '#/leaders', '#/member/' + short(m.id), '#/seating', '#/rules', '#/login']
      .concat(svc ? ['#/sheets/order-' + short(svc.id)] : []);
    const bad = [];
    for (const lang of ['en', 'ru']) {
      const page = await open({ hash: '#/home', lang });
      for (const r of routes) {
        await go(page, r, 150);
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        if (w[0] > w[1]) bad.push(`${lang} ${r} ${w[0]}>${w[1]}`);
      }
    }
    ok(!bad.length, 'sideways scroll on ' + bad.join(', '));
  });
}

/* =====================================================================
   Director (signed in)
   ===================================================================== */
const one = async q => (await sql(q))[0];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 420]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
function anyFile(dir, ext) {            // a real file of this stack to upload again (a recording, a photo)
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  const f = walk(dir).find(x => x.endsWith(ext));
  return f ? fs.readFileSync(f) : null;
}
const nextDay = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };
const evLabel = e => e.kind === 'other' ? e.label : KIND_LABEL.en[e.kind];
async function saved(page, what) {      // the green confirmation, never "Not saved"
  const msg = await until(async () => { const x = await toastText(page); return x && x; }, `a message after ${what}`);
  ok(!msg.startsWith(t('notSaved')), `${what}: "${msg}"`);
  return msg;
}
async function adminStrip(page, songId) {   // phones: open the song's tray, then its director tools
  await tap(page, `[data-srow="${songId}"] [data-tray]`);
  await tap(page, `${UI.admTools}[data-adm-row="${songId}"]`);
}

async function directorChecks() {
  await check('D1', 'sign in with email and password; a wrong password shows an error; sign out', async () => {
    const page = await open({ hash: '#/login' });
    const token = () => page.evaluate(() => Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)));
    const blank = await text(page);
    await signIn(page, 'not-the-password');
    await until(async () => (await text(page)) !== blank, 'an error message after a wrong password');
    eq(await page.evaluate(() => location.hash), '#/login', 'still on the sign-in page');
    eq(await token(), false, 'session stored after a wrong password');
    await signIn(page);
    await atHash(page, '#/admin/attendance', 10000);
    eq(await token(), true, 'session stored');
    await page.reload(); await settle(page, 300);
    eq(await page.evaluate(() => location.hash), '#/admin/attendance', 'signed in after reload');
    ok(await page.locator('[data-signout]').count(), 'no sign-out control');
    await tap(page, '[data-menu]');
    await tap(page, '[data-signout]');
    await atHash(page, '#/home');
    await until(async () => !await token(), 'the session to be removed');
    ok(await page.locator('a[href="#/login"]').count(), 'no sign-in link after signing out');
    await go(page, '#/admin/members');
    await atHash(page, '#/login', 5000);
  });

  await check('D2', 'mark attendance for an event: absent / not listed / present, saved to the database', async () => {
    M = await loadModel();
    const E = M.events.filter(e => e.attendance_taken && !e.cancelled && e.date <= TODAY).reverse()
      .find(e => M.members.some(s => M.status(e, s) === 'absent' && M.abs.get(e.id + '|' + s.id) === 'absent') && M.members.some(s => M.status(e, s) === 'present'));
    ok(E, 'no event with both present and absent singers');
    const P = M.members.find(s => M.status(E, s) === 'present'), A = M.members.find(s => M.abs.get(E.id + '|' + s.id) === 'absent' && M.status(E, s) === 'absent');
    const NA = M.members.find(s => M.status(E, s) === 'na');
    const page = await director('#/admin/attendance/' + E.id);
    const pill = id => page.locator(`[data-toggle-absent="${id}"]`).innerText();
    ok((await pill(P.id)).includes(t('wasPresent')), `${P.name} not shown present`);
    ok((await pill(A.id)).includes(t('wasAbsent')), `${A.name} not shown absent`);
    if (NA) ok((await pill(NA.id)).includes(t('wasNA')), `${NA.name} not shown "${t('wasNA')}"`);
    await tap(page, `[data-toggle-absent="${P.id}"]`);
    await tap(page, `[data-toggle-absent="${A.id}"]`);
    ok((await pill(P.id)).includes(t('wasAbsent')) && (await pill(A.id)).includes(t('wasPresent')), 'taps did not change the marks');
    const naRow = NA ? await one(`select status from absences where event_id = ${lit(E.id)} and singer_id = ${lit(NA.id)}`) : null;
    await tap(page, '[data-save-marks]');
    await saved(page, 'saving attendance');
    await until(async () => (await one(`select status from absences where event_id = ${lit(E.id)} and singer_id = ${lit(P.id)}`) || {}).status === 'absent', `${P.name} saved as absent`);
    eq(await one(`select status from absences where event_id = ${lit(E.id)} and singer_id = ${lit(A.id)}`), undefined, `${A.name} row (present = no row)`);
    if (NA) eq(await one(`select status from absences where event_id = ${lit(E.id)} and singer_id = ${lit(NA.id)}`), naRow, `${NA.name} (not listed) unchanged`);
  });

  let newEvent = null;
  await check('D3', 'add a new event (date and type), then mark it', async () => {
    M = await loadModel();
    const joined = M.members.map(s => s.joined_on).filter(Boolean).sort();
    let D = nextDay(joined[joined.length - 1] > TODAY ? TODAY : joined[joined.length - 1], -1);
    while (M.events.some(e => e.date === D && e.kind === 'rehearsal')) D = nextDay(D, -1);
    const page = await director('#/admin/attendance');
    await page.fill('#draft-date', D);
    await tap(page, '[data-kind="rehearsal"]');
    await tap(page, '[data-go="att"]');
    await atHash(page, '#/admin/attendance/new');
    await settle(page, 150);
    const ev = { date: D, kind: 'rehearsal' };
    const counted = M.members.filter(s => M.status(ev, s) !== 'na'), notYet = M.members.filter(s => M.status(ev, s) === 'na');
    ok(notYet.length, 'no singer who joined after ' + D);
    for (const s of counted.slice(0, 3)) ok((await page.locator(`[data-toggle-absent="${s.id}"]`).innerText()).includes(t('wasAbsent')), `${s.name} does not start absent`);
    ok((await page.locator(`[data-toggle-absent="${notYet[0].id}"]`).innerText()).includes(t('wasNA')), `${notYet[0].name} (joined ${notYet[0].joined_on}) not "${t('wasNA')}"`);
    const came = counted.slice(0, 2);
    for (const s of came) await tap(page, `[data-toggle-absent="${s.id}"]`);
    await tap(page, '[data-save-marks]');
    await saved(page, 'saving the new event');
    const row = await until(() => one(`select * from events where date = ${lit(D)} and kind = 'rehearsal'`), 'the new event row');
    newEvent = row;
    eq([row.label, row.name, row.cancelled, row.attendance_taken], [KIND_LABEL.en.rehearsal, null, false, true], 'event row (label, name, cancelled, attendance taken)');
    const abs = Object.fromEntries((await sql(`select singer_id, status from absences where event_id = ${lit(row.id)}`)).map(a => [a.singer_id, a.status]));
    for (const s of M.members) {
      const want = came.includes(s) ? undefined : notYet.includes(s) ? 'not_listed' : 'absent';
      if (abs[s.id] !== want) fail(`${s.name}: stored ${abs[s.id] || 'no row'}, expected ${want || 'no row'}`);
    }
  });

  await check('D4', 'cancel and restore an event; delete an event', async () => {
    let ev = newEvent;
    if (!ev) { ev = await one(`insert into events (date, kind, label, attendance_taken) values ('2026-06-03', 'rehearsal', 'R', true) on conflict do nothing returning *`); ok(ev, 'could not make an event to cancel'); }
    const page = await director('#/admin/attendance/' + ev.id);
    await tap(page, '[data-toggle-cancel]');
    ok((await text(page)).includes(t('cancelledNote')), 'no cancelled note');
    await tap(page, '[data-save-marks]'); await saved(page, 'cancelling');
    await until(async () => (await one(`select cancelled from events where id = ${lit(ev.id)}`)).cancelled === true, 'cancelled = true');
    await go(page, '#/admin/attendance/' + ev.id);
    ok((await text(page)).includes(t('unmarkCancelled')), `"${t('unmarkCancelled')}" not offered`);
    await tap(page, '[data-toggle-cancel]');
    await tap(page, '[data-save-marks]'); await saved(page, 'restoring');
    await until(async () => (await one(`select cancelled from events where id = ${lit(ev.id)}`)).cancelled === false, 'cancelled = false');
    await go(page, '#/admin/entries/att');
    await tap(page, `[data-ent-year="${ev.date.slice(0, 4)}"]`);
    if (ev.kind === 'rehearsal') await tap(page, '[data-ent-type="rehearsals"]');
    for (let i = 0; i < 20 && !await page.locator(`[data-del-event="${ev.id}"]`).count(); i++) {
      const next = page.locator('[data-ent-page]:not([disabled])').last();
      if (!await next.count()) break;
      await next.click(); await settle(page, 80);
    }
    await tap(page, `[data-del-event="${ev.id}"]`);
    await until(async () => !await one(`select id from events where id = ${lit(ev.id)}`), 'the event row to be deleted');
    eq(+(await one(`select count(*) n from absences where event_id = ${lit(ev.id)}`)).n, 0, 'marks left behind');
    ok(page.__dialogs.some(d => d.startsWith('confirm')), 'deleting did not ask first');
  });

  await check('D5', 'song order for a service: add songs, reorder, conductor and pianist, saved', async () => {
    M = await loadModel();
    let F = nextDay(TODAY, 1); while (new Date(F + 'T12:00:00').getDay() !== 0 || M.events.some(e => e.date === F && e.kind === 'evening')) F = nextDay(F, 1);
    const [s1, s2, s3] = M.live.slice().sort((a, b) => ruCmp(a.title, b.title)).slice(3, 6);
    const C = M.singers.find(x => x.is_conductor), P = M.singers.find(x => x.is_pianist);
    ok(C && P, 'no conductor or pianist in the data');
    const page = await director('#/admin/songs');
    await page.fill('#draft-date', F);
    await tap(page, '[data-kind="evening"]');
    await tap(page, '[data-go="songs"]');
    await atHash(page, '#/admin/songs/new'); await settle(page, 150);
    for (const s of [s1, s2, s3]) await tap(page, `[data-toggle-song="${s.id}"]`);
    await tap(page, `[data-move="up:${s3.id}"]`);
    await page.selectOption(`[data-credit="c:${s1.id}"]`, C.id);
    await page.selectOption(`[data-credit="p:${s3.id}"]`, P.id);
    await tap(page, '[data-save-marks]'); await saved(page, 'saving the song order');
    const ev = await until(() => one(`select * from events where date = ${lit(F)} and kind = 'evening' and name is null`), 'the new service row');
    eq(ev.label, KIND_LABEL.en.evening, 'service label');
    const rows = async () => (await sql(`select song_id, position, conductor_id, pianist_id from event_songs where event_id = ${lit(ev.id)} order by position`)).map(r => [r.song_id, r.position, r.conductor_id, r.pianist_id]);
    await until(async () => (await rows()).length === 3, 'three song rows');
    eq(await rows(), [[s1.id, 1, C.id, null], [s3.id, 2, null, P.id], [s2.id, 3, null, null]], 'song order with conductor and pianist');
    await go(page, '#/admin/songs/' + ev.id);
    await tap(page, `[data-move="up:${s2.id}"]`);
    await tap(page, '[data-save-marks]'); await saved(page, 'reordering');
    await until(async () => JSON.stringify((await rows()).map(r => r[0])) === JSON.stringify([s1.id, s2.id, s3.id]), 'the new order to be saved');
    eq((await rows()).map(r => [r[2], r[3]]), [[C.id, null], [null, null], [null, P.id]], 'credits kept through the reorder');
  });

  await check('D6', 'songs: add, edit title / subtitle / category / number, archive and restore, delete', async () => {
    M = await loadModel();
    const [c1, c2] = M.categories;
    const title = 'Тестовая песнь Э2Э', title2 = 'Тестовая песнь Э2Э (новая)';
    const page = await director('#/admin/songlist');
    await tap(page, '[data-add-open="song"]');
    await page.fill('#new-song-title', title);
    await page.fill('#new-song-sub', 'сл. тест');
    if (c1) await page.selectOption('#new-song-cat', c1.id);
    await page.fill('#new-song-pv', '321');
    await tap(page, '[data-add-song]');
    const s = await until(() => one(`select * from songs where title = ${lit(title)}`), 'the new song row');
    eq([s.subtitle, s.category_id, s.pv_number, s.active, s.learning], ['сл. тест', c1 ? c1.id : null, 321, true, false], 'new song (subtitle, category, number, active, learning)');
    await tap(page, `[data-edit-song="${s.id}"]`);
    await page.fill('#edit-song-title', title2);
    await page.fill('#edit-song-sub', 'муз. тест');
    if (c2) await page.selectOption('#edit-song-cat', c2.id);
    await page.fill('#edit-song-pv', '322');
    await tap(page, `[data-save-song-row="${s.id}"]`);
    await until(async () => (await one(`select title from songs where id = ${lit(s.id)}`)).title === title2, 'the edit to be saved');
    const e = await one(`select * from songs where id = ${lit(s.id)}`);
    eq([e.subtitle, e.category_id, e.pv_number], ['муз. тест', c2 ? c2.id : null, 322], 'edited song');
    await tap(page, `[data-archive-song="${s.id}"]:not([data-confirm])`);
    await tap(page, `[data-archive-song="${s.id}"][data-confirm]`);
    await until(async () => (await one(`select active from songs where id = ${lit(s.id)}`)).active === false, 'archived');
    await go(page, '#/sheets');
    eq(await page.locator(`[data-srow="${s.id}"]`).count(), 0, 'archived song still in Choir music');
    await go(page, '#/admin/songlist');
    await tap(page, '[data-toggle-arch-songs]');
    await tap(page, `[data-archive-song="${s.id}"]`);
    await until(async () => (await one(`select active from songs where id = ${lit(s.id)}`)).active === true, 'restored');
    await tap(page, `[data-del-song="${s.id}"]`);
    await until(async () => !await one(`select id from songs where id = ${lit(s.id)}`), 'the song to be deleted');
  });

  await check('D7', 'sheet PDF: upload, lock (moves to locked/), unlock, remove', async () => {
    M = await loadModel();
    const s = M.live.find(x => !x.pdf_path);
    ok(s, 'no song without a sheet');
    const page = await director('#/sheets');
    await adminStrip(page, s.id);
    await page.setInputFiles(`input[data-upload="${s.id}"][data-sheet-kind="sheets"]`, { name: 'test.pdf', mimeType: 'application/pdf', buffer: PDF });
    const p1 = (await until(async () => { const r = await one(`select pdf_path from songs where id = ${lit(s.id)}`); return r.pdf_path && r; }, 'the sheet path to be saved')).pdf_path;
    ok(p1.startsWith(s.id + '/') && p1.endsWith('.pdf'), 'unexpected path ' + p1);
    ok(await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(p1)}`), 'no stored file at ' + p1);
    await until(() => page.locator(`[data-lock="sheets:${s.id}"]`).count(), 'the lock button');
    await tap(page, `[data-lock="sheets:${s.id}"]`);
    const p2 = (await until(async () => { const r = await one(`select pdf_path, pdf_locked from songs where id = ${lit(s.id)}`); return r.pdf_locked && r; }, 'locked')).pdf_path;
    eq(p2, 'locked/' + p1, 'locked path');
    ok(await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(p2)}`) && !await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(p1)}`), 'file not moved to locked/');
    const g = await open({ hash: '#/sheets' });
    eq(await g.locator(`[data-srow="${s.id}"] [data-open]`).count(), 0, 'locked sheet offered to a guest');
    await tap(page, `[data-lock="sheets:${s.id}"]`);
    await until(async () => { const r = await one(`select pdf_path, pdf_locked from songs where id = ${lit(s.id)}`); return !r.pdf_locked && r.pdf_path === p1; }, 'unlocked');
    ok(await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(p1)}`), 'file not moved back');
    await tap(page, `[data-del-pdf="${s.id}"]:not([data-confirm])`);
    await tap(page, `[data-del-pdf="${s.id}"][data-confirm]`);
    await until(async () => !(await one(`select pdf_path from songs where id = ${lit(s.id)}`)).pdf_path, 'the sheet to be removed');
    await until(async () => !await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(p1)}`), 'the stored file to be removed');
  });

  await check('D8', 'lyrics: edit and save', async () => {
    M = await loadModel();
    const s = M.live.find(x => Array.isArray(x.lyrics) && x.lyrics.length >= 2);
    ok(s, 'no song with lyrics');
    const page = await director('#/lyrics/' + short(s.id));
    await tap(page, `button[data-lyr-edit="${s.id}"]`);
    await page.locator('#lyr-t-0').waitFor();
    const v1 = 'Новые слова первого куплета,\nвторая строка.', ch = 'Припев для проверки.';
    await page.fill('#lyr-t-0', v1);
    await tap(page, '[data-blk-add="c"]');
    await page.fill(`#lyr-t-${s.lyrics.length}`, ch);
    await page.fill('#lyr-pv', '77');
    await tap(page, `[data-lyr-save="${s.id}"]`);
    eq(await saved(page, 'saving lyrics'), t('lyrSaved'), 'message');
    const want = [{ t: s.lyrics[0].t, x: v1 }, ...s.lyrics.slice(1).map(b => ({ t: b.t, x: String(b.x).trim() })), { t: 'c', x: ch }];
    const r = await until(async () => { const x = await one(`select lyrics, pv_number from songs where id = ${lit(s.id)}`); return x.pv_number === 77 && x; }, 'the lyrics to be saved');
    eq(r.lyrics, want, 'stored lyrics');
    inOrder(await text(page), ['Новые слова первого куплета,', ch], 'lyrics page after saving');
  });

  await check('D9', 'recordings: upload a part recording, set a full-recording link, remove', async () => {
    M = await loadModel();
    const s = M.live.find(x => !x.audio_url && !Object.keys(x.part_audio || {}).length);
    const mp3 = anyFile(path.join(STORE, 'parts'), '.mp3');
    ok(s && mp3, 'no song without recordings, or no MP3 to upload');
    const page = await director('#/admin/songlist');
    await tap(page, `[data-audio-edit="${s.id}"]`);
    await page.locator('input[data-rec-file="alto"]').waitFor({ state: 'attached' });
    await page.setInputFiles('input[data-rec-file="alto"]', { name: 'Alto.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
    const pa = await until(async () => { const r = await one(`select part_audio from songs where id = ${lit(s.id)}`); return r.part_audio && r.part_audio.alto && r.part_audio.alto.path && r.part_audio; }, 'the alto recording to be saved');
    ok(pa.alto.path.startsWith(s.id + '/alto-'), 'unexpected path ' + pa.alto.path);
    ok(await one(`select 1 from storage.objects where bucket_id = 'parts' and name = ${lit(pa.alto.path)}`), 'no stored recording');
    const res = await fetch(`${BASE}/storage/v1/object/public/parts/${pa.alto.path}`);
    eq(res.status, 200, 'public recording');
    const url = 'https://www.youtube.com/watch?v=e2e-test';
    await tap(page, '[data-rec-link="full"]');
    await page.fill('#rec-link-full', url);
    await tap(page, '[data-rec-link-go="full"]');
    await until(async () => (await one(`select audio_url from songs where id = ${lit(s.id)}`)).audio_url === url, 'the full-recording link to be saved');
    await tap(page, '[data-rec-del="alto"]');
    await tap(page, '[data-rec-del-go="alto"]');
    await until(async () => !(await one(`select part_audio from songs where id = ${lit(s.id)}`)).part_audio.alto, 'the alto recording to be removed');
    await until(async () => !await one(`select 1 from storage.objects where bucket_id = 'parts' and name = ${lit(pa.alto.path)}`), 'the stored recording to be removed');
    await tap(page, '[data-rec-del="full"]');
    await tap(page, '[data-rec-del-go="full"]');
    await until(async () => (await one(`select audio_url from songs where id = ${lit(s.id)}`)).audio_url === null, 'the link to be removed');
  });

  await check('D10', 'members: add, edit name / part / dates, deactivate and reactivate, delete; pianist and conductor roles', async () => {
    const name = 'Тестова Анна', name2 = 'Тестова-Петрова Анна', role = 'Регентов Пётр';
    const page = await director('#/admin/members');
    await tap(page, '[data-add-open="singer"]');
    await page.fill('#new-singer-name', name);
    await page.selectOption('#new-singer-part', 'alto');
    await tap(page, '[data-add-singer]');
    const s = await until(() => one(`select * from singers where name = ${lit(name)}`), 'the new singer row');
    eq([s.part, s.active, s.is_pianist, s.is_conductor], ['alto', true, false, false], 'new singer');
    await tap(page, `[data-edit-singer="${s.id}"]`);
    await page.fill('#edit-name', name2);
    await page.selectOption('#edit-part', 'soprano');
    await page.fill('#edit-joined', '2026-03-01');
    await page.fill('#edit-svc', '2026-04-05');
    await page.check('#edit-is-c');
    await tap(page, `[data-save-person="${s.id}"]`);
    const e = await until(async () => { const r = await one(`select * from singers where id = ${lit(s.id)}`); return r.name === name2 && r; }, 'the edit to be saved');
    eq([e.part, e.joined_on, e.service_start, e.is_conductor], ['soprano', '2026-03-01', '2026-04-05', true], 'edited singer (part, joined, services from, conductor)');
    await tap(page, `[data-archive-singer="${s.id}"]`);
    await until(async () => (await one(`select active from singers where id = ${lit(s.id)}`)).active === false, 'deactivated');
    await tap(page, `[data-archive-singer="${s.id}"]`);
    await until(async () => (await one(`select active from singers where id = ${lit(s.id)}`)).active === true, 'reactivated');
    await go(page, '#/admin/members/pianists');
    await tap(page, '[data-add-open="role"]');
    await page.selectOption('[data-mark-role="is_pianist"]', s.id);
    await until(async () => (await one(`select is_pianist from singers where id = ${lit(s.id)}`)).is_pianist === true, 'pianist role given');
    await tap(page, `[data-drop-role="${s.id}"]`);
    await until(async () => (await one(`select is_pianist from singers where id = ${lit(s.id)}`)).is_pianist === false, 'pianist role removed');
    await go(page, '#/admin/members/conductors');
    await tap(page, '[data-add-open="role"]');
    await page.fill('#new-role-name', role);
    await tap(page, '[data-add-role="is_conductor"]');
    const r = await until(() => one(`select * from singers where name = ${lit(role)}`), 'the new conductor row');
    eq([r.part, r.is_conductor], [null, true], 'new conductor (no voice part)');
    await tap(page, `[data-del-singer="${r.id}"]`);
    await until(async () => !await one(`select id from singers where id = ${lit(r.id)}`), 'the conductor to be deleted');
    await go(page, '#/admin/members');
    await tap(page, `[data-del-singer="${s.id}"]`);
    await until(async () => !await one(`select id from singers where id = ${lit(s.id)}`), 'the singer to be deleted');
  });

  await check('D11', 'member photo: upload and remove', async () => {
    M = await loadModel();
    const s = M.members.find(x => !x.photo_path);
    const jpg = anyFile(path.join(STORE, 'photos'), '.jpg');
    ok(s && jpg, 'no singer without a photo, or no JPEG to upload');
    const page = await director('#/admin/members');
    await tap(page, `[data-edit-singer="${s.id}"]`);
    await page.setInputFiles(`input[data-photo-for="${s.id}"]`, { name: 'me.jpg', mimeType: 'image/jpeg', buffer: jpg });
    const p = (await until(async () => { const r = await one(`select photo_path from singers where id = ${lit(s.id)}`); return r.photo_path && r; }, 'the photo to be saved')).photo_path;
    ok(p.startsWith(s.id + '/') && p.endsWith('.jpg'), 'unexpected path ' + p);
    ok(await one(`select 1 from storage.objects where bucket_id = 'photos' and name = ${lit(p)}`), 'no stored photo');
    const img = await until(() => page.locator(`img[src*="${p}"]`).count(), 'the photo to show');
    ok(img, 'photo not shown');
    const res = await fetch(`${BASE}/storage/v1/object/public/photos/${p}`);
    ok(res.ok && /image\/jpeg/.test(res.headers.get('content-type')), 'public photo not served');
    await tap(page, `[data-photo-del="${s.id}"]`);
    await until(async () => !(await one(`select photo_path from singers where id = ${lit(s.id)}`)).photo_path, 'the photo to be removed');
    await until(async () => !await one(`select 1 from storage.objects where bucket_id = 'photos' and name = ${lit(p)}`), 'the stored photo to be removed');
  });

  await check('D12', 'seating chart: move a singer to another chair (and swap two)', async () => {
    M = await loadModel();
    const seated = M.members.filter(s => PARTS.includes(s.part) && s.seat_block && s.seat_row && s.seat_col);
    const key = s => `${s.seat_block}:${s.seat_row}:${s.seat_col}`, taken = new Set(seated.map(key));
    const X = seated[0];
    let c2 = 1; while (taken.has(`${X.seat_block}:${X.seat_row}:${c2}`)) c2++;
    ok(c2 <= 9, 'no free chair in the block');
    const [Y, Z] = seated.filter(s => s !== X && s.seat_block === X.seat_block).slice(0, 2);
    ok(Y && Z, 'not enough singers in one block');
    const page = await director('#/seating');
    await tap(page, '[data-seat-edit]');
    await tap(page, `[data-seat="${key(X)}"]`);
    await tap(page, `[data-seat="${X.seat_block}:${X.seat_row}:${c2}"]`);
    await tap(page, `[data-seat="${key(Y)}"]`);
    await tap(page, `[data-seat="${key(Z)}"]`);
    await tap(page, '[data-seat-save]');
    eq(await saved(page, 'saving seats'), t('seatsSaved'), 'message');
    const at = async s => { const r = await one(`select seat_block, seat_row, seat_col from singers where id = ${lit(s.id)}`); return `${r.seat_block}:${r.seat_row}:${r.seat_col}`; };
    await until(async () => await at(X) === `${X.seat_block}:${X.seat_row}:${c2}`, `${X.name} in the new chair`);
    eq([await at(Y), await at(Z)], [key(Z), key(Y)], 'swapped singers');
    const p2 = await open({ hash: '#/seating' });
    eq(await p2.$eval(`[data-seat="${X.seat_block}:${X.seat_row}:${c2}"]`, x => x.getAttribute('aria-label') || x.getAttribute('title')), X.name, 'new chair as everyone sees it');
  });

  await check('D13', 'choir rules: edit and save', async () => {
    const before = await one("select * from documents where key = 'rules'");
    const body = '# Правила для проверки\n\n- Первый пункт\n- Второй пункт **важно**\n\nОбычный абзац.';
    const page = await director('#/rules');
    await tap(page, '[data-rules-edit]');
    await page.fill('#rules-edit', body);
    await tap(page, '[data-rules-save]');
    eq(await saved(page, 'saving the rules'), t('rulesSaved'), 'message');
    const r = await until(async () => { const x = await one("select * from documents where key = 'rules'"); return x.body_en === body && x; }, 'the rules to be saved');
    eq(r.body_ru, before.body_ru, 'Russian text untouched by an English edit');
    ok(r.updated_at > before.updated_at, 'updated_at not moved');
    inOrder(await text(page), ['Правила для проверки', 'Первый пункт', 'Второй пункт', 'Обычный абзац.'], 'rules page after saving');
  });

  await check('D14', 'learning: add a learning song, reorder, move it to the repertoire', async () => {
    const title = 'Песнь для разучивания Э2Э';
    const page = await director('#/learning');
    await tap(page, '[data-learn-edit="new"]');
    await page.fill('#ln-title', title);
    await page.fill('#ln-for', 'К Пасхе');
    await page.fill('#ln-note', 'Альты учат второй куплет');
    await tap(page, '[data-learn-save]');
    const s = await until(() => one(`select * from songs where title = ${lit(title)}`), 'the learning song row');
    eq([s.learning, s.learn_for, s.learn_note, s.active], [true, 'К Пасхе', 'Альты учат второй куплет', true], 'learning song');
    M = await loadModel();
    const order = M.learn.map(x => x.id), i = order.indexOf(s.id);
    ok(i >= 0, 'new song not in the learning list');
    await until(async () => JSON.stringify(await page.$$eval(UI.cardTitle, (h, re) => h.map(x => x.innerText.replace(new RegExp(re), '').trim()), UI.pvTag.source)) === JSON.stringify(M.learn.map(x => x.title)), 'the learning page to list it in order');
    const dir = i > 0 ? -1 : 1, j = i + dir;
    ok(j < order.length, 'only one learning song');
    await tap(page, `[data-ln-mv="${s.id}:${dir}"]`);
    [order[i], order[j]] = [order[j], order[i]];
    await until(async () => JSON.stringify((await sql('select id from songs where learning and active order by learn_order nulls last, title')).map(r => r.id)) === JSON.stringify(order), 'the new order to be saved');
    await tap(page, `[data-learn-move="${s.id}"]:not([data-confirm])`);
    await tap(page, `[data-learn-move="${s.id}"][data-confirm]`);
    await until(async () => (await one(`select learning from songs where id = ${lit(s.id)}`)).learning === false, 'moved to the repertoire');
    await go(page, '#/sheets');
    ok(await page.locator(`[data-srow="${s.id}"]`).count(), 'moved song not in Choir music');
  });

  await check('D15', 'usage page loads for the director only', async () => {
    const g = await open({ hash: '#/usage' });
    ok((await text(g)).includes(t('uAdminOnly')), 'guests are not told to sign in');
    eq(await g.locator('[data-count]').count(), 0, 'usage figures shown to a guest');
    const page = await director();
    const figures = async period => {
      const req = page.waitForRequest(r => r.url().includes('/rest/v1/usage_log') && r.method() === 'GET');
      if (period === 30) await go(page, '#/usage');
      else { await tap(page, '[data-toggle-range="usage"]'); await tap(page, `[data-uperiod="${period}"]`); }
      const since = new URL((await req).url()).searchParams.get('at').replace(/^gte\./, '');
      await until(async () => await page.locator('[data-count]').count() >= 4, 'the usage figures');
      const got = (await page.$$eval('[data-count]', x => x.map(e => +e.dataset.count))).slice(0, 4);
      const w = await one(`select count(distinct vid) d, count(*) filter (where kind = 'order') o, count(*) filter (where kind = 'sheet') s, count(*) filter (where kind = 'audio') a from usage_log where at >= ${lit(since)}`);
      eq(got, [+w.d, +w.o, +w.s, +w.a], `devices / order opens / sheet opens / recordings (${period} days)`);
    };
    await figures(30);
    await figures(7);
  });

  await check('D16', 'CSV export downloads (attendance, song history) and the full backup', async () => {
    M = await loadModel();
    const page = await director('#/admin/attendance');
    await tap(page, '[data-export-toggle]');
    const grab = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), tap(page, sel)]); return { name: d.suggestedFilename(), body: fs.readFileSync(await d.path(), 'utf8') }; };
    const csv = s => s.replace(/^﻿/, '').split('\n').map(l => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"')));
    const from = shift(12);
    const att = await grab('[data-export="att"]');
    const ev = M.events.filter(M.hasAtt).filter(e => e.date >= from && e.date <= TODAY).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const want = [[...UI.csvAtt.head, ...ev.map(e => e.date + ' ' + evLabel(e))],
      ...PARTS.flatMap(p => M.members.filter(s => s.part === p).map(s => [s.name, p, ...ev.map(e => e.cancelled ? UI.csvAtt.cancelled : UI.csvAtt[M.status(e, s)])]))];
    const got = csv(att.body);
    eq(got[0], want[0], 'attendance CSV header (12 months)');
    eq(got.length, want.length, 'attendance CSV rows');
    want.forEach((r, i) => { if (JSON.stringify(got[i]) !== JSON.stringify(r)) fail(`attendance CSV row ${i} (${r[0]}): ${show(got[i])}`); });
    ok(/\.csv$/.test(att.name), 'file name ' + att.name);
    const songs = await grab('[data-export="songs"]');
    const sev = M.events.filter(e => M.songsFor(e.id).length).filter(e => e.date >= from && e.date <= TODAY).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    eq(csv(songs.body), [UI.csvSongs, ...sev.flatMap(e => M.songsFor(e.id).map((s, i) => [e.date, e.name || e.kind, String(i + 1), s.title, s.subtitle || '']))], 'song history CSV');
    const bk = await grab('[data-backup]');
    const dump = JSON.parse(bk.body);
    for (const tb of ['singers', 'events', 'songs', 'song_categories', 'absences', 'event_songs']) eq((dump.tables[tb] || []).length, +(await one(`select count(*) n from ${tb}`)).n, `backup rows in ${tb}`);
  });

  /* D17: the token can expire between sign-in and a save, and the database can refuse a
     write without an error (row-level security just matches no rows) */
  await check('D17a', 'an expired session is refreshed before a write', async () => {
    M = await loadModel();
    const s = M.live[7];
    try {
      await post('/__test/auth', { ttl: 5 });          // the next sign-in gets a 5-second token
      const page = await open({ hash: '#/login', now: new Date().toISOString() });   // page clock = server clock
      const grants = [], writes = [];
      const reading = [];   // token responses still being read; awaited before the checks below
      page.on('response', r => { if (r.url().includes('/auth/v1/token')) reading.push((async () => { let b = {}; try { b = await r.json(); } catch (_) {} grants.push({ g: new URL(r.url()).searchParams.get('grant_type'), tok: b.access_token }); })()); });
      page.on('request', r => { if (r.url().includes('/rest/v1/songs') && r.method() === 'PATCH') writes.push(r.headers().authorization); });
      await signIn(page);
      await atHash(page, /^#\/admin/, 10000);
      await post('/__test/auth', { ttl: 3600 });
      await Promise.all(reading);
      const first = grants.find(x => x.g === 'password');
      ok(first && first.tok, 'no sign-in token seen');
      await go(page, '#/admin/songlist');
      await sleep(6500);                                 // now expired for the server as well
      const sub = 'после обновления сессии ' + Date.now().toString(36);
      await tap(page, `[data-edit-song="${s.id}"]`);
      await page.fill('#edit-song-sub', sub);
      await tap(page, `[data-save-song-row="${s.id}"]`);
      const w = await until(() => writes[0], 'the save request', 5000);
      ok(w !== 'Bearer ' + first.tok, 'the write was sent with the expired token');
      await until(async () => (await one(`select subtitle from songs where id = ${lit(s.id)}`)).subtitle === sub, 'the write to land');
      await Promise.all(reading);
      ok(grants.some(x => x.g === 'refresh_token' && 'Bearer ' + x.tok === w), 'the write did not use a refreshed token (token grants seen: ' + (grants.map(x => x.g + (x.tok ? '' : ' (no token)')).join(', ') || 'none') + ')');   // the app or the library's own timer may refresh
      const msg = await toastText(page);
      ok(!msg.startsWith(t('notSaved')), 'reported as failed: ' + msg);
    } finally { await post('/__test/auth', { ttl: 3600 }); }
  });

  const BLOCK = ['songs', 'absences', 'events'].map(tb => `create policy e2e_refuse_update on public.${tb} as restrictive for update to authenticated using (false);
    create policy e2e_refuse_delete on public.${tb} as restrictive for delete to authenticated using (false);`).join('\n');
  const UNBLOCK = ['songs', 'absences', 'events'].map(tb => `drop policy if exists e2e_refuse_update on public.${tb}; drop policy if exists e2e_refuse_delete on public.${tb};`).join('\n');
  async function refused(id, what, fn) {
    await check(id, what, async () => {
      M = await loadModel();
      await sql(UNBLOCK + BLOCK);
      try { await fn(); } finally { await sql(UNBLOCK); }
    });
  }
  /* every consequence is collected, so one line tells the whole story */
  const notSaved = async (page, what, problems) => {
    const msg = await until(async () => { const x = await toastText(page); return x && x; }, `a message after ${what}`, 4000).catch(() => '');
    if (!msg.startsWith(t('notSaved'))) problems.push(`${what} changed nothing in the database but the app ${msg ? 'said "' + msg + '"' : 'reported nothing'}`);
  };
  const report = problems => { if (problems.length) fail(problems.join('; ')); };
  await refused('D17b', 'a song edit the database refuses is reported, never shown as saved', async () => {
    const s = M.live[8];
    const page = await director('#/admin/songlist');
    await tap(page, `[data-edit-song="${s.id}"]`);
    await page.fill('#edit-song-title', s.title + ' (изм.)');
    await tap(page, `[data-save-song-row="${s.id}"]`);
    const problems = [];
    await notSaved(page, 'the song edit', problems);
    if ((await one(`select title from songs where id = ${lit(s.id)}`)).title !== s.title) problems.push('the title changed anyway');
    report(problems);
  });
  await refused('D17c', 'an attendance change the database refuses is reported, never shown as saved', async () => {
    const E = M.events.filter(e => e.attendance_taken && !e.cancelled && e.date <= TODAY).reverse().find(e => M.members.some(s => M.abs.get(e.id + '|' + s.id) === 'absent' && M.status(e, s) === 'absent'));
    const A = M.members.find(s => M.abs.get(E.id + '|' + s.id) === 'absent' && M.status(E, s) === 'absent');
    const page = await director('#/admin/attendance/' + E.id);
    await tap(page, `[data-toggle-absent="${A.id}"]`);          // absent → present: deletes the row
    await tap(page, '[data-save-marks]');
    const problems = [];
    await notSaved(page, 'marking ' + A.name + ' present', problems);
    if ((await one(`select status from absences where event_id = ${lit(E.id)} and singer_id = ${lit(A.id)}`) || {}).status !== 'absent') problems.push('the mark changed anyway');
    report(problems);
  });
  /* a song with its own stored, unlocked sheet (the file, its storage row and the path) */
  const storedSheet = async () => {
    const s = M.live.find(x => !x.pdf_path);
    if (!s) return null;
    const name = s.id + '/e2e-' + Date.now() + '.pdf', f = path.join(STORE, 'sheets', name);
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, PDF);
    await sql(`insert into storage.objects (bucket_id, name, metadata) values ('sheets', ${lit(name)}, '{"size":${PDF.length},"mimetype":"application/pdf"}');
      update songs set pdf_path = ${lit(name)} where id = ${lit(s.id)}`);
    return Object.assign({}, s, { pdf_path: name });
  };
  await refused('D17d', 'making a sheet admin-only when the database refuses is reported, and the sheet stays reachable', async () => {
    const s = await storedSheet();
    ok(s, 'no stored sheet');
    const page = await director('#/sheets');
    await adminStrip(page, s.id);
    await tap(page, `[data-lock="sheets:${s.id}"]`);
    const problems = [];
    await notSaved(page, 'making the sheet admin-only', problems);
    const r = await one(`select pdf_path, pdf_locked from songs where id = ${lit(s.id)}`);
    if (r.pdf_locked) problems.push('the sheet was locked anyway');
    if (!await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(r.pdf_path)}`)) problems.push(`the file was moved to locked/ while the song still points at ${r.pdf_path}, so nobody can open it`);
    report(problems);
  });
  await refused('D17e', 'removing a sheet when the database refuses is reported, and the file is kept', async () => {
    const s = await storedSheet();
    ok(s, 'no stored sheet');
    const page = await director('#/sheets');
    await adminStrip(page, s.id);
    await tap(page, `[data-del-pdf="${s.id}"]:not([data-confirm])`);
    await tap(page, `[data-del-pdf="${s.id}"][data-confirm]`);
    const problems = [];
    await notSaved(page, 'removing the sheet', problems);
    const r = await one(`select pdf_path from songs where id = ${lit(s.id)}`);
    if (r.pdf_path !== s.pdf_path) problems.push('the path changed anyway');
    await sleep(500);
    if (!await one(`select 1 from storage.objects where bucket_id = 'sheets' and name = ${lit(r.pdf_path)}`)) problems.push('the file was deleted while the song still points at it, so nobody can open it');
    report(problems);
  });

  await check('A20d', 'director screens fit a 390 px phone with no sideways page scroll', async () => {
    M = await loadModel();
    const e = M.events.filter(x => x.attendance_taken && x.date <= TODAY).slice(-1)[0];
    const sv = M.events.filter(x => x.kind !== 'rehearsal' && M.songsFor(x.id).length && x.date >= TODAY)[0];
    const page = await director();
    const bad = [];
    for (const r of ['#/admin/attendance', '#/admin/attendance/' + e.id, '#/admin/songs', '#/admin/songs/' + (sv || e).id, '#/admin/songlist', '#/admin/members', '#/admin/members/pianists', '#/admin/entries/att', '#/usage', '#/sheets', '#/seating', '#/rules']) {
      await go(page, r, 200);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (w[0] > w[1]) bad.push(`${r} ${w[0]}>${w[1]}`);
    }
    ok(!bad.length, 'sideways scroll on ' + bad.join(', '));
  });
}

/* =====================================================================
   main
   ===================================================================== */
async function main() {
  if (!process.env.NO_RESET) {
    const run = (f, args) => { try { execFileSync(path.join(HERE, f), args, { stdio: 'pipe' }); }
      catch (e) { console.error(f + ' failed:\n' + String(e.stdout || '') + String(e.stderr || '')); process.exit(2); } };
    run('reset.sh', [DB, CHOIR].concat(process.env.SCHEMA === 'new' ? ['new'] : []));
    run('start.sh', [String(PORT), DB, SITE]);
  }
  await until(async () => (await fetch(BASE + '/index.html')).ok, 'the stack on port ' + PORT, 15000);
  await ensureLockedSheet();
  M = await loadModel();
  browser = await launch();
  const newContext = browser.newContext.bind(browser);   // every page gets the test hooks
  browser.newContext = async o => { const c = await newContext(o); await c.addInitScript(INSTRUMENT); return c; };
  const t0 = Date.now();
  try {
    await guestChecks();
    await directorChecks();
  } finally { await browser.close(); }
  const bad = results.filter(r => !r.ok).length;
  console.log(`${results.length - bad} passed, ${bad} failed` + (VERBOSE ? ` (${Math.round((Date.now() - t0) / 1000)} s)` : ''));
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
