# Keeping the youth-choir Supabase project awake

Free-tier Supabase projects pause after **7 days with no API requests**. Any real
use of the site counts, so this only matters over quiet stretches (holidays,
summer). Two independent pingers means one can fail without anyone noticing.

The anon key below is public — it is already in `index.html` and can only read.
Never put the `service_role` key in a pinger.

---

## 1 · GitHub Actions (already in the repo)

`.github/workflows/keepalive.yml`, runs daily at 12:17 UTC. Nothing to configure.

Watch for two failure modes:

- Scheduled workflows run **only on the default branch**.
- GitHub **disables schedules after 60 days with no repo activity** — it emails
  you, and the Actions tab shows an *Enable workflow* button.

---

## 2 · cron-job.org (free, no card, recommended)

1. Sign up at <https://cron-job.org> → **Create cronjob**.
2. Fill in:

   | Field    | Value                                                     |
   |----------|-----------------------------------------------------------|
   | Title    | `BSEBC Youth Supabase keepalive`                           |
   | URL      | `https://cetjvfzgituzeiooxaex.supabase.co/rest/v1/`        |
   | Schedule | Every day, 06:00 (any time that isn't on the hour is fine) |

3. Open **Advanced** → *Headers* and add two:

   ```
   apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldGp2ZnpnaXR1emVpb294YWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxODY0ODAsImV4cCI6MjEwMDc2MjQ4MH0.cMannk6niEUPPLBzJRo7Fs2VPWVp7LeNrvWD-DkBJl8
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldGp2ZnpnaXR1emVpb294YWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxODY0ODAsImV4cCI6MjEwMDc2MjQ4MH0.cMannk6niEUPPLBzJRo7Fs2VPWVp7LeNrvWD-DkBJl8
   ```

4. Leave *Treat redirects as success* off; set **Notify on failure** to your email.
5. Save, then hit **Test run** — expect **HTTP 200**.

---

## Alternative: UptimeRobot

Works too, but the free plan sends only a `GET` with no custom headers, so
`/rest/v1/` answers **401**. Point the monitor at the site instead of the API:

- Monitor type: **HTTPS**
- URL: your GitHub Pages address, e.g. `https://<user>.github.io/<repo>/`
- Interval: 5 minutes

That keeps the *site* watched but does **not** touch Supabase — it is not a
substitute for pinger 1 or 2, just a "did the site go down" alarm.

---

## Checking it worked

Supabase dashboard → your project → **Reports → API**: there should be a small
request every day. If the project ever does pause, nothing is lost — open the
dashboard and press **Restore**; it comes back in a minute or two.
