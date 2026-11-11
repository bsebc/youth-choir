# Core functions

What the app must keep doing, in both choirs, in English and Russian. `e2e_test.mjs`
checks each of these in a real browser against the local stack, before and after every
change (`A1`… are the ids the test output uses).

## Everyone (no sign-in)

| id  | function |
|-----|----------|
| A1  | Home loads: stat tiles, the next service with its song order, Learning, Leaderboard; no console errors |
| A2  | Language switch EN ↔ RU re-labels the interface and is remembered; names and song titles stay in Russian |
| A3  | Light / dark switch works and is remembered |
| A4  | Attendance grid: every active singer by voice part, every event in range, absences marked, two-row sticky header |
| A5  | Date range presets (3 / 6 / 12 / 36 months, all) and a custom range change what the grid and summary show |
| A6  | Attendance summary: each singer's percentage matches the stored data (absent = missed, not listed / before joining = not counted, cancelled = not counted) |
| A7  | Songs summary: search, category filter and sort |
| A8  | Songs by service: the song order of each service in range |
| A9  | Services page: upcoming and past services; a shared order link (8-character id) opens the right service |
| A10 | Choir sheets and piano scores: list, open a sheet (signed link); locked sheets are not offered to guests |
| A11 | Learning page: the songs being learned, in the director's order |
| A12 | Lyrics: a song's lyrics display; print view opens |
| A13 | Leaderboard and member report card (`#/member/<id>`) |
| A14 | Seating chart renders every seated singer in their block |
| A15 | Choir rules render from the stored document |
| A16 | Part player: plays a recording, pause, back / forward 10 s |
| A17 | Search finds a song and a singer |
| A18 | "That's me": picking yourself is remembered |
| A19 | Anonymous usage counting records page views (and never for the signed-in director) |
| A20 | Every main screen fits a 390 px phone with no sideways page scroll |
| A21 | The period: Attendance goes back to six months after a visit to History; a period the reader picks is kept on both |

## Director (signed in)

| id  | function |
|-----|----------|
| D1  | Sign in with email and password; a wrong password shows an error; sign out |
| D2  | Mark attendance for an event: absent / not listed / present, saved to the database |
| D3  | Add a new event (date and type), then mark it |
| D4  | Cancel and restore an event; delete an event |
| D5  | Song order for a service: add songs, reorder, conductor and pianist, saved |
| D6  | Songs: add, edit title / subtitle / category / number, archive and restore, delete |
| D7  | Sheet PDF: upload, lock (moves to `locked/`), unlock, remove |
| D8  | Lyrics: edit and save |
| D9  | Recordings: upload a part recording, set a full-recording link, remove |
| D10 | Members: add a singer, edit name / part / dates, deactivate and reactivate, delete; pianist and conductor roles |
| D11 | Member photo: upload and remove |
| D12 | Seating chart: move a singer to another chair |
| D13 | Choir rules: edit and save |
| D14 | Learning: add a learning song, reorder, move it to the repertoire |
| D15 | Usage page loads for the director only |
| D16 | CSV export downloads |
| D17 | An expired session is refreshed before a write; a write that changes nothing is reported, never shown as saved |

## Starting up (5.61)

| # | What must work |
|---|---|
| B1 | A visitor's second visit opens at once from the copy saved on the device; live data then replaces it; identical data redraws nothing |
| B1b | A saved copy the page cannot draw is thrown away, and the app starts the ordinary way |
| B2 | A signed-in device never opens from the saved copy, and neither does a link to one song order |
| B3 | A network that never answers ends in "Try again" (after one automatic second try), not an endless loading screen |
| B4 | Signing in from a screen drawn from the saved copy shows the director's pages only once live data is in |
| B5 | If the app's script cannot load, the page itself says so and offers Reload: never a blank screen |
| B6 | With the service worker, a server that does not answer for the page opens the saved copy within seconds; a file opened directly is never stored as the page |

## Security (checked by `api_test.mjs` against the database rules)

- Guests can read what the public pages show and nothing else (not the usage log, not locked sheets).
- Guests cannot write anything except one usage-log row at a time, within size limits.
- A signed-in account that is not a director cannot write anything.
- The director can do every write listed above.
- The old views accept no writes.
