# BSEBC Youth Choir

Attendance, song history and sheet music for the church youth choir. A static site:
plain HTML, CSS and JavaScript in one `index.html`, no framework and no build
step, served by GitHub Pages from `main`. Interface in English and Russian;
singer names and song titles always stay in Russian.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. `VERSION` and the release notes (`NOTES`) are near the top of the script. |
| `sw.js` | Offline support: caches the app, the data it last read and opened sheets. |
| `vendor/` | The Supabase client library, served from this site so the app opens offline. |
| `404.html` | Page for unknown addresses. |
| `favicon.svg`, `apple-touch-icon.png`, `icon-*.png`, `site.webmanifest` | Icons and home-screen settings. |
| `supabase/migrations/` | Database changes, in the order they were applied. |
| `tests/` | Local test harness: database rules, every core function in a browser, accessibility, screenshots. See `tests/README.md`. |

## Database

Data lives in Supabase. The page carries the project URL and the **anon** key,
which are meant to be public; never publish the `service_role` key. Because the
page writes to the tables directly, row-level security is the only protection:
everyone may read, and only the director's account (listed in
`choir_private.directors`) may change anything.

Apply a new file from `supabase/migrations/` in the Supabase SQL editor, after
backing up the data. Each file explains itself at the top.

## Two choirs, one design

The senior choir (choir.bsebc.com) and the youth choir (youthchoir.bsebc.com)
run the same code. Only a few lines differ: names, the Supabase project, the
browser storage keys, the logo and the service-worker cache names. After a
change, copy it to the other repository and run `node tests/sync_check.mjs
<senior repo> <youth repo>`; it reports anything else that differs.

## Publishing

Upload the changed files to `main`. GitHub Pages caches pages for about 10
minutes, and the service worker keeps the previous version until the next
visit, so open pages carry on working while the new version arrives.

The keep-alive job is described in `KEEPALIVE.md`.
