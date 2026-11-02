# Local test stack

A copy of the whole app that runs on one machine, so every change can be tried
before it reaches the live site or the live database. Nothing here talks to
Supabase or GitHub.

- **Postgres 16** (port 54329), loaded with:
  - `sql/00_supabase.sql` — the parts of Supabase the app relies on: the `anon` /
    `authenticated` / `service_role` roles, `auth.uid()` and friends reading the
    request's JWT claims, `auth.users`, and the storage tables;
  - `sql/10_live_baseline.sql` — a mirror of the live public schema as it was on
    2026-11-01 *before* that day's security fixes: tables, constraints, views,
    policies, grants, storage buckets and storage policies (`-v senior=true|false`
    selects the one-column difference between the choirs);
  - sample data from `seed.mjs` — invented singers, songs, lyrics, recordings and
    nine years of attendance shaped like the real choirs (safe in a public repo);
  - with `new`, every file in `../supabase/migrations/` in order.
- **`server.mjs`** — a small stand-in for the Supabase project: a PostgREST-compatible
  REST API, password sign-in, and storage (uploads, signed links, public files with
  Range support). Every request runs as the caller's database role with their JWT
  claims, so the real row-level security policies decide what is allowed. It also
  serves the site, pointing `index.html` at itself.
- **`api_test.mjs`** — the database rules, tried the way an outsider would: as a
  guest, as someone who created an account, and as the director. Every write is
  checked in the database afterwards.
- **`e2e_test.mjs`** — the core functions in `CORE_FUNCTIONS.md`, driven in Chromium
  on a 390 px phone screen, English and Russian.
- **`shots.mjs`** — screenshots of every main screen, light and dark, EN and RU.
- **`a11y.mjs`** — axe-core accessibility scan (WCAG 2.1 A/AA) of every main screen.
- **`motion_frames.mjs`** — triggers each kind of transition (page push and back, tab,
  segment, filter, dialog, sheet, language) and saves a frozen mid-motion frame of each.
- **`seq_frames.mjs`** — one transition frame by frame: start on `HASH`, tap `CLICK` (or run
  `JS`), then step every animation through `TIMES` ms and save each frame; `THEME`, `W`/`H`,
  `SCROLL` and `PRE` set the scene. This is how the 5.49 flash was found.
- **`targets.mjs`** — phone ergonomics at 390 px: tap targets under 44 px and text
  fields under 16 px (iOS zooms the page when one is focused).
- **`sync_check.mjs`** — compares this app with the other choir's and reports any
  difference beyond the intended per-choir lines: `node sync_check.mjs .. ../../youth-choir`.

## Run

```sh
npm install                               # pg, esbuild, supabase-js (for the browser tests)
./pg.sh                                   # starts the throwaway Postgres if needed

./reset.sh choir senior new               # schema + sample data + all migrations
./start.sh 8790 choir                     # site + API on http://127.0.0.1:8790
PORT=8790 node api_test.mjs
PORT=8790 CHOIR=senior SITE=.. node e2e_test.mjs

./reset.sh choir senior                   # the same, but the rules as they were live
PORT=8790 node api_test.mjs               # before 2026-11-01: shows the holes
```

For the youth choir use `youth` and point `start.sh` (third argument) and
`MIGRATIONS=` at the youth repo. Director sign-in in the sample data:
`director@example.test` / `choir-test-pass`.

Processes started in the background stop between work sessions; the scripts
restart what they need (`start.sh` writes `/tmp/choir-<port>.pid`).
