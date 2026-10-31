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

Then open **http://localhost:4040**.

(Port is configurable: `PORT=8081 npm start`.)

## Using it

1. Enter your provider's server address (e.g. `http://example.com:8080`), username, and password.
2. If your provider returns `403` errors, open **Advanced** and try a different User-Agent (`IPTVSmartersPlayer` is the default and works with most providers that restrict by player).
3. Browse **Live TV / Movies / TV Shows** via the category sidebar. Click **All Channels / All Movies / All Shows** to load every category for that tab so the search box can filter across everything (can take a while on very large playlists).
4. Click any item to play it. Channels open a player with a channel list; movies and episodes open a full-page player with details and playback options. TV Shows open a show page with seasons and episodes first.
5. On Live TV, switch between **Channels** and **Guide** (a timeline of what's on). Channel cards and the player's channel list show the programme on now; the player shows its progress and the schedule for the next 24 hours.
6. Star a channel to add it to **Favourites**. Movies and episodes you start show up under **Continue Watching** and resume where you left off. Both are stored in this browser, per account.

Keyboard: `Space`/`K` play/pause, `←`/`→` seek 10s, `F` full screen, `M` mute, `Esc` go back.

## Notes & limitations

- Credentials are stored in your browser's `localStorage` (if "remember" is checked) and in server memory only for the duration of each request — nothing is persisted server-side. Don't expose this server to the internet without adding your own authentication in front of it, since anyone who can reach it can use your saved session.
- Live channels are requested as HLS (`.m3u8`) and played with [hls.js](https://github.com/video-dev/hls.js). Movies/episodes are played with the browser's native `<video>` element using the container format the provider reports (usually `mp4`); formats the browser can't decode natively (e.g. some `.mkv`/`.avi` streams) won't play — that's a browser codec limitation, not something this app can work around without transcoding.
- Guide data comes from the provider's EPG. Channels the provider has no EPG for show "No guide information".
- **TV show artwork:** some providers serve show covers from hosts that are offline. When a provider image fails to load, the server looks the show up instead: by the provider's TMDB id via [Wikidata](https://www.wikidata.org) → [TVmaze](https://www.tvmaze.com), falling back to a TVmaze title search. Only the show's TMDB id / title is sent. Results are cached in `.artwork-cache.json`.
  For exact matches on every show, put a free [TMDB API key](https://www.themoviedb.org/settings/api) in a `.env` file next to `server.js`:
  ```
  TMDB_API_KEY=your_key_here
  ```
