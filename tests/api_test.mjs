// Checks the database rules the way an outsider would try them: as a guest with
// the public key, as someone who managed to create an account, and as the
// director. Every write is verified in the database afterwards.
//   PORT=8790 DB=choir_senior node api_test.mjs
// The stack must be running (start.sh); the script resets nothing itself, so run
// it on a freshly reset database (reset.sh <db> <choir> [new]).
const PORT = +(process.env.PORT || 8790);
const BASE = 'http://127.0.0.1:' + PORT;
const ANON = 'anon-key';
let pass = 0, fail = 0;
const results = [];
function check(id, what, ok, detail = '') {
  if (ok) pass++; else fail++;
  const line = `${ok ? 'PASS' : 'FAIL'} ${id} ${what}${ok || !detail ? '' : ' — ' + detail}`;
  results.push(line); console.log(line);
}
async function sql(q) {
  const r = await fetch(BASE + '/__test/sql', { method: 'POST', body: q });
  if (!r.ok) throw new Error('sql: ' + await r.text());
  return r.json();
}
const one = async q => (await sql(q))[0];
async function api(method, path, { token, body, headers = {}, raw } = {}) {
  const h = Object.assign({ apikey: ANON, Authorization: 'Bearer ' + (token || ANON) }, headers);
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { status: r.status, json, text };
}
const rep = { Prefer: 'return=representation' };
async function signIn(email, password) {
  const r = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  return r.json && r.json.access_token;
}

const ids = await one(`select
  (select id from singers order by sort_order limit 1) as singer,
  (select id from songs order by title limit 1) as song,
  (select id from events order by date desc limit 1) as event,
  (select id from song_categories limit 1) as category,
  (select count(*)::int from singers) as singers,
  (select count(*)::int from absences) as absences,
  (select name from storage.objects where bucket_id = 'sheets' and name like 'locked/%' limit 1) as locked,
  (select name from storage.objects where bucket_id = 'sheets' and name not like 'locked/%' limit 1) as open,
  (select name from storage.objects where bucket_id = 'photos' limit 1) as photo,
  exists (select 1 from information_schema.columns where table_name = 'events' and column_name = 'demo') as senior,
  exists (select 1 from information_schema.columns where table_name = 'songs' and column_name = 'learn_listed') as listed,
  to_regclass('public.learn_folders') is not null as dates`);
if (ids.dates) await one(`insert into learn_folders (key, due) values ('тест даты', '2026-12-25') on conflict (key) do update set due = excluded.due returning key`);

// ---------------- guest ----------------
for (const t of ['singers', 'songs', 'events', 'absences', 'event_songs', 'song_categories', 'documents']) {
  const r = await api('GET', `/rest/v1/${t}?select=*&limit=5`);
  check('G1', `guest can read ${t}`, r.status === 200 && Array.isArray(r.json) && r.json.length > 0, r.status + ' ' + r.text.slice(0, 80));
}
if (ids.dates) {                          // 5.54: folder dates
  const r = await api('GET', '/rest/v1/learn_folders?select=key,due');
  check('G11', 'guest can read folder dates', r.status === 200 && Array.isArray(r.json) && r.json.some(x => x.key === 'тест даты' && x.due === '2026-12-25'), r.status + ' ' + r.text.slice(0, 80));
  const ins = await api('POST', '/rest/v1/learn_folders', { body: { key: 'чужая', due: '2026-12-01' }, headers: rep });
  const upd = await api('PATCH', `/rest/v1/learn_folders?key=eq.${encodeURIComponent('тест даты')}`, { body: { due: '2027-01-01' }, headers: rep });
  const del = await api('DELETE', '/rest/v1/learn_folders?key=not.is.null', { headers: rep });
  const after = await one(`select (select count(*)::int from learn_folders where key = 'чужая') n, (select due::text from learn_folders where key = 'тест даты') due`);
  check('G12', 'guest cannot add, change or delete folder dates', ins.status >= 400 && after.n === 0 && after.due === '2026-12-25', `insert ${ins.status}, update ${upd.status}, delete ${del.status}, now ${JSON.stringify(after)}`);
}
{
  const r = await api('GET', '/rest/v1/usage_log?select=*&limit=5');
  check('G2', 'guest cannot read the usage log', r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), r.status + ' ' + r.text.slice(0, 80));
}
{
  const before = await one(`select name from singers where id = '${ids.singer}'`);
  const ins = await api('POST', '/rest/v1/singers', { body: { name: 'Чужой' }, headers: rep });
  const upd = await api('PATCH', `/rest/v1/singers?id=eq.${ids.singer}`, { body: { name: 'Изменено' }, headers: rep });
  const del = await api('DELETE', `/rest/v1/absences?event_id=not.is.null`, { headers: rep });
  const after = await one(`select name, (select count(*)::int from singers) n, (select count(*)::int from absences) a from singers where id = '${ids.singer}'`);
  check('G3', 'guest cannot add, change or delete rows', ins.status >= 400 && after.name === before.name && after.n === ids.singers && after.a === ids.absences,
    `insert ${ins.status}, update ${upd.status}, delete ${del.status}, name now ${after.name}, singers ${after.n}, absences ${after.a}`);
}
{
  const upd = await api('PATCH', `/rest/v1/singer_attendance?id=eq.${ids.singer}`, { body: { name: 'Через представление' }, headers: rep });
  const del = await api('DELETE', `/rest/v1/singer_attendance?id=eq.${ids.singer}`, { headers: rep });
  const ins = await api('POST', '/rest/v1/singer_attendance', { body: { name: 'Новый через представление' }, headers: rep });
  const after = await one(`select (select name from singers where id = '${ids.singer}') as name, (select count(*)::int from singers) n, (select count(*)::int from absences) a`);
  check('G4', 'guest cannot write through the old views', after.name && after.name !== 'Через представление' && after.n === ids.singers && after.a === ids.absences,
    `update ${upd.status}, delete ${del.status}, insert ${ins.status}; singer now ${after.name}, singers ${after.n}/${ids.singers}, absences ${after.a}/${ids.absences}`);
}
{
  const ok = await api('POST', '/rest/v1/usage_log', { body: { kind: 'page', ref: 'home', lang: 'en', vid: 'test-visitor', device: 'iphone', app: false } });
  check('G5', 'guest can add a normal usage-log row', ok.status === 201, ok.status + ' ' + ok.text.slice(0, 80));
  const withId = await api('POST', '/rest/v1/usage_log', { body: { id: 999999999, kind: 'page', ref: 'x' } });
  const withAt = await api('POST', '/rest/v1/usage_log', { body: { kind: 'page', ref: 'x', at: '2099-01-01T00:00:00Z' } });
  const big = await api('POST', '/rest/v1/usage_log', { body: { kind: 'page', ref: 'x'.repeat(5000) } });
  const lang = await api('POST', '/rest/v1/usage_log', { body: { kind: 'page', ref: 'x', lang: '<script>' } });
  check('G6', 'guest cannot choose the id or time, or send oversized or odd values', [withId, withAt, big, lang].every(r => r.status >= 400),
    `id ${withId.status}, at ${withAt.status}, 5000-char ref ${big.status}, lang ${lang.status}`);
}
{
  const up = await api('POST', '/storage/v1/object/photos/intruder/x.jpg', { body: 'not really a photo', raw: true, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } });
  const rm = await api('DELETE', '/storage/v1/object/photos', { body: { prefixes: [ids.photo] } });
  const still = await one(`select count(*)::int n from storage.objects where bucket_id = 'photos' and name = '${ids.photo}'`);
  check('G7', 'guest cannot upload or delete files', up.status >= 400 && still.n === 1, `upload ${up.status}, delete ${rm.status} (photo still there: ${still.n === 1})`);
  const pub = await fetch(`${BASE}/storage/v1/object/public/photos/${ids.photo}`);
  check('G8', 'guest can load a member photo', pub.status === 200, String(pub.status));
  if (ids.open) {
    const s = await api('POST', `/storage/v1/object/sign/sheets/${ids.open}`, { body: { expiresIn: 60 } });
    check('G9', 'guest can open an ordinary sheet', s.status === 200 && s.json && s.json.signedURL, s.status + ' ' + s.text.slice(0, 80));
  }
  if (ids.locked) {
    const s = await api('POST', `/storage/v1/object/sign/sheets/${ids.locked}`, { body: { expiresIn: 60 } });
    check('G10', 'guest cannot open a locked sheet', s.status >= 400, s.status + ' ' + s.text.slice(0, 80));
  }
}

// ---------------- someone who created an account ----------------
await fetch(BASE + '/__test/auth', { method: 'POST', body: JSON.stringify({ signups: true }) });
const su = await api('POST', '/auth/v1/signup', { body: { email: 'intruder@example.test', password: 'whatever-123' } });
await fetch(BASE + '/__test/auth', { method: 'POST', body: JSON.stringify({ signups: false }) });
const intruder = su.json && su.json.access_token;
check('I0', 'test setup: an outside account exists', !!intruder, su.status + ' ' + su.text.slice(0, 80));
if (intruder) {
  const T = { token: intruder };
  const ins = await api('POST', '/rest/v1/events', Object.assign({ body: { date: '2026-11-08', kind: 'other', label: 'X', name: 'Чужое событие' }, headers: rep }, T));
  const upd = await api('PATCH', `/rest/v1/songs?id=eq.${ids.song}`, Object.assign({ body: { title: 'Чужое название' }, headers: rep }, T));
  const del = await api('DELETE', `/rest/v1/absences?event_id=not.is.null`, Object.assign({ headers: rep }, T));
  const doc = await api('POST', '/rest/v1/documents?on_conflict=key', Object.assign({ body: { key: 'rules', body_ru: 'взлом', body_en: 'hacked' }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }, T));
  const after = await one(`select (select count(*)::int from events where name = 'Чужое событие') ev, (select title from songs where id = '${ids.song}') title,
    (select count(*)::int from absences) a, (select body_en from documents where key = 'rules') rules`);
  check('I1', 'an outside account cannot add events', ins.status >= 400 && after.ev === 0, `insert ${ins.status}, rows ${after.ev}`);
  check('I2', 'an outside account cannot rename songs', after.title !== 'Чужое название', `update ${upd.status}, title now ${after.title}`);
  check('I3', 'an outside account cannot delete attendance', after.a === ids.absences, `delete ${del.status}, absences ${after.a}/${ids.absences}`);
  check('I4', 'an outside account cannot rewrite the rules', after.rules !== 'hacked', `upsert ${doc.status}`);
  if (ids.listed) {                       // 5.51: repertoire songs on the Learning page
    const ul = await api('PATCH', `/rest/v1/songs?id=eq.${ids.song}`, Object.assign({ body: { learn_listed: true }, headers: rep }, T));
    const now = await one(`select learn_listed from songs where id = '${ids.song}'`);
    check('I9', 'an outside account cannot put songs on the Learning page', now.learn_listed === false, `update ${ul.status}, learn_listed ${now.learn_listed}`);
  }
  if (ids.dates) {
    const ins = await api('POST', '/rest/v1/learn_folders?on_conflict=key', Object.assign({ body: { key: 'тест даты', due: '2027-02-02' }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }, T));
    const del = await api('DELETE', '/rest/v1/learn_folders?key=not.is.null', Object.assign({ headers: rep }, T));
    const r = await one(`select (select due::text from learn_folders where key = 'тест даты') due, (select count(*)::int from learn_folders) n`);
    check('I10', 'an outside account cannot set or delete folder dates', r.due === '2026-12-25' && r.n >= 1, `upsert ${ins.status}, delete ${del.status}, now ${JSON.stringify(r)}`);
  }
  const log = await api('GET', '/rest/v1/usage_log?select=*&limit=5', T);
  check('I5', 'an outside account cannot read the usage log', log.status >= 400 || (Array.isArray(log.json) && log.json.length === 0), `${log.status}, ${Array.isArray(log.json) ? log.json.length + ' rows' : ''}`);
  const up = await api('POST', '/storage/v1/object/photos/intruder/x.jpg', Object.assign({ body: 'x', raw: true, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } }, T));
  const rm = await api('DELETE', '/storage/v1/object/photos', Object.assign({ body: { prefixes: [ids.photo] } }, T));
  const still = await one(`select count(*)::int n from storage.objects where bucket_id = 'photos' and name = '${ids.photo}'`);
  check('I6', 'an outside account cannot upload or delete files', up.status >= 400 && still.n === 1, `upload ${up.status}, delete ${rm.status}, photo still there: ${still.n === 1}`);
  if (ids.locked) {
    const s = await api('POST', `/storage/v1/object/sign/sheets/${ids.locked}`, Object.assign({ body: { expiresIn: 60 } }, T));
    check('I7', 'an outside account cannot open a locked sheet', s.status >= 400, String(s.status));
  }
  if (ids.open) {
    const mv = await api('POST', '/storage/v1/object/move', Object.assign({ body: { bucketId: 'sheets', sourceKey: ids.open, destinationKey: 'locked/' + ids.open } }, T));
    const where = await one(`select count(*)::int n from storage.objects where bucket_id = 'sheets' and name = '${ids.open}'`);
    check('I8', 'an outside account cannot move files', mv.status >= 400 && where.n === 1, `move ${mv.status}`);
  }
}

// ---------------- the director ----------------
const dir = await signIn('director@example.test', 'choir-test-pass');
check('D0', 'the director can sign in', !!dir);
const bad = await api('POST', '/auth/v1/token?grant_type=password', { body: { email: 'director@example.test', password: 'wrong' } });
check('D0b', 'a wrong password is refused', bad.status === 400, String(bad.status));
if (dir) {
  const T = { token: dir };
  const s = await api('POST', '/rest/v1/singers', Object.assign({ body: { name: 'Тестовый Певец', part: 'tenor' }, headers: rep }, T));
  const sid = s.json && s.json[0] && s.json[0].id;
  check('W1', 'director adds a singer', s.status === 201 && !!sid, s.status + ' ' + s.text.slice(0, 80));
  const e = await api('POST', '/rest/v1/events', Object.assign({ body: { date: '2026-11-11', kind: 'other', label: 'S', name: 'Тестовое событие' }, headers: rep }, T));
  const eid = e.json && e.json[0] && e.json[0].id;
  check('W2', 'director adds an event', e.status === 201 && !!eid, e.status + ' ' + e.text.slice(0, 80));
  const a = await api('POST', '/rest/v1/absences', Object.assign({ body: [{ event_id: eid, singer_id: sid, status: 'absent' }], headers: rep }, T));
  check('W3', 'director marks an absence', a.status === 201, a.status + ' ' + a.text.slice(0, 80));
  const es = await api('POST', '/rest/v1/event_songs', Object.assign({ body: [{ event_id: eid, song_id: ids.song, position: 1, conductor_id: sid }], headers: rep }, T));
  check('W4', 'director sets a song order', es.status === 201, es.status + ' ' + es.text.slice(0, 80));
  const so = await api('PATCH', `/rest/v1/songs?id=eq.${ids.song}`, Object.assign({ body: { subtitle: 'обр. для хора', lyrics: [{ t: 'v', x: 'строка' }] }, headers: rep }, T));
  check('W5', 'director edits a song', so.status === 200 && so.json && so.json.length === 1, so.status + ' ' + so.text.slice(0, 80));
  if (ids.listed) {
    const on = await api('PATCH', `/rest/v1/songs?id=eq.${ids.song}`, Object.assign({ body: { learn_listed: true, learn_for: 'Тест' }, headers: rep }, T));
    const off = await api('PATCH', `/rest/v1/songs?id=eq.${ids.song}`, Object.assign({ body: { learn_listed: false }, headers: rep }, T));
    const r = await one(`select learn_listed, learning from songs where id = '${ids.song}'`);
    check('W13', 'director puts a repertoire song on the Learning page and takes it off', on.status === 200 && on.json && on.json[0] && on.json[0].learn_listed === true
      && off.status === 200 && r.learn_listed === false && r.learning === false, `${on.status}/${off.status}, now ${JSON.stringify(r)}`);
  }
  if (ids.dates) {
    const up = await api('POST', '/rest/v1/learn_folders?on_conflict=key', Object.assign({ body: { key: 'новая папка', due: '2027-03-13' }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }, T));
    const re = await api('POST', '/rest/v1/learn_folders?on_conflict=key', Object.assign({ body: { key: 'новая папка', due: '2027-03-14' }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }, T));
    const mid = await one(`select due::text from learn_folders where key = 'новая папка'`);
    const del = await api('DELETE', `/rest/v1/learn_folders?key=in.(${encodeURIComponent('"новая папка"')},${encodeURIComponent('"тест даты"')})`, Object.assign({ headers: rep }, T));
    const r = await one(`select count(*)::int n from learn_folders where key in ('новая папка', 'тест даты')`);
    check('W14', 'director sets, changes and clears folder dates', up.status === 201 && re.status === 201 && mid && mid.due === '2027-03-14' && del.status === 200 && r.n === 0,
      `${up.status}/${re.status}/${del.status}, mid ${JSON.stringify(mid)}, left ${r.n}`);
  }
  const c = await api('POST', '/rest/v1/song_categories', Object.assign({ body: { name: 'Тестовая' }, headers: rep }, T));
  check('W6', 'director adds a category', c.status === 201, String(c.status));
  const d = await api('POST', '/rest/v1/documents?on_conflict=key', Object.assign({ body: { key: 'rules', body_ru: '# Правила', body_en: '# Rules' }, headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }, T));
  check('W7', 'director saves the rules', d.status === 201 && d.json && d.json[0] && d.json[0].body_en === '# Rules', d.status + ' ' + d.text.slice(0, 80));
  const da = await api('DELETE', `/rest/v1/absences?event_id=eq.${eid}&singer_id=in.(${sid})`, Object.assign({ headers: rep }, T));
  const de = await api('DELETE', `/rest/v1/events?id=eq.${eid}`, Object.assign({ headers: rep }, T));
  const ds = await api('DELETE', `/rest/v1/singers?id=eq.${sid}`, Object.assign({ headers: rep }, T));
  check('W8', 'director deletes an absence, an event and a singer', [da, de, ds].every(r => r.status === 200 && r.json && r.json.length === 1), `${da.status}/${de.status}/${ds.status}`);
  const log = await api('GET', '/rest/v1/usage_log?select=kind&limit=5', T);
  check('W9', 'director reads the usage log', log.status === 200 && Array.isArray(log.json) && log.json.length > 0, String(log.status));

  const up = await api('POST', '/storage/v1/object/photos/' + ids.singer + '/new.jpg', Object.assign({ body: 'jpegdata', raw: true, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } }, T));
  check('W10', 'director uploads a photo', up.status === 200, up.status + ' ' + up.text.slice(0, 80));
  const sh = await api('POST', '/storage/v1/object/sheets/test-song/1.pdf', Object.assign({ body: '%PDF-1.4', raw: true, headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' } }, T));
  const mv = await api('POST', '/storage/v1/object/move', Object.assign({ body: { bucketId: 'sheets', sourceKey: 'test-song/1.pdf', destinationKey: 'locked/test-song/1.pdf' } }, T));
  const sg = await api('POST', '/storage/v1/object/sign/sheets/locked/test-song/1.pdf', Object.assign({ body: { expiresIn: 60 } }, T));
  const rm = await api('DELETE', '/storage/v1/object/sheets', Object.assign({ body: { prefixes: ['locked/test-song/1.pdf'] } }, T));
  check('W11', 'director uploads, locks, opens and removes a sheet', [sh, mv, sg, rm].every(r => r.status === 200) && rm.json && rm.json.length === 1, `${sh.status}/${mv.status}/${sg.status}/${rm.status}`);
  const pt = await api('POST', '/storage/v1/object/parts/test-song/full-1.mp3', Object.assign({ body: 'ID3', raw: true, headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'false' } }, T));
  const pbad = await api('POST', '/storage/v1/object/parts/test-song/evil.html', Object.assign({ body: '<script>', raw: true, headers: { 'Content-Type': 'text/html', 'x-upsert': 'false' } }, T));
  check('W12', 'director uploads a part recording; non-audio is refused', pt.status === 200 && pbad.status >= 400, `${pt.status}/${pbad.status}`);
}

// ---------------- atomic saves (save_marks, needs its migration) ----------------
{
  const has = await one(`select count(*)::int n from pg_proc where proname = 'save_marks'`);
  if (has.n) {
    const singers = await sql(`select id from singers where active and part is not null order by sort_order limit 3`);
    const anonTry = await api('POST', '/rest/v1/rpc/save_marks', { body: { p_event: { date: '2026-11-12', kind: 'rehearsal', label: 'R' }, p_mode: 'att', p_del: [], p_ins: [{ singer_id: singers[0].id, status: 'absent' }] } });
    check('R1', 'a guest cannot call save_marks', anonTry.status >= 400, String(anonTry.status));
    if (intruder) {
      const r = await api('POST', '/rest/v1/rpc/save_marks', { token: intruder, body: { p_event: { date: '2026-11-12', kind: 'rehearsal', label: 'R' }, p_mode: 'att', p_del: [], p_ins: [] } });
      const ev = await one(`select count(*)::int n from events where date = '2026-11-12'`);
      check('R2', 'an outside account cannot save marks', r.status >= 400 && ev.n === 0, `${r.status}, events on that date: ${ev.n}`);
    }
    if (dir) {
      const T = { token: dir };
      const r = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { date: '2026-11-12', kind: 'rehearsal', label: 'R' }, p_mode: 'att', p_del: [],
        p_ins: [{ singer_id: singers[0].id, status: 'absent' }, { singer_id: singers[1].id, status: 'not_listed' }] } }, T));
      const id = r.json;
      const st = await one(`select (select attendance_taken from events where id = '${id}') taken, (select count(*)::int from absences where event_id = '${id}') n`);
      check('R3', 'director saves a new event with its marks in one call', r.status === 200 && st.taken === true && st.n === 2, `${r.status} ${r.text.slice(0, 80)} taken=${st.taken} rows=${st.n}`);
      const r2 = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { id, cancelled: false }, p_mode: 'att',
        p_del: [singers[0].id, singers[1].id], p_ins: [{ singer_id: singers[1].id, status: 'absent' }, { singer_id: singers[2].id, status: 'absent' }] } }, T));
      const rows = await sql(`select singer_id, status from absences where event_id = '${id}' order by singer_id`);
      const want = [singers[1].id, singers[2].id].sort();
      check('R4', 'director changes marks: removed, changed and added in one call', r2.status === 200 && rows.length === 2 && rows.every(x => x.status === 'absent') && rows.map(x => x.singer_id).sort().join() === want.join(),
        `${r2.status} ${JSON.stringify(rows)}`);
      // a failing row (unknown singer) must roll back the whole call, the event change included
      const r3 = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { id, date: '2026-11-13' }, p_mode: 'att', p_del: [singers[1].id],
        p_ins: [{ singer_id: '00000000-0000-4000-a000-000000000000', status: 'absent' }] } }, T));
      const after = await one(`select (select date from events where id = '${id}') d, (select count(*)::int from absences where event_id = '${id}') n`);
      check('R5', 'a save that fails part-way changes nothing', r3.status >= 400 && after.d === '2026-11-12' && after.n === 2, `${r3.status}, date ${after.d}, rows ${after.n}`);
      // cancelling changes only the flag: the stored marks stay, so un-cancelling brings them back
      const r4 = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { id, cancelled: true }, p_mode: 'att', p_del: [], p_ins: [] } }, T));
      const cx = await one(`select (select cancelled from events where id = '${id}') c, (select count(*)::int from absences where event_id = '${id}') n`);
      check('R6', 'cancelling a date keeps its stored marks', r4.status === 200 && cx.c === true && cx.n === 2, `${r4.status}, cancelled ${cx.c}, rows ${cx.n}`);
      // a new date saved as cancelled before anyone was marked stays unmarked
      const r5 = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { date: '2026-11-14', kind: 'rehearsal', label: 'R', cancelled: true }, p_mode: 'att', p_del: [], p_ins: [] } }, T));
      const nx = await one(`select attendance_taken t from events where id = '${r5.json}'`);
      check('R7', 'a date cancelled before marking stays unmarked', r5.status === 200 && nx.t === false, `${r5.status}, attendance_taken ${nx.t}`);
      await api('DELETE', `/rest/v1/events?id=eq.${r5.json}`, Object.assign({ headers: rep }, T));
      // a delete that row-level security silently filters out must fail the save, not pass as done
      await sql(`create policy api_refuse_delete on public.absences as restrictive for delete to authenticated using (false)`);
      const r6 = await api('POST', '/rest/v1/rpc/save_marks', Object.assign({ body: { p_event: { id }, p_mode: 'att', p_del: [singers[1].id], p_ins: [] } }, T));
      await sql(`drop policy if exists api_refuse_delete on public.absences`);
      const kept = await one(`select count(*)::int n from absences where event_id = '${id}'`);
      check('R8', 'a refused delete fails the save instead of passing as done', r6.status >= 400 && kept.n === 2, `${r6.status}, rows ${kept.n}`);
      await api('DELETE', `/rest/v1/events?id=eq.${id}`, Object.assign({ headers: rep }, T));
    }
  } else console.log('(save_marks not installed: skipped R1–R8)');
}

// ---------------- flood guard (needs the migration) ----------------
{
  await sql(`insert into usage_log (kind, ref) select 'page', 'flood' from generate_series(1, 1995)`);
  let ok = 0;
  for (let i = 0; i < 10; i++) { const r = await api('POST', '/rest/v1/usage_log', { body: { kind: 'page', ref: 'flood-' + i } }); if (r.status === 201) ok++; }
  const n = await one(`select count(*)::int n from usage_log where at > now() - interval '1 hour'`);
  check('G11', 'the usage log stops growing past 2,000 rows an hour', n.n <= 2000, `${n.n} rows in the last hour`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
