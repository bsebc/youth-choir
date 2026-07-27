# BSEBC Youth Choir

Same ledger as the senior choir (`app/`), for the youth choir — its own Supabase
project, so the two never mix. Plain HTML/CSS/JS, one file, no build step.
English/Russian toggle in the masthead; names and song titles stay in Russian.

Supabase project: `https://cetjvfzgituzeiooxaex.supabase.co`

## Files

| File               | What it is                                              |
|--------------------|---------------------------------------------------------|
| `index.html`       | The whole app. This is what gets served.                 |
| `sw.js`            | Offline support (own cache names, separate from `app/`). |
| `site.webmanifest` | Home-screen app name and icons.                          |
| `favicon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Icons. |
| `.github/workflows/keepalive.yml` | Weekly ping so the free-tier project never pauses. |

## Setting it up (once)

1. **Database** — Supabase → SQL Editor → paste `supabase/youth_setup.sql` → Run.
   That creates the tables, row-level security, the views, and the `sheets`
   storage bucket for PDFs. It adds no singers or songs.
2. **Director's login** — Supabase → Authentication → Users → *Add user*
   (email + password, "auto-confirm"). Only that account can write.
3. **Publish** — upload the contents of this folder to the repo root of a
   *separate* GitHub repository, then Settings → Pages → Deploy from a branch →
   `main` → `/ (root)`. Live at `https://<user>.github.io/<repo>/`.
4. **Keepalive** — in that repo, Settings → Secrets and variables → Actions, add
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the values at the top of `index.html`).

Do not put the two sites in the same repository folder: both register a service
worker at their own scope, and one would cache over the other.

## Adding the choir

Sign in → **Admin → Members** to add singers (soprano / alto / tenor / bass) and
**Admin → Song list** for songs. Attendance records only absences, like the paper
ledger — everyone else counts as present.

## Notes

- The anon key in `index.html` is meant to be public; never publish the
  `service_role` key.
- Until step 1 is run the pages load but stay empty — the tables don't exist yet.
