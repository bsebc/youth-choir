// Synthetic sample data for the local harness, shaped like the live choirs
// (same tables, similar volumes and mixes) but invented: no real names, songs,
// lyrics or recordings, so it is safe in a public repository.
//   node seed.mjs <senior|youth> <storage-dir>  > sql
// Deterministic: the same arguments always produce the same data.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHOIR = process.argv[2] || 'youth';
const STORE = process.argv[3] || '/tmp/harness-storage/' + CHOIR;
const senior = CHOIR === 'senior';

let seed = senior ? 7 : 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
let uc = 0;
const uuid = () => {   // stable, valid v4-shaped ids
  const h = (++uc).toString(16).padStart(8, '0') + Math.floor(rnd() * 0xffffffff).toString(16).padStart(8, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${(CHOIR === 'senior' ? '1' : '2')}${h.slice(1, 3)}-${(h + h).slice(4, 16)}`;
};
const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const qj = v => v === null ? 'null' : q(JSON.stringify(v)) + '::jsonb';
const out = [];
const ins = (table, rows) => {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 200) {
    out.push(`insert into ${table} (${cols.join(', ')}) values\n` + rows.slice(i, i + 200).map(r =>
      '(' + cols.map(c => (c === 'lyrics' || c === 'part_audio' || c === 'metadata' || c === 'raw_app_meta_data') ? qj(r[c]) : q(r[c])).join(', ') + ')').join(',\n') + ';');
  }
};

// ---------- the director's login (password: choir-test-pass) ----------
const DIRECTOR = senior ? '84c114fc-0000-4000-a000-000000000001' : 'c5d8f1cf-0000-4000-a000-000000000001';
out.push(`insert into auth.users (id, email, encrypted_password) values (${q(DIRECTOR)}, 'director@example.test', 'plain:choir-test-pass');`);

// ---------- singers ----------
const FEM = ['Анна','Мария','Елена','Ольга','Наталья','Ирина','Светлана','Татьяна','Юлия','Екатерина','Дарья','Анастасия','Виктория','Алина','Валентина','Людмила','Надежда','Вера','Любовь','Галина','Кристина','Ксения','Полина','София','Лидия','Марина','Евгения'];
const MAS = ['Александр','Сергей','Андрей','Дмитрий','Алексей','Николай','Михаил','Иван','Павел','Виктор','Владимир','Пётр','Василий','Евгений','Роман','Олег','Юрий','Тимофей','Даниил','Илья','Артём','Максим','Степан','Григорий','Семён'];
const SUR = ['Петров','Иванов','Сидоров','Кузнецов','Попов','Васильев','Соколов','Михайлов','Новиков','Фёдоров','Морозов','Волков','Алексеев','Лебедев','Семёнов','Егоров','Павлов','Козлов','Степанов','Николаев','Орлов','Андреев','Макаров','Никитин','Захаров','Зайцев','Соловьёв','Борисов','Яковлев','Григорьев','Романов','Воробьёв','Сергеев','Кравченко','Ткаченко','Шевченко','Бондаренко','Коваленко','Мельник','Савчук','Ковальчук','Гончарук'];
const fem = s => /(ов|ев|ёв|ин)$/.test(s) ? s + 'а' : s;
const nSingers = senior ? 37 : 62;
const PARTS = senior ? ['soprano','soprano','alto','alto','tenor','bass','bass'] : ['soprano','alto','tenor','bass','bass'];
const used = new Set(), singers = [];
const seats = { soprano: [], alto: [], tenor: [], bass: [] };
for (let i = 0; i < nSingers; i++) {
  const part = i < nSingers - 4 ? PARTS[i % PARTS.length] : (i % 2 ? null : 'bass');
  const female = part === 'soprano' || part === 'alto' || (part === null && i % 4 === 0);
  let name;
  do { const s = pick(SUR); name = (female ? fem(s) : s) + ' ' + pick(female ? FEM : MAS); } while (used.has(name));
  used.add(name);
  const joined = senior ? (chance(.6) ? '2026-06-01' : `2026-0${6 + Math.floor(rnd() * 4)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`)
                        : `${2006 + Math.floor(rnd() * 20)}-0${1 + Math.floor(rnd() * 9)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`;
  const s = { id: uuid(), name, part, sort_order: (i + 1) * (senior ? 10 : 2), active: i < nSingers - 2, is_pianist: false, is_conductor: false,
              seat_block: null, seat_row: null, seat_col: null, joined_on: joined, photo_path: null, service_start: null };
  if (part && s.active && chance(.93) && seats[part].length < 20) {
    const taken = seats[part];
    let r, c; do { r = 1 + Math.floor(rnd() * 2); c = 1 + Math.floor(rnd() * 12); } while (taken.includes(r + ':' + c));
    taken.push(r + ':' + c); s.seat_block = part; s.seat_row = r; s.seat_col = c;
  }
  singers.push(s);
}
singers[3].is_conductor = true; singers[10].is_conductor = true;
singers[5].is_pianist = true; singers[14].is_pianist = true; singers[nSingers - 3].is_pianist = true;
singers[7].service_start = senior ? '2026-09-01' : '2025-09-01';
singers[12].service_start = senior ? '2026-10-01' : '2026-03-01';
const active = singers.filter(s => s.active && s.part);

// a few member photos (small JPEGs made locally)
fs.mkdirSync(path.join(STORE, 'photos'), { recursive: true });
const photoObjects = [];
for (const s of singers.slice(0, senior ? 3 : 5)) {
  s.photo_path = s.id + '/p1.jpg';
  const f = path.join(STORE, 'photos', s.photo_path);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const hue = Math.floor(rnd() * 360);
  execFileSync('convert', ['-size', '240x240', `gradient:hsl(${hue},45%,62%)-hsl(${(hue + 40) % 360},40%,38%)`, '-quality', '70', f]);
  photoObjects.push({ bucket_id: 'photos', name: s.photo_path, metadata: { size: fs.statSync(f).size, mimetype: 'image/jpeg' } });
}
ins('public.singers', singers);

// ---------- song categories ----------
const CATS = ['Вербное воскресенье','Жатва','Молитвенные','Небо','Новый Год','Пасха','Призывные','Прославление','Рождество','Сводный','Страдания','Христианская жизнь'];
const cats = (senior ? CATS.slice(4, 8) : CATS).map(name => ({ id: uuid(), name }));
ins('public.song_categories', cats);

// ---------- songs ----------
const A = ['Слава','Хвала','Песнь','Гимн','Молитва','Свет','Сила','Радость','Тайна','Чудо','Голос','Путь','Дар','Мир','Утро','Весть','Огонь','Слово','Тихий час','Зов'];
const B = ['Христа','небес','благодати','любви','спасения','Голгофы','Вифлеема','надежды','веры','Отца','Сиона','креста','победы','Духа','Воскресения','прощения','рассвета','странника'];
const SOLO = ['Господь — Пастырь мой','Тихая ночь над землёй','Аллилуйя','Ты со мной','Близ Тебя','Вечная скала','Святой, Святой, Святой','Иду домой','Благословен грядущий','Он жив','Небесный Иерусалим','Не бойся, малое стадо'];
const LINES = ['Тебе поём мы песнь хвалы,','В Твоих руках моя судьба,','Ведёшь меня Ты сквозь года,','И свет Твой в сердце не угас.','Когда темно и путь далёк,','Ты рядом, Господи, всегда.','Хвала Тебе, Творец земли,','Твоя любовь сильней, чем страх.','Мы славим имя Твоё,','Как утро новое встаёт,','Так милость Божья к нам течёт.','Пусть вся земля поёт Тебе,','Звучит над миром благовест,','И радость в доме у меня.','Ты дал нам жизнь и дал покой,','Веди нас, Боже, за Собой.','Над нами небо голубое,','И в каждом дне — Твоя рука.','Мы ждём Тебя, Господь, придёшь,','И слёзы горя Ты утрёшь.'];
const titles = new Set(SOLO);
const nSongs = senior ? 251 : 172;
while (titles.size < nSongs) titles.add(pick(A) + ' ' + pick(B) + (chance(.12) ? ' (' + pick(['сводный','дуэт','детский хор','оркестр']) + ')' : ''));
const songs = [...titles].map((title, i) => {
  const id = uuid();
  const s = { id, title, subtitle: chance(senior ? .2 : .4) ? pick(['сл. и муз. неизв.','муз. Д. Бортнянского','обр. для хора','перевод с англ.','муз. И. Проханова']) : null,
    active: chance(.9), pdf_path: null, piano_path: null, pdf_locked: false, piano_locked: false,
    category_id: chance(.85) ? pick(cats).id : null,
    audio_url: chance(senior ? .3 : .72) ? 'https://www.youtube.com/watch?v=' + id.slice(0, 11).replace(/-/g, 'x') : null,
    pv_number: senior && chance(.4) ? 1 + Math.floor(rnd() * 800) : null,
    lyrics: null, learning: false, learn_for: null, learn_note: null, learn_order: null, part_audio: {} };
  if (chance(senior ? .3 : .65)) {
    const blocks = [];
    const n = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < n; b++) blocks.push({ t: b === 1 && chance(.6) ? 'c' : 'v', x: [0, 1, 2, 3].map(() => pick(LINES)).join('\n') });
    s.lyrics = blocks;
  }
  return s;
});
songs[0].title = 'Песнь «Хвала» & гимн <Тест>';   // characters that must stay text, never markup

// a handful of real files in storage: sheet PDFs (some locked), piano scores, part recordings
// a two-page made-up score (staves, bar lines, note heads) so the sheet viewer has something to draw
const PDF = (() => {
  const page = n => {
    const ops = ['BT /F1 18 Tf 60 790 Td (Sample score - page ' + n + ') Tj ET', '0.6 w'];
    for (let sys = 0; sys < 7; sys++) {
      const top = 740 - sys * 100;
      for (let l = 0; l < 5; l++) ops.push(`50 ${top - l * 8} m 545 ${top - l * 8} l S`);
      for (let x = 50; x <= 545; x += 123.75) ops.push(`${x.toFixed(1)} ${top} m ${x.toFixed(1)} ${top - 32} l S`);
      for (let k = 0; k < 14; k++) {
        const x = 70 + k * 34, y = top - 32 + ((k * 7 + sys * 3 + n) % 9) * 4;
        ops.push(`${x} ${y} m ${x + 4} ${y + 3} ${x + 9} ${y + 3} ${x + 9} ${y} c ${x + 9} ${y - 3} ${x + 4} ${y - 3} ${x} ${y} c f`);
        ops.push(`${x + 8.5} ${y} m ${x + 8.5} ${y + 24} l S`);
      }
    }
    return ops.join('\n');
  };
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R 5 0 R]/Count 2>>',
    '<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 7 0 R>>>>>>', null,
    '<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Contents 6 0 R/Resources<</Font<</F1 7 0 R>>>>>>', null,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  [1, 2].forEach((n, i) => { const c = page(n); objs[3 + i * 2] = `<</Length ${Buffer.byteLength(c)}>>stream\n${c}\nendstream`; });
  let out = '%PDF-1.4\n'; const at = [];
  objs.forEach((o, i) => { at.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj${o}endobj\n`; });
  const x = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map(a => String(a).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
})();
const objects = photoObjects;
const putFile = (bucket, name, buf, mime) => {
  const f = path.join(STORE, bucket, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  objects.push({ bucket_id: bucket, name, metadata: { size: buf.length, mimetype: mime } });
};
const withPdf = senior ? 3 : 24;
songs.slice(0, withPdf).forEach((s, i) => {
  const locked = !senior && i % 9 === 4;
  s.pdf_locked = locked; s.pdf_path = (locked ? 'locked/' : '') + s.id + '/1761900000000.pdf';
  putFile('sheets', s.pdf_path, PDF, 'application/pdf');
  if (i % 4 === 1) { s.piano_path = s.id + '/1761900000001.pdf'; putFile('piano', s.piano_path, PDF, 'application/pdf'); }
});
// sheets for most other songs exist only as paths (the files are not needed to render lists)
songs.slice(withPdf).forEach(s => { if (chance(senior ? .02 : .8)) s.pdf_path = s.id + '/1761800000000.pdf'; });

fs.mkdirSync('/tmp/harness-audio', { recursive: true });
const tone = (hz, secs) => {
  const f = `/tmp/harness-audio/${hz}-${secs}.mp3`;
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${secs}`, '-ac', '1', '-b:a', '32k', '-y', f]);
  return fs.readFileSync(f);
};
[songs[1], songs[2]].forEach((s, k) => {
  const pa = {};
  ['full', 'soprano', 'alto', 'tenor', 'bass'].slice(0, k ? 2 : 5).forEach((p, j) => {
    const buf = tone(220 + j * 55, 24), name = `${s.id}/${p}-t${j}.mp3`;
    putFile('parts', name, buf, 'audio/mpeg');
    pa[p] = { at: '2026-10-26T01:08:39.623Z', dur: 24, name: `${s.title} — ${p}.mp3`, path: name, size: buf.length };
  });
  s.part_audio = pa;
});
// one part saved in Apple Lossless (.m4a, 24-bit mono, as some recording apps export): iPhones play it,
// Chrome and Android only through the page's own decoder (5.59)
{
  const f = '/tmp/harness-audio/alac-330-12.m4a';
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12', '-ac', '1', '-c:a', 'alac', '-sample_fmt', 's32p', '-bits_per_raw_sample', '24', '-y', f]);
  const buf = fs.readFileSync(f), s = songs[3], name = `${s.id}/alto-alac.m4a`;
  putFile('parts', name, buf, 'audio/mp4');
  s.part_audio = { alto: { at: '2026-10-26T01:08:39.623Z', dur: 12, name: `${s.title} — alto.m4a`, path: name, size: buf.length } };
}

// the songs the choir is learning
const LEARN_FOR = senior ? ['Рождество 2026'] : ['Congress March 2027', 'Рождество 2026'];
songs.filter(s => s.active).slice(5, 12).forEach((s, i) => {
  s.learning = true; s.learn_for = LEARN_FOR[i % LEARN_FOR.length]; s.learn_order = i < 5 ? i + 1 : null;
  if (i === 2) s.learn_note = 'Тенора — второй куплет без сопровождения';
});
ins('public.songs', songs);
objects.forEach(o => out.push(`insert into storage.objects (bucket_id, name, metadata) values (${q(o.bucket_id)}, ${q(o.name)}, ${qj(o.metadata)});`));

// ---------- events ----------
const NOW = '2026-11-01';
const day = d => new Date(d + 'T12:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const LBL = senior ? { morning: 'Ут', evening: 'Вч', rehearsal: 'Сп', other: 'S' } : { morning: 'M', evening: 'E', rehearsal: 'R', other: 'S' };
const events = [];
const seen = new Set();
const addEvent = (date, kind, extra = {}) => {
  const key = date + kind + (extra.name || '');
  if (seen.has(key)) return null;
  seen.add(key);
  const e = Object.assign({ id: uuid(), date, kind, label: LBL[kind], name: null, cancelled: false, attendance_taken: false }, extra);
  if (senior) e.demo = e.demo || false;
  events.push(e); return e;
};
const start = senior ? day('2026-06-14') : day('2017-01-29');
const end = senior ? day('2026-11-10') : day('2026-12-31');
for (let d = start; d <= end; d = addDays(d, 1)) {
  const wd = d.getUTCDay(), ds = iso(d);
  const past = ds <= NOW;
  if (!senior && ds > '2026-11-20' && ds !== '2026-12-25' && ds !== '2026-12-31') continue;
  if (wd === 0) {
    if (senior ? chance(.55) : chance(past ? .42 : 1)) addEvent(ds, 'morning');
    if (senior ? chance(.35) : chance(past ? .52 : 1)) addEvent(ds, 'evening');
  }
  if ((wd === 3 || wd === 4) && (senior ? chance(.4) : chance(.085))) addEvent(ds, 'rehearsal');
}
if (!senior) {
  [['2019-10-06', 'Жатва'], ['2023-05-21', 'Wilkes-Barre'], ['2024-12-25', 'Рождество'], ['2025-04-20', 'Пасха, утро (оркестр)'], ['2025-08-10', 'Columbus, OH'], ['2026-12-25', 'Рождество']]
    .forEach(([d, name]) => addEvent(d, 'other', { name, label: 'S' }));
} else {
  ['2026-07-08', '2026-07-12', '2026-07-15', '2026-07-19'].forEach(d => { const e = events.find(x => x.date === d) || addEvent(d, d.endsWith('08') || d.endsWith('15') ? 'rehearsal' : 'morning'); if (e) e.demo = true; });
}
events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
events.filter(e => e.date <= NOW).forEach((e, i, arr) => { if (i > arr.length - (senior ? 18 : 90)) e.attendance_taken = true; });
const pastEvents = events.filter(e => e.date <= NOW);
[0.31, 0.47, 0.63, 0.78].forEach(p => { if (!senior) pastEvents[Math.floor(p * pastEvents.length)].cancelled = true; });
if (!senior) pastEvents[pastEvents.length - 6].cancelled = true;
ins('public.events', events);

// ---------- absences: only the exceptions are stored ----------
const absences = [];
pastEvents.forEach(e => {
  if (e.cancelled) return;
  const n = Math.floor(rnd() * (senior ? 6 : 6.4));
  const chosen = new Set();
  for (let k = 0; k < n; k++) chosen.add(pick(active).id);
  chosen.forEach(sid => absences.push({ event_id: e.id, singer_id: sid, status: chance(.22) ? 'not_listed' : 'absent' }));
});
ins('public.absences', absences);

// ---------- song orders ----------
const services = events.filter(e => e.kind !== 'rehearsal' && !e.cancelled && (senior ? true : chance(e.date > '2021-01-01' ? .9 : .7)));
const es = [];
const conductors = singers.filter(s => s.is_conductor), pianists = singers.filter(s => s.is_pianist);
const pool = songs.filter(s => s.active);
services.forEach(e => {
  const n = senior ? 3 : 2 + Math.floor(rnd() * 5);
  const chosen = new Set();
  while (chosen.size < n) chosen.add(pick(pool).id);
  [...chosen].forEach((sid, i) => es.push({ event_id: e.id, song_id: sid, position: i + 1,
    conductor_id: chance(.25) ? pick(conductors).id : null, pianist_id: chance(.22) ? pick(pianists).id : null }));
});
ins('public.event_songs', es);

// ---------- choir rules ----------
const RU = `# Правила хора\n\n- Приходите на спевку за 10 минут до начала, чтобы спокойно распеться.\n- Если не можете прийти, предупредите регента заранее.\n- Ноты держите в папке и приносите на каждую спевку.\n\n## На служении\n\n- Садитесь на своё место по схеме рассадки.\n- Во время проповеди телефоны убраны.\n- Одежда — тёмный низ, светлый верх.\n\n## Новые участники\n\nПервые два месяца — испытательный срок: посещаете спевки и учите репертуар вместе со всеми.`;
const EN = `# Choir rules\n\n- Arrive 10 minutes before rehearsal so there is time to warm up.\n- If you can't come, let the director know ahead of time.\n- Keep your music in your folder and bring it to every rehearsal.\n\n## At services\n\n- Sit in your place on the seating chart.\n- Phones stay away during the sermon.\n- Dress: dark below, light on top.\n\n## New members\n\nThe first two months are a trial period: come to rehearsals and learn the repertoire with everyone.`;
out.push(`insert into public.documents (key, body_ru, body_en, updated_at) values ('rules', ${q(RU)}, ${q(EN)}, '2026-09-14T18:00:00Z');`);

// ---------- anonymous usage counts ----------
const usage = [];
const DEV = ['iphone', 'iphone', 'iphone', 'android', 'android', 'ipad', 'mac', 'windows'];
const pages = ['home', 'songs', 'sheets', 'attendance', 'member', 'leaders', 'services', 'learning', 'lyrics'];
for (let i = 0; i < (senior ? 60 : 320); i++) {
  const ago = Math.floor(rnd() * 80) * 86400000 + Math.floor(rnd() * 86400000);
  const at = new Date(Date.parse(NOW + 'T22:00:00Z') - ago).toISOString();
  const kind = pick(['page', 'page', 'page', 'order', 'sheet', 'audio']);
  const ref = kind === 'page' ? pick(pages) : kind === 'order' ? pick(services).id.slice(0, 8) : pick(songs).id;
  usage.push({ at, kind, ref, lang: chance(.6) ? 'ru' : 'en', vid: 'v' + Math.floor(rnd() * 40), device: pick(DEV), app: chance(.3) });
}
ins('public.usage_log', usage);

process.stdout.write(`-- generated by seed.mjs ${CHOIR}\nbegin;\n${out.join('\n')}\ncommit;\n`);
