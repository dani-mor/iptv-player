# IPTV Player

A local web app that connects to an **Xtream Codes compatible** IPTV provider (the standard "server URL + username + password" format) and lets you browse and play Live TV, Movies, and TV Shows in the browser.

## Why this needs a server (not just a static page)

Two things make a pure browser-side player impossible for most providers:

1. **CORS** — IPTV panels generally don't send the headers needed to let a browser fetch their API or streams cross-origin.
2. **User-Agent** — Many providers only accept requests from a whitelisted player User-Agent (e.g. `IPTVSmartersPlayer`, `VLC`). Browsers refuse to let JavaScript set the `User-Agent` header on `fetch`/`XHR`/`<video>` requests — it's a forbidden header.

So this app runs a small Node/Express backend that:
- Calls the provider's `player_api.php` on your behalf and returns JSON to the frontend.
- Proxies the actual video (live HLS playlists, movies, episodes) with the right `User-Agent`, rewriting `.m3u8` playlists so every segment/variant URL also routes back through the proxy.

Your credentials are only ever sent to the server address you enter. The one other outbound lookup is for TV show artwork (see below).

## Setup

```bash
cd iptv-player
npm install
npm start
```

Then open **http://localhost:4040**. (`./launch.sh` starts the server if needed and opens it in its own Chrome app window.)

Port is configurable: `PORT=8081 npm start`. The server only listens on this computer (loopback). To watch from another device on a network you trust, start it with `HOST=0.0.0.0 npm start`; anyone who can reach it can use it, including as a proxy.

Run the tests with `npm test`.

## Using it

1. Enter your provider's server address (e.g. `http://example.com:8080`), username, and password. After the first login the app opens straight away on later launches, from a local copy of your channel lists, and refreshes them in the background.
2. If your provider returns `403` errors, open **Advanced** and try a different User-Agent (`IPTVSmartersPlayer` is the default and works with most providers that restrict by player).
3. Browse **Live TV / Movies / TV Shows** via the category sidebar. Filter the categories with the box at the top, and hide the ones you never use (hover a category, click the eye; hidden ones stay under **Hidden** at the bottom). **All Channels / All Movies / All Shows** loads everything so search covers it all. Search ignores accents (`pelicula` finds `Película`).
4. Channels open a player with the channel list. Channel names are shown without country prefixes, with their quality (FHD, HD, 4K…) as a badge. When a channel exists in several qualities, **Versions** under the player switches between them, and if one is broken at the provider the app switches to the next version by itself.
5. Going back from a live channel keeps it playing in a **mini player** in the corner while you browse. **Multiview** (the four-squares button) shows up to four channels at once; click a tile to hear it.
6. Movies and TV Shows open a page with details first; press Play or Resume. Movies and episodes you start show up under **Continue Watching** and resume where you left off.
7. On Live TV, switch between **Channels** and **Guide** (a timeline of what's on). Star a channel to add it to **Favourites**; channels you watch appear under **Recently Watched**. Both are stored in this browser, per account.

Keyboard:

| Where | Keys |
| --- | --- |
| Everywhere | `/` search, `Esc` go back, `Tab` + `Enter` to move around and open things |
| Live TV | `↑`/`↓` (or `PgUp`/`PgDn`) change channel, `Backspace` previous channel, `Space`/`K` play/pause, `M` mute, `F` full screen |
| Movies & episodes | `Space`/`K` play/pause, `←`/`→` seek 10s, `M` mute, `F` full screen |
| Multiview | `1`–`4` choose whose sound you hear, `F` full screen |

## Code layout

- `server.js`: the Express server (provider API, media proxy, artwork lookup). Pure helpers live in `lib/` (playlist rewriting, the movie-start speed-up, title matching).
- `public/js/`: the frontend as plain ES modules, no build step. `main.js` is the entry point; `live-player.js` holds the live playback and recovery logic shared by the theater and multiview; `names.js` parses channel names.
- `test/`: `node --test` unit tests for the pure helpers.
- hls.js is installed from npm at a pinned version and served from `/vendor`, so playback doesn't depend on a CDN.

## Notes & limitations

- Credentials are stored in your browser's `localStorage` (if "remember" is checked) and in server memory only for the duration of each request — nothing is persisted server-side. Channel and category lists are cached in the browser's IndexedDB (cleared on log out). Don't expose this server to the internet without adding your own authentication in front of it.
- Live channels are requested as HLS (`.m3u8`) and played with [hls.js](https://github.com/video-dev/hls.js) (served locally from `node_modules`). Movies/episodes are played with the browser's native `<video>` element using the container format the provider reports (usually `mp4`); formats the browser can't decode natively (e.g. some `.mkv`/`.avi` streams) won't play — that's a browser codec limitation, not something this app can work around without transcoding.
- Guide data comes from the provider's EPG. Channels the provider has no EPG for show "No guide information".
- **TV show artwork:** some providers serve show covers from hosts that are offline. When a provider image fails to load, the server looks the show up instead: by the provider's TMDB id via [Wikidata](https://www.wikidata.org) → [TVmaze](https://www.tvmaze.com), falling back to a TVmaze title search. Only the show's TMDB id / title is sent. Results are cached in `.artwork-cache.json`.
  For exact matches on every show, put a free [TMDB API key](https://www.themoviedb.org/settings/api) in a `.env` file next to `server.js`:
  ```
  TMDB_API_KEY=your_key_here
  ```
