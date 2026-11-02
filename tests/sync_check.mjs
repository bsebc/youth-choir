// Are the two choir apps still in sync? They must be identical apart from the
// intended per-choir lines (names, Supabase project, storage keys, two old
// release-note lines). This maps the youth file back onto the senior one
// and reports anything else that differs.
//   node sync_check.mjs <senior repo> <youth repo>
import fs from 'node:fs';

const [S = '..', Y = '../../youth-choir'] = process.argv.slice(2);
const read = (dir, f) => fs.readFileSync(`${dir}/${f}`, 'utf8');
let bad = 0;

function compare(file, toSenior, fromSenior = x => x) {
  const s = fromSenior(read(S, file)).split('\n'), y = toSenior(read(Y, file)).split('\n');
  const n = Math.max(s.length, y.length), diffs = [];
  for (let i = 0; i < n; i++) if (s[i] !== y[i]) diffs.push(i + 1);
  if (!diffs.length) return console.log(`ok    ${file}`);
  bad++;
  console.log(`DIFF  ${file}: ${diffs.length} line(s) differ beyond the intended ones, first at line ${diffs[0]}`);
  diffs.slice(0, 5).forEach(l => console.log(`  ${l}\n   senior: ${(s[l - 1] || '').slice(0, 140)}\n   youth:  ${(y[l - 1] || '').slice(0, 140)}`));
}

const sub = (t, pairs) => pairs.reduce((a, [re, to]) => a.replace(re, to), t);
compare('index.html', t => sub(t, [
  [/BSEBC Youth Choir/g, 'BSEBC Choir'],
  [/https:\/\/youthchoir\.bsebc\.com\//g, 'https://choir.bsebc.com/'],
  [/content="Youth Choir"/, 'content="BSEBC Choir"'],
  [/'bsebc-youth-theme'/g, "'bsebc-theme-mode'"],
  [/'bsebc-youth-lang'/g, "'bsebc-lang'"],
  [/'bsebc-youth-me'/g, "'bsebc-me'"],
  [/const SUPABASE_URL = '[^']+';/, 'const SUPABASE_URL = <project>;'],
  [/const SUPABASE_ANON_KEY = '[^']+';/, 'const SUPABASE_ANON_KEY = <key>;'],
  [/appName:'Youth Choir'/, "appName:'BSEBC Choir'"],
  [/appName:'Молодёжный хор'/, "appName:'BSEBC Choir'"],
  [/homeSub:'Youth choir attendance and song ledger'/, "homeSub:'Choir attendance and song ledger'"],
  [/homeSub:'Молодёжный хор · посещаемость и песнопения'/, "homeSub:'Журнал посещаемости и песнопений'"],
  [/choir:\{ en:'Youth choir', ru:'Молодёжный хор' \}/, "choir:{ en:'Church choir', ru:'Церковный хор' }"],
  [/<div class="brand">Youth Choir<\/div>/, '<div class="brand">BSEBC Choir</div>'],
]), t => sub(t, [
  [/const SUPABASE_URL = '[^']+';/, 'const SUPABASE_URL = <project>;'],
  [/const SUPABASE_ANON_KEY = '[^']+';/, 'const SUPABASE_ANON_KEY = <key>;'],
  // two old release-note lines only the senior choir has
  [/',\n {4}'The site is now called BSEBC Choir in both languages'/, "'"],
  [/',\n {4}'Сайт теперь называется BSEBC Choir на обоих языках'/, "'"],
]));
compare('sw.js', t => t.replace(/BSEBC Youth Choir/g, 'BSEBC Choir').replace(/'bsebc-youth-/g, "'bsebc-"));
for (const f of fs.readdirSync(`${S}/supabase/migrations`).filter(f => f >= '20261102'))
  compare('supabase/migrations/' + f, t => t);
process.exit(bad ? 1 : 0);
