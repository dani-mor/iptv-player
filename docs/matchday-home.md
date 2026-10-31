# Matchday Home: implementation guide

Hand-off for the next session. Goal: add a **Home** tab (startup screen) with a
**Sport Center** (upcoming / live matches and *which of the user's channels shows
them*), favourite channels, continue watching, and a **match finder** (global search
over every programme in the provider's guide).

- Visual mockup and plan (private, owned by the user): https://claude.ai/artifact/YAgqBgmCAdMEMHTspvzdeU
- Status as of 2026-10-31: plan approved by the user, decisions answered (below),
  **nothing implemented yet**.
  The previous release (modules, versions/fail-over, mini player, multiview…) is committed and
  the user reports it works smoothly.

---

## 0. Before you start

### The user's decisions (answered 2026-10-31; don't ask again)

| Question | Answer | What it means for the build |
| --- | --- | --- |
| Which sports / competitions? | **Soccer** (the 5 major leagues + European competitions), **Tennis, F1, MotoGP, NFL, NBA** | Leagues and sources in 4.1. MotoGP isn't on ESPN, so it gets its own source. |
| Their teams (ranked first)? | **Real Madrid, Spain** | Spain = the national football team. Proposed (confirm briefly when Step 4 starts): also boost Spanish athletes (tennis players, F1 drivers, MotoGP riders), see 4.3. |
| Desktop notifications / auto-switch at kick-off? | **No** | Reminders are an in-app toast with a Watch button only. No Notification API, no automatic channel switching. |
| Open the app on Home? | **Yes** | Home is the startup screen; the "last tab" memory only applies when leaving Home for another tab. |

The mockup page still shows Atlético de Madrid as "your team" and a desktop-notification
idea. **This file wins** where they differ.

### Rules for working on this project

- **Live playback is the #1 feature.** Don't touch `public/js/live-player.js` or the
  proxy in `server.js` unless a step needs it, and if you do, test live TV again afterwards.
- **Never read the saved credentials out of the browser** (`localStorage` key
  `iptv_player_creds`) with a script. The user rejected this. Test through the app UI:
  the app logs itself in. If you need raw provider data, have the *server* fetch it inside
  an endpoint the app calls, or ask the user.
- **The user's real app window shares `localStorage` with test tabs** (same origin
  `http://localhost:4040`). Never wipe `iptv_library:*`. Remove only what your test
  created (e.g. a Continue Watching entry: use the ✕ on the card).
- **Measure the provider before blaming the code.** Provider quirks seen so far: the EPG
  `start`/`end` strings are UTC; `get_short_epg` returns at most 2 listings;
  `get_simple_data_table` ≈ 10 days per channel (~600 ms); many M+ LaLiga channels have
  **no** guide data; some channels are broken at the source (e.g. "DAZN LALIGA FHD":
  audio/video out of sync).
- Code style: plain ES modules in `public/js/`, no build step, no new frontend
  dependencies. Match the surrounding comment density and naming. Pure logic goes in
  testable modules (`lib/*.js` on the server, pure files like `public/js/names.js` on
  the client) with `node:test` tests in `test/`.
- Commits: only when the user asks.

### How to run, test and restart

```bash
npm test                      # node --test, all tests in test/
npx --yes eslint@8 --no-eslintrc --env browser,es2022 \
  --parser-options=sourceType:module --parser-options=ecmaVersion:2022 \
  --rule 'no-undef: error' --rule 'no-unused-vars: warn' public/js/*.js
```

The server usually runs in the background, started by `launch.sh` (log in
`/tmp/iptv-player.log`). Frontend files are served live, so a page reload is enough for
them; **server changes need a restart**:

```bash
pkill -f "node server.js"; setsid nohup node server.js > /tmp/iptv-player.log 2>&1 < /dev/null & disown
```

It listens on loopback only (127.0.0.1 and ::1, port 4040). Restarting interrupts
whatever the user is watching, so tell them.

### Where things are (current architecture)

| File | Role |
| --- | --- |
| `server.js` | Express: `/api/login`, `/api/xtream` (provider API passthrough), `/stream` + `/proxy/media` (media proxy), `/api/artwork/*` (TVmaze/TMDB/Wikidata), `/vendor` (hls.js) |
| `lib/` | Pure server helpers: `playlist.js`, `tail.js`, `titles.js` (`normTitle` accent folding is reusable here) |
| `public/js/main.js` | Entry: login / optimistic auto-login, keyboard shortcuts, 30 s refresh tick |
| `public/js/views.js` | View stack + history (`registerView`, `pushView`, `setView`, `onViewChange`, `nav`) |
| `public/js/browse.js` | Tabs, categories, grid, search, shelf |
| `public/js/catalog.js` | Categories / streams cache, `loadAll`, `livePool()`, `versionsOf()` |
| `public/js/api.js` | `apiXtream`, `cachedApi` (IndexedDB stale-while-revalidate), `session` |
| `public/js/library.js` | Per-account `localStorage`: favs, recents, progress, episodes, hiddenCats; `onLibraryChange` |
| `public/js/epg.js` | EPG queue / cache, `nowProgram`, `watchEpg` (paints `[data-epg-id]`) |
| `public/js/theater.js` | Live player view, `openTheater(item, railItems)`, mini player, versions |
| `public/js/multiview.js` | `openMultiview(items, pool)` |
| `public/js/channels.js` | `channelRow`, `channelTitleHtml`, `favButton`, `renderBatched` |
| `public/js/names.js` | `fold`, `parseChannelName`, `versionKey` (pure, tested) |
| `public/js/movie.js`, `series.js`, `watch.js` | Detail pages and the movie/episode player |

---

## 1. Step 1: check the data (½ day)

**Why first:** everything depends on how much of the guide we can get and how well
fixtures match it. Report the numbers to the user before building UI.

1. **Is `xmltv.php` available?** Add a temporary or permanent server endpoint
   `GET /api/guide/status?server&username&password&ua` that fetches
   `{server}/xmltv.php?username=…&password=…` (send the user's UA; 60 s timeout) and returns
   only stats: HTTP status, bytes, download time, number of `<channel>` and
   `<programme>` elements, time range covered. To run it, temporarily make the app call
   it once after login (in `main.js`, with `session.creds`) and `console.log` the
   stats. Then read them with `read_console_messages`. The credentials stay inside the
   app and never pass through your context. Remove the call afterwards.
2. **Coverage:** of the live channels in sports categories (see 2.2 for the category
   heuristic), how many have an `epg_channel_id`, and how many of those have
   programmes in the next 7 days?
3. **Match rate:** take 7 days of fixtures (section 4.1) and run the matcher
   (4.2) against the guide. Report e.g. "31 of 40 fixtures found; not found: …",
   per sport (football, tennis, F1, MotoGP, NFL, NBA).
4. **Session times:** find how F1 (ESPN `competitions[]`) and MotoGP (Pulselive sessions
   endpoint) expose qualifying / sprint / race times.
5. **Best-guess table:** list the real channel names in the sports categories, so the
   competition → channel patterns in 4.2 can be corrected.

**Done when** the user has the numbers and we know the guide source (xmltv vs
per-channel fallback) and how important the "best guess" fallback is.

---

## 2. Step 2: guide index + match finder (1–2 days)

Useful on its own: "where is the Barça match on?" from the top-bar search.

### 2.1 Server: `lib/xmltv.js` (pure, tested)

- Parse XMLTV without dependencies: regex over `<programme start="…" stop="…" channel="…">…</programme>`,
  extracting `<title>` and `<desc>` (decode XML entities, CDATA, `&amp;` etc.).
- Times are `YYYYMMDDHHMMSS ±HHMM`; convert to epoch ms **using the offset** (don't
  assume local time).
- Keep only programmes overlapping [now − 6 h, now + 8 days].
- Tests: entity decoding, offsets (`+0000`, `+0100`, missing offset → UTC), a programme
  spanning midnight.

### 2.2 Server: `lib/guide-index.js`

- Build per account: key = sha256(`server|username`) (**never write passwords to disk**).
  Cache in memory + `.guide-cache/<key>.json` (add `.guide-cache/` to `.gitignore`).
  Rebuild if older than 3 h; serve stale while rebuilding; one build at a time per key.
- Channel map: from `get_live_streams` (all) → `epg_channel_id` → `{stream_id, name,
  category_id, stream_icon}`. Several streams (FHD/HD/SD versions) can share one
  `epg_channel_id`; keep all of them.
- **Sports subset** (keeps the index small): categories whose name matches
  `/deport|sport|f[uú]tbol|futbol|laliga|liga|premier|serie a|bundesliga|ligue|dazn|champions|europa|copa|f1|formula|motor|moto ?gp|tenis|tennis|nfl|nba|eurosport|m\+/i`,
  plus anything the user favourited. Make the regex a constant so it's easy to adjust.
- **Fallback when there's no `xmltv.php`:** per-channel `get_simple_data_table`
  (titles/descriptions are base64; use `start_timestamp`/`stop_timestamp`, which are
  correct epochs), 3 at a time, for the sports subset only.
- Search: fold accents (`normTitle` from `lib/titles.js`), match all query words against
  title (weight 3) and description (weight 1). Order: on now → upcoming by start time
  → recent past last. Max 50 results.

### 2.3 Server endpoints

```
GET /api/guide/search?server&username&password&ua&q=barcelona
  -> { builtAt, source: "xmltv" | "per-channel",
       results: [{ streamIds: [..], channel: "M+ Liga de Campeones 2 FHD",
                   start, end, title, desc }] }
GET /api/guide/status?server&username&password&ua
  -> { builtAt, source, channels, programmes, building: bool }
```

Follow the existing pattern: creds in the query string, like `/api/xtream`.

### 2.4 App: `public/js/finder.js`

- The top-bar search (`#search-box`): on the **Home** tab it searches globally; on the
  other tabs it keeps filtering the current list as today, with a "Search everywhere"
  item at the bottom of the results.
- Dropdown under the search box, grouped **On now / Later today / <weekday> / Channels**
  (channel-name matches come from `livePool()` + `matchesQuery`, as now).
- Keyboard: ↑/↓ moves, Enter = Watch (on now) or Remind me (later), Esc closes.
  Note `main.js` returns early for keys typed in inputs, so handle these inside
  `finder.js` on the input itself.
- Watch → `openTheater(stream, pool)` with the best version (`versionsOf(stream)[0]`).
- Debounce 200 ms; ignore queries under 2 characters.

**Tests:** `test/xmltv.test.js`, `test/guide-search.test.js`, using small fixture strings
built from real title shapes (below).

Real guide title shapes seen at this provider (use them in tests):

```
(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS
(EN DIRECTO) 31/10/2026 - DeportePlus
LALIGA HYPERMOTION T26/27 · Jornada 12: SD Eibar - UD Almería
Resúmenes LALIGA HyperMotion T26/27 · Jornada 12: Celta Fortuna - Córdoba
```

**Done when:** typing "barcelona" on Home lists the matching programmes with times and
channels, and Enter on one that's live plays it.

---

## 3. Step 3: Home tab, first version (1 day)

Only data the app already has; no new sources.

- New view `home` (`#home-view`), registered with `registerView('home', …)`. Add a
  **Home** button as the first tab in `#tabs`. Clicking it → `setView('home')`; the other
  tabs → `setView('browse')` + `switchTab(type)` as today. Keep `nav.type` for
  catalogue tabs; Home isn't a catalogue type.
- Start-up (`enterApp` in `main.js`) **always opens Home** (user decision). `lastTab()` in
  `browse.js` still remembers the last catalogue tab, for when the user leaves Home.
- Rows (reuse the existing builders: export `buildCard` / `buildContinueCard` from
  `browse.js` rather than copying them):
  1. **Favourite channels** (`library.favs`); if empty, **Recently watched**
     (`library.recents`). Live cards already show now-playing through `watchEpg`.
  2. **Continue watching · Movies** and **· Shows** (`continueEntries('movie' | 'series')`),
     side by side on wide screens.
- Refresh on `onLibraryChange` and when returning to Home (`onViewChange`).
- The mini player must keep working on Home: in `theater.js` the `onViewChange` handler
  treats `browse` / `series` / `movie` as "browsing"; **add `home`** there.
- Esc on Home does nothing (like browse); back from a channel opened from Home returns
  to Home.

**Done when:** the app opens on Home showing favourites (or recents) and continue
watching; clicking anything plays it; the mini player survives going back to Home.

---

## 4. Step 4: Sport Center + main match (2–3 days)

### 4.1 Server: `lib/sports.js` (ESPN)

Checked on 2026-10-31: public, **no key needed**.

```
GET https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
```

- **One day per request.** A range (`dates=20261103-20261105`) returned 0 events, so
  loop over 7 days.
- Responses are gzipped (Node's `fetch` handles that).
- Leagues to fetch (all **checked on 2026-10-31**, HTTP 200 with events):

  | Sport | ESPN `{sport}/{league}` |
  | --- | --- |
  | Soccer, 5 major leagues | `soccer/esp.1` (LaLiga), `soccer/eng.1` (Premier League), `soccer/ita.1` (Serie A), `soccer/ger.1` (Bundesliga), `soccer/fra.1` (Ligue 1) |
  | Soccer, European competitions | `soccer/uefa.champions`, `soccer/uefa.europa`, `soccer/uefa.europa.conf` (Conference League), `soccer/uefa.super_cup` |
  | Soccer, Spain national team | `soccer/fifa.worldq.uefa` (World Cup qualifying), `soccer/uefa.nations`, `soccer/fifa.world`, `soccer/fifa.friendly`. Only keep matches where Spain plays. |
  | Copa del Rey (Real Madrid) | `soccer/esp.copa_del_rey` |
  | Tennis | `tennis/atp`, `tennis/wta`. **Different shape:** `events[]` are *tournaments*; matches are in `events[].groupings[].competitions[]` (grouping e.g. "Men's Singles"), players in `competitors[].athlete.displayName`. Show singles only, and only matches on the next 2 days (one tournament has ~40 matches). |
  | F1 | `racing/f1`. One event per Grand Prix; check whether sessions (practice / qualifying / race) are listed in `competitions[]` and show qualifying + race. |
  | NFL | `football/nfl` |
  | NBA | `basketball/nba` |

- **MotoGP is not on ESPN** (`racing/motogp` → HTTP 400). Use MotoGP's own public API (no key;
  checked 2026-10-31):
  `GET https://api.motogp.pulselive.com/motogp/v1/results/seasons` → pick the one with
  `current: true` → `GET …/results/events?seasonUuid={id}&isFinished=false` → events with
  `name`, `date_start`, `date_end`, `circuit.name` (next ones: Qatar 6–8 Nov, Portugal
  20–22 Nov, Valencia 27–29 Nov 2026). Session times (qualifying, sprint, race) need a
  further call; find the sessions endpoint and check it in Step 1. Put this in its own
  small module (`lib/motogp.js`) that returns the same Event shape as the ESPN one.
- NFL / NBA kick off late at night in Spain (often 01:00–04:00). Show them, but they
  shouldn't take the main-match spot over a European evening match; see the ranking.
- Useful fields: `events[].id`, `.date` (ISO UTC), `.name`;
  `competitions[0].competitors[]` → `homeAway`, `score`, `team.{displayName,
  shortDisplayName, abbreviation, logo}` (tennis: `athlete.{displayName, flag}`);
  `status.type.{state: pre|in|post, name,
  shortDetail}`, `status.displayClock`.
- **Ignore `broadcasts`**: US channels only (ESPN Deportes, Paramount+).
- Cache per league/day: 60 s if any match is `in`, 30 min otherwise, 6 h for past days.
  Run requests one at a time with a small gap (same pattern as the TVmaze queue in
  `server.js`).
- Keep everything ESPN-specific inside this module so it can be swapped for
  football-data.org (free key, football only) if ESPN changes.

### 4.2 Server: `lib/fixture-match.js` (pure, tested)

Links a fixture to guide programmes:

1. Normalise team names: `normTitle`, then drop club prefixes/suffixes
   (`fc, cf, cd, rcd, sd, ud, rc, sad, club, de futbol`). **Keep "real", "atletico",
   "athletic"**: they distinguish clubs.
2. Alias table (start small, grow it from step 1's misses), e.g.
   `atletico madrid ↔ atletico de madrid, atleti`; `bayern munich ↔ bayern munchen, bayern`;
   `espanyol ↔ rcd espanyol de barcelona`; `athletic club ↔ athletic bilbao`;
   `internazionale ↔ inter, inter de milan`; `paris saint-germain ↔ psg`;
   `psv eindhoven ↔ psv`.
3. Candidate programmes: start within **±45 min of kick-off** (or covering kick-off).
4. Match = both teams found in the title (strong, `confidence: "guide"`), or one team +
   a competition word (champions / laliga / copa) (weaker, still "guide").
   Tennis: both players' surnames. F1 / MotoGP: the Grand Prix name (e.g. "Qatar",
   "GP de Catar", so add Spanish country names to the alias table) plus a session word
   (`carrera|race|clasificaci[oó]n|qualifying|sprint`).
   Skip titles starting with `Resúmenes`, `Previa`, `Post` for the "Watch" link (keep
   them for the finder).
5. Nothing found → **best guess** from a constant table competition → channel-name
   patterns, resolved against `get_live_streams`. Start with
   `esp.1 → /dazn laliga|m\+ laliga/i`, `uefa.champions → /liga de campeones/i`,
   `uefa.europa|uefa.europa.conf → /europa|conference|m\+ liga de campeones/i`,
   `esp.copa_del_rey → /copa del rey/i`, `racing/f1 → /f1|formula/i`,
   `motogp → /moto ?gp|dazn/i`, `tennis → /tenis|tennis|eurosport|movistar deportes/i`,
   `nfl → /nfl|dazn/i`, `nba → /nba|m\+ deportes/i`, `eng.1|ita.1|ger.1|fra.1 → /dazn|m\+ deportes|premier|serie a|bundesliga|ligue/i`.
   **Check these against the real channel names in Step 1** and adjust them. Spanish TV rights
   change every season, so the table is a guess by design. Return `confidence: "guess"`. **The UI must never present a guess
   as certain.**

Tests: real ESPN names vs the real title shapes in 2.4, including accents and the
"Team A - Team B - COMPETITION" format.

### 4.3 Server: ranking (`lib/rank.js`, pure, tested)

| Signal | Points |
| --- | --- |
| Real Madrid or Spain (national team) plays | +50 |
| A Spanish athlete plays / races (tennis, F1, MotoGP), if the user confirms (see decisions) | +30 |
| Live now | +40 |
| Starts within 3 h | +25, fading linearly to 0 |
| Competition | Champions 30 · LaLiga 25 · Spain national team 25 · F1 / MotoGP race 20 · Premier, Serie A, Bundesliga, Ligue 1, Europa 15 · Copa, Conference 12 · NBA, NFL, tennis 10 |
| Starts between 00:00 and 07:00 local time (most NBA / NFL) | −15 (still listed, rarely the main match) |
| Two big clubs (top-6 or a derby) | +20 ("Top match") |
| Found on the user's channels | +15 |
| Finished > 30 min ago | hidden |

Weights are constants at the top of the file; tune them after a week of use. Since ESPN's
scoreboard has no table positions, start "big clubs" as a constant list per league.

### 4.4 Endpoint

```
GET /api/sports/home?server&username&password&ua&teams=real-madrid,spain&leagues=esp.1,uefa.champions,…
  -> { featured: Event | null,
       events: [Event…] }   // ranked, ~20 max
Event = { id, league, leagueName, start, state: "pre"|"in"|"post", clock, detail,
          home: { name, short, logo, score }, away: { … },
          where: [{ streamId, name, quality, confidence: "guide" | "guess" }],
          rank, tags: ["your-team", "top-match"] }
```

`teams` / `leagues` come from the user's settings (step 5) in `library` on the client.

### 4.5 App

- `public/js/sports.js`: renders the **main match** panel (countdown or live minute + score,
  Watch buttons for the best versions, Remind me) and the **Sport Center** row (filter
  chips: All · My teams · Football · Tennis · F1 · MotoGP · NFL · NBA; cards as in the
  mockup; "in guide" solid vs "best guess" dashed). Tennis cards show players and
  tournament/round; F1/MotoGP cards show Grand Prix, session and circuit instead of two teams.
- Card buttons: Watch → `openTheater`; Multiview (live only) → `openMultiview([…])`;
  Remind me → step 5.
- Team crests: ESPN `team.logo` URLs through `fillThumb` (falls back to initials).
- Refresh every 60 s while Home is visible and anything is live; otherwise every 10 min.
  Hook into the existing 30 s tick in `main.js`.

**Done when:** Home shows this week's real matches ranked, each saying where to watch
(or a labelled guess), and Watch plays the right channel.

---

## 5. Step 5: reminders + settings (1 day)

- `library.reminders = [{ id, title, start, streamIds, source: "fixture" | "programme" }]`
  (per account, like favourites). Add/remove helpers in `library.js`.
- A check every 30 s (main tick): at T−5 min show a **toast with a Watch action** (8 s
  duration), and again at kick-off if it wasn't acted on. **No desktop notifications and
  no automatic channel switching** (user decision).
- If the app wasn't open at T−5 but is opened before the match ends, show the toast then.
- Remove reminders 3 h after start.
- Settings sheet (from an "Edit" link on the Sport Center row): teams pre-filled with
  **Real Madrid** and **Spain**, sports/leagues pre-filled with the user's choices; they
  can add or remove. Store in `library.sports = { teams: [...], leagues: [...], spanishAthletes: bool }`.
  No first-run picker is needed since the defaults are known.

**Done when:** a reminder set for a match shows a toast 5 min before with a working
Watch button, and Real Madrid / Spain matches rank first.

## 6. Testing checklist (every step)

- `npm test` and the eslint command pass.
- Restart the server after server changes, reload the app, check the console for errors
  (Claude in Chrome: `read_console_messages` with `onlyErrors`).
- Click through in the UI; screenshots only. No scripts reading `localStorage`.
- Live TV still works: open a channel, zap with ↑/↓, back to Home → mini player keeps
  playing.
- Clean up test data you created (reminders, Continue Watching entries, hidden
  categories); leave everything else alone.
- Update `README.md` (features + keyboard table) when a step ships.
