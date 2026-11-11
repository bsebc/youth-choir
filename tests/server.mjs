// Local stand-in for a choir's Supabase project, for testing without touching
// the live one. Serves:
//   /rest/v1/*      a PostgREST-compatible subset over a real local Postgres; every
//                   request runs as anon / authenticated / service_role with the
//                   caller's JWT claims, so row-level security decides, as live
//   /auth/v1/*      password sign-in, refresh, user, logout, settings, sign-up
//   /storage/v1/*   upload, remove, move, signed URLs, public files (with Range),
//                   each checked against the storage.objects policies in Postgres
//   /__test/*       hooks: run SQL, change auth settings, mint tokens
//   everything else the site's files; index.html is pointed at this server
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8790);
const SITE = path.resolve(process.env.SITE || path.join(HERE, '..'));
const STORE = path.resolve(process.env.STORE || '/tmp/harness-storage/' + (process.env.PGDB || 'choir'));
const DB = process.env.PGDB || 'choir';
const SECRET = 'local-harness-secret';
const SERVICE = 'service-key';
const BASE = 'http://127.0.0.1:' + PORT;

for (const oid of [1082, 1083, 1114, 1184]) pg.types.setTypeParser(oid, v => v);   // dates stay strings, as PostgREST prints them
const pool = new pg.Pool({ host: '127.0.0.1', port: +(process.env.PGPORT || 54329), user: 'postgres', database: DB, max: 10 });

// ---------- tokens ----------
const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), body = b64u(JSON.stringify(payload));
  return head + '.' + body + '.' + crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
}
function decode(tok) {
  try { const [h, b] = tok.split('.'); return { head: JSON.parse(Buffer.from(h, 'base64url')), body: JSON.parse(Buffer.from(b, 'base64url')) }; } catch (_) { return null; }
}
function verify(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  const want = crypto.createHmac('sha256', SECRET).update(parts[0] + '.' + parts[1]).digest('base64url');
  if (want.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(parts[2]))) return null;
  return decode(tok).body;
}
// The two live anon keys are public; the harness accepts them as "anon".
const isAnonKey = k => { const d = decode(k || ''); return !!(d && d.body && d.body.role === 'anon' && d.body.iss === 'supabase'); };
function who(req) {
  const key = req.headers.apikey || '';
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (key === SERVICE || bearer === SERVICE) return { role: 'service_role', claims: { role: 'service_role' } };
  if (!isAnonKey(key) && key !== 'anon-key') return { error: { status: 401, body: { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' } } };
  if (!bearer || bearer === key || isAnonKey(bearer)) return { role: 'anon', claims: { role: 'anon' } };
  const c = verify(bearer);
  if (!c) return { error: { status: 401, body: { code: 'PGRST301', message: 'JWT could not be decoded' } } };
  if (c.exp && c.exp * 1000 < Date.now()) return { error: { status: 401, body: { code: 'PGRST303', message: 'JWT expired' } } };
  return { role: c.role === 'authenticated' ? 'authenticated' : 'anon', claims: c };
}
async function asRole(w, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${w.role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true), set_config('search_path', 'public', true)`, [JSON.stringify(w.claims)]);
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { try { await client.query('rollback'); } catch (_) {} throw e; }
  finally { client.release(); }
}

// ---------- PostgREST subset ----------
const qi = s => '"' + String(s).replace(/"/g, '""') + '"';
function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
const unq = v => (v.startsWith('"') && v.endsWith('"')) ? v.slice(1, -1).replace(/\\"/g, '"') : v;
function filterSql(alias, col, expr, vals) {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf('.');
  const op = expr.slice(0, i), v = expr.slice(i + 1);
  const c = alias + '.' + qi(col);
  const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  let sql;
  if (ops[op]) { vals.push(unq(v)); sql = `${c}::text ${ops[op]} $${vals.length}::text`;
    if (op !== 'eq' && op !== 'neq') sql = `${c} ${ops[op]} $${vals.length}`; }
  else if (op === 'like' || op === 'ilike') { vals.push(unq(v).replace(/\*/g, '%')); sql = `${c}::text ${op} $${vals.length}`; }
  else if (op === 'is') sql = `${c} is ${({ null: 'null', true: 'true', false: 'false', unknown: 'unknown' })[v.toLowerCase()]}`;
  else if (op === 'in') { vals.push(splitTop(v.replace(/^\(|\)$/g, '')).map(unq)); sql = `${c}::text = any($${vals.length}::text[])`; }
  else throw Object.assign(new Error('unsupported operator ' + op), { status: 400, code: 'PGRST100' });
  return neg ? `not (${sql})` : sql;
}
function whereSql(alias, params, vals) {
  const parts = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or' || k === 'and') {
      const items = splitTop(v.replace(/^\(|\)$/g, '')).map(it => { const d = it.indexOf('.'); return filterSql(alias, it.slice(0, d), it.slice(d + 1), vals); });
      parts.push('(' + items.join(k === 'or' ? ' or ' : ' and ') + ')');
      continue;
    }
    parts.push(filterSql(alias, k, v, vals));
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
function selectSql(alias, sel) {
  return splitTop(sel || '*').map(it => {
    if (it === '*') return alias + '.*';
    const [a, c] = it.includes(':') ? it.split(':') : [null, it];
    return `${alias}.${qi(c)}` + (a ? ' as ' + qi(a) : '');
  }).join(', ');
}
function orderSql(alias, o) {
  if (!o) return '';
  return ' order by ' + o.split(',').map(p => {
    const [c, dir, nulls] = p.split('.');
    return `${alias}.${qi(c)} ${dir === 'desc' ? 'desc' : 'asc'}` + (nulls ? (nulls === 'nullsfirst' ? ' nulls first' : ' nulls last') : '');
  }).join(', ');
}
async function pkCols(client, table) {
  const r = await client.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ('public.' || $1)::regclass and i.indisprimary`, [qi(table)]);
  return r.rows.map(x => x.attname);
}
const jsonish = v => v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
function pgError(e, role) {
  const map = { '42501': role === 'anon' ? 401 : 403, '23505': 409, '23503': 409, '23502': 400, '23514': 400, '22P02': 400, '42P01': 404, '42703': 400, PGRST116: 406 };
  return { status: e.status || map[e.code] || 400, body: { code: e.code || 'PGRST000', details: e.detail || null, hint: e.hint || null, message: e.message } };
}
async function rest(req, url, raw) {
  const w = who(req);
  if (w.error) return w.error;
  const prefer = req.headers.prefer || '';
  const wantsObject = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  const table = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\/?/, ''));
  if (table.startsWith('rpc/') && req.method === 'POST') return rpc(w, table.slice(4), raw);
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) return { status: 404, body: { code: '42P01', message: 'relation does not exist' } };
  const params = [...url.searchParams.entries()], P = Object.fromEntries(params);
  const T = 'public.' + qi(table), vals = [];
  const repr = /return=representation/.test(prefer) || wantsObject;
  try {
    const rows = await asRole(w, async client => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        let sql = `select ${selectSql('t', P.select)} from ${T} t${whereSql('t', params, vals)}${orderSql('t', P.order)}`;
        if (P.limit) sql += ' limit ' + (+P.limit);
        if (P.offset) sql += ' offset ' + (+P.offset);
        return (await client.query(`select coalesce(json_agg(x), '[]'::json) as j from (${sql}) x`, vals)).rows[0].j;
      }
      if (req.method === 'PATCH') {
        const body = JSON.parse(raw || '{}');
        const sets = Object.keys(body).map(k => { vals.push(jsonish(body[k])); return `${qi(k)} = $${vals.length}`; });
        if (!repr) { await client.query(`update ${T} t set ${sets.join(', ')}${whereSql('t', params, vals)}`, vals); return []; }
        const r = await client.query(`with u as (update ${T} t set ${sets.join(', ')}${whereSql('t', params, vals)} returning t.*) select coalesce(json_agg(x), '[]'::json) as j from (select ${selectSql('u', P.select)} from u) x`, vals);
        return r.rows[0].j;
      }
      if (req.method === 'DELETE') {
        if (!repr) { await client.query(`delete from ${T} t${whereSql('t', params, vals)}`, vals); return []; }
        const r = await client.query(`with d as (delete from ${T} t${whereSql('t', params, vals)} returning t.*) select coalesce(json_agg(x), '[]'::json) as j from (select ${selectSql('d', P.select)} from d) x`, vals);
        return r.rows[0].j;
      }
      if (req.method === 'POST') {
        let body = JSON.parse(raw || '{}');
        if (!Array.isArray(body)) body = [body];
        const upsert = /resolution=merge-duplicates/.test(prefer), ignore = /resolution=ignore-duplicates/.test(prefer);
        const conflict = P.on_conflict ? P.on_conflict.split(',') : await pkCols(client, table);
        const out = [];
        for (const row of body) {
          const cols = Object.keys(row), v = cols.map(c => jsonish(row[c]));
          let sql = `insert into ${T} (${cols.map(qi).join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`;
          if (upsert) sql += ` on conflict (${conflict.map(qi).join(', ')}) do update set ${cols.map(c => `${qi(c)} = excluded.${qi(c)}`).join(', ')}`;
          else if (ignore) sql += ' on conflict do nothing';
          // PostgREST only reads the new row back when asked to (return=representation);
          // reading it back needs a SELECT policy, which the usage log deliberately lacks.
          if (!repr) { await client.query(sql, v); continue; }
          const r = await client.query(`with i as (${sql} returning *) select row_to_json(i) as j from i`, v);
          r.rows.forEach(x => out.push(x.j));
        }
        if (P.select && P.select !== '*') { const keep = splitTop(P.select); return out.map(o => Object.fromEntries(keep.map(k => [k, o[k]]))); }
        return out;
      }
      throw Object.assign(new Error('method not allowed'), { status: 405 });
    });
    if (wantsObject) {
      if (rows.length !== 1) return { status: 406, body: { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' } };
      return { status: req.method === 'POST' ? 201 : 200, body: rows[0] };
    }
    if (req.method !== 'GET' && !/return=representation/.test(prefer)) return { status: req.method === 'POST' ? 201 : 204, body: null };
    return { status: req.method === 'POST' ? 201 : 200, body: rows, headers: { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/*` } };
  } catch (e) { return pgError(e, w.role); }
}

// POST /rest/v1/rpc/<fn>: named arguments from the JSON body, typed from the
// function's own signature (json/jsonb as JSON text, arrays as arrays).
const fnArgs = new Map();
async function rpc(w, fn, raw) {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return { status: 404, body: { code: 'PGRST202', message: 'no such function' } };
  if (!fnArgs.has(fn)) {
    const r = await pool.query(`select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
    if (!r.rows.length) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache`, details: null, hint: null } };
    fnArgs.set(fn, Object.fromEntries(r.rows[0].names.map((n, i) => [n, r.rows[0].types[i]])));
  }
  const types = fnArgs.get(fn), args = raw ? JSON.parse(raw) : {}, names = Object.keys(args);
  const vals = names.map(n => /json/.test(types[n] || '') ? JSON.stringify(args[n]) : args[n]);
  try {
    const r = await asRole(w, c => c.query(`select to_json(public.${qi(fn)}(${names.map((n, i) => `${qi(n)} => $${i + 1}`).join(', ')})) as r`, vals));
    return { status: 200, body: JSON.stringify(r.rows[0].r) };   // a JSON value, quoted like PostgREST's
  } catch (e) { return pgError(e, w.role); }
}

// ---------- auth ----------
const auth = { signups: false, ttl: 3600 };
const refreshTokens = new Map();   // refresh token -> user id
async function userById(id) { return (await pool.query('select * from auth.users where id = $1', [id])).rows[0]; }
function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at,
           app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data, created_at: u.created_at, updated_at: u.created_at, is_anonymous: false };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000), exp = now + auth.ttl;
  const access_token = sign({ aud: 'authenticated', exp, iat: now, sub: u.id, email: u.email, role: 'authenticated', session_id: crypto.randomUUID(), aal: 'aal1' });
  const refresh_token = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh_token, u.id);
  return { access_token, token_type: 'bearer', expires_in: auth.ttl, expires_at: exp, refresh_token, user: userJson(u) };
}
const authErr = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg, message: msg, error: code, error_description: msg } });
async function authRoute(req, url, raw) {
  const route = url.pathname.replace(/^\/auth\/v1\//, '');
  if (route === 'settings') return { status: 200, body: { external: { email: true, anonymous_users: false }, disable_signup: !auth.signups, mailer_autoconfirm: true } };
  const key = req.headers.apikey || '';
  if (!isAnonKey(key) && key !== 'anon-key' && key !== SERVICE) return { status: 401, body: { message: 'Invalid API key' } };
  const body = raw ? JSON.parse(raw) : {};
  if (route === 'token' && url.searchParams.get('grant_type') === 'password') {
    const u = (await pool.query('select * from auth.users where lower(email) = lower($1)', [body.email || ''])).rows[0];
    if (!u || u.encrypted_password !== 'plain:' + body.password) return authErr(400, 'invalid_credentials', 'Invalid login credentials');
    await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
    return { status: 200, body: session(u) };
  }
  if (route === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const id = refreshTokens.get(body.refresh_token);
    if (!id) return authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    refreshTokens.delete(body.refresh_token);
    return { status: 200, body: session(await userById(id)) };
  }
  if (route === 'signup') {
    if (!auth.signups) return authErr(422, 'signup_disabled', 'Signups not allowed for this instance');
    const id = crypto.randomUUID();
    await pool.query('insert into auth.users (id, email, encrypted_password) values ($1, $2, $3)', [id, body.email, 'plain:' + body.password]);
    return { status: 200, body: session(await userById(id)) };
  }
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const c = verify(bearer);
  if (route === 'user') {
    if (!c || (c.exp && c.exp * 1000 < Date.now())) return authErr(403, 'bad_jwt', 'invalid JWT');
    const u = await userById(c.sub);
    return u ? { status: 200, body: userJson(u) } : authErr(403, 'user_not_found', 'User from sub claim in JWT does not exist');
  }
  if (route === 'logout') return { status: 204, body: null };
  return { status: 404, body: { message: 'not found' } };
}

// ---------- storage ----------
function parseMultipart(buf, type) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  let pos = buf.indexOf(boundary), file = null;
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString('utf8');
      if (/filename=/i.test(head)) {
        const ct = /content-type:\s*([^\r\n]+)/i.exec(head);
        file = { data: part.subarray(sep + 4), type: ct ? ct[1].trim() : 'application/octet-stream' };
      }
    }
    pos = next;
  }
  return file;
}
const objPath = (bucket, name) => {
  const f = path.join(STORE, bucket, name);
  if (!f.startsWith(path.join(STORE, bucket) + path.sep)) throw Object.assign(new Error('bad path'), { status: 400 });
  return f;
};
const sErr = (status, error, message) => ({ status, body: { statusCode: String(status), error, message } });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain', '.wasm': 'application/wasm' };
function sendFile(req, res, file, extraHeaders = {}) {
  const st = fs.statSync(file), type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const h = Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, extraHeaders);
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, Object.assign(h, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(h, { 'Content-Length': st.size }));
  fs.createReadStream(file).pipe(res);
}
async function storageRoute(req, res, url, raw) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''));
  // public files: no policy check beyond the bucket being public, as live
  let m = /^object\/public\/([^/]+)\/(.+)$/.exec(p);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const b = (await pool.query('select public from storage.buckets where id = $1', [m[1]])).rows[0];
    const f = objPath(m[1], m[2]);
    if (!b || !b.public || !fs.existsSync(f)) return sErr(400, 'not_found', 'Object not found');
    sendFile(req, res, f); return null;
  }
  m = /^object\/sign\/([^/]+)\/(.+)$/.exec(p);
  if (m && req.method === 'GET') {
    const c = verify(url.searchParams.get('token'));
    if (!c || c.url !== m[1] + '/' + m[2] || c.exp * 1000 < Date.now()) return sErr(400, 'InvalidSignature', 'invalid signature');
    const f = objPath(m[1], m[2]);
    if (!fs.existsSync(f)) return sErr(400, 'not_found', 'Object not found');
    sendFile(req, res, f); return null;
  }
  const w = who(req);
  if (w.error) return w.error;
  try {
    if (m && req.method === 'POST') {          // create a signed URL: the caller must be able to SELECT the object
      const found = await asRole(w, c => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [m[1], m[2]]));
      if (!found.rowCount) return sErr(400, 'not_found', 'Object not found');
      const body = raw ? JSON.parse(raw) : {};
      const token = sign({ url: m[1] + '/' + m[2], exp: Math.floor(Date.now() / 1000) + (+body.expiresIn || 60) });
      return { status: 200, body: { signedURL: `/object/sign/${m[1]}/${m[2].split('/').map(encodeURIComponent).join('/')}?token=${token}` } };
    }
    if (p === 'object/move' && req.method === 'POST') {
      const b = JSON.parse(raw || '{}');
      const r = await asRole(w, c => c.query('update storage.objects set name = $3, updated_at = now() where bucket_id = $1 and name = $2 returning name', [b.bucketId, b.sourceKey, b.destinationKey]));
      if (!r.rowCount) return sErr(400, 'not_found', 'Object not found');
      const from = objPath(b.bucketId, b.sourceKey), to = objPath(b.bucketId, b.destinationKey);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(from)) fs.renameSync(from, to);
      return { status: 200, body: { message: 'Successfully moved' } };
    }
    m = /^object\/([^/]+)$/.exec(p);
    if (m && req.method === 'DELETE') {          // remove: only the rows the caller may delete
      const names = (JSON.parse(raw || '{}').prefixes) || [];
      const r = await asRole(w, c => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name, metadata', [m[1], names]));
      r.rows.forEach(x => { const f = objPath(m[1], x.name); if (fs.existsSync(f)) fs.unlinkSync(f); });
      return { status: 200, body: r.rows.map(x => ({ name: x.name, bucket_id: m[1], metadata: x.metadata })) };
    }
    m = /^object\/([^/]+)\/(.+)$/.exec(p);
    if (m && (req.method === 'POST' || req.method === 'PUT')) {
      const [, bucket, name] = m;
      const bk = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
      if (!bk) return sErr(400, 'Bucket not found', 'Bucket not found');
      const mp = /multipart\/form-data/i.test(req.headers['content-type'] || '') ? parseMultipart(raw, req.headers['content-type']) : null;
      const data = mp ? mp.data : raw, type = mp ? mp.type : (req.headers['content-type'] || 'application/octet-stream');
      if (bk.file_size_limit && data.length > +bk.file_size_limit) return sErr(413, 'Payload too large', 'The object exceeded the maximum allowed size');
      if (bk.allowed_mime_types && !bk.allowed_mime_types.includes(type.split(';')[0])) return sErr(415, 'invalid_mime_type', `mime type ${type} is not supported`);
      const upsert = req.method === 'PUT' || req.headers['x-upsert'] === 'true';
      const meta = { size: data.length, mimetype: type };
      let row;
      try {
        row = await asRole(w, async c => {
          const sql = upsert
            ? `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now() returning id`
            : `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id`;
          return (await c.query(sql, [bucket, name, w.claims.sub || null, meta])).rows[0];
        });
      } catch (e) {
        if (e.code === '23505') return sErr(409, 'Duplicate', 'The resource already exists');
        if (e.code === '42501') return sErr(403, 'Unauthorized', 'new row violates row-level security policy');
        throw e;
      }
      const f = objPath(bucket, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, data);
      return { status: 200, body: { Key: bucket + '/' + name, Id: row.id } };
    }
    return sErr(404, 'not_found', 'route not found');
  } catch (e) {
    if (e.code === '42501') return sErr(403, 'Unauthorized', e.message);
    return sErr(e.status || 400, 'error', e.message);
  }
}

// ---------- HTTP ----------
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };
const LIVE_URLS = /https:\/\/(qynprpimmjansluhuoez|cetjvfzgituzeiooxaex)\.supabase\.co/g;
let stallPage = 0;    // ms to sit on a request for the page (set through /__test/stall)
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const chunks = []; for await (const c of req) chunks.push(c);
  const rawBuf = Buffer.concat(chunks), raw = rawBuf.toString('utf8');
  const send = (status, body, headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, cors, headers));
    res.end(body == null ? '' : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)));
  };
  try {
    if (req.method === 'OPTIONS') return send(204, null);
    if (url.pathname.startsWith('/rest/v1')) { const r = await rest(req, url, raw); return send(r.status, r.body, r.headers); }
    if (url.pathname.startsWith('/auth/v1/')) { const r = await authRoute(req, url, raw); return send(r.status, r.body); }
    if (url.pathname.startsWith('/storage/v1/')) { const r = await storageRoute(req, res, url, rawBuf); if (r) send(r.status, r.body); return; }
    if (url.pathname.startsWith('/__test/')) {
      const what = url.pathname.slice(8);
      if (what === 'sql') { const r = await pool.query(raw); return send(200, Array.isArray(r) ? r.map(x => x.rows) : r.rows); }
      if (what === 'auth') { Object.assign(auth, JSON.parse(raw || '{}')); return send(200, auth); }
      if (what === 'token') { const b = JSON.parse(raw || '{}'); const u = await userById(b.sub); return send(200, session(u)); }
      if (what === 'stall') { stallPage = +(JSON.parse(raw || '{}').ms) || 0; return send(200, { ms: stallPage }); }   // the page itself answers this late (a server that hangs)
      return send(404, null);
    }
    if (url.pathname.startsWith('/realtime/')) return send(404, null);
    // the site
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '') || 'index.html';
    if (stallPage && p === 'index.html') await new Promise(r => setTimeout(r, stallPage));
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found', { 'Content-Type': 'text/plain' });
    if (/\.(html|js|mjs)$/.test(file)) {
      const text = fs.readFileSync(file, 'utf8').replace(LIVE_URLS, BASE);
      return send(200, text, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-store' });
    }
    return sendFile(req, res, file);
  } catch (e) {
    console.error(e);
    send(500, { error: String(e && e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('harness on', PORT, 'db', DB, 'site', SITE, 'store', STORE));
