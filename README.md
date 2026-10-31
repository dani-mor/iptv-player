# IPTV Player

A local web app that connects to an **Xtream Codes compatible** IPTV provider (the standard "server URL + username + password" format) and lets you browse and play Live TV, Movies, and TV Shows in the browser.

## Why this needs a server (not just a static page)

Two things make a pure browser-side player impossible for most providers:

1. **CORS** — IPTV panels generally don't send the headers needed to let a browser fetch their API or streams cross-origin.
2. **User-Agent** — Many providers only accept requests from a whitelisted player User-Agent (e.g. `IPTVSmartersPlayer`, `VLC`). Browsers refuse to let JavaScript set the `User-Agent` header on `fetch`/`XHR`/`<video>` requests — it's a forbidden header.

So this app runs a small Node/Express backend that:
- Calls the provider's `player_api.php` on your behalf and returns JSON to the frontend.
- Proxies the actual video (live HLS playlists, movies, episodes) with the right `User-Agent`, rewriting `.m3u8` playlists so every segment/variant URL also routes back through the proxy.

Nothing is sent anywhere except directly to the server address you enter.

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
3. Browse **Live TV / Movies / TV Shows** via the category sidebar. Click **"All (search all)"** to load every category for that tab so the search box can filter across everything (can take a while on very large playlists).
4. Click any item to play it. TV Shows open a season/episode list first.

## Notes & limitations

- Credentials are stored in your browser's `localStorage` (if "remember" is checked) and in server memory only for the duration of each request — nothing is persisted server-side. Don't expose this server to the internet without adding your own authentication in front of it, since anyone who can reach it can use your saved session.
- Live channels are requested as HLS (`.m3u8`) and played with [hls.js](https://github.com/video-dev/hls.js). Movies/episodes are played with the browser's native `<video>` element using the container format the provider reports (usually `mp4`); formats the browser can't decode natively (e.g. some `.mkv`/`.avi` streams) won't play — that's a browser codec limitation, not something this app can work around without transcoding.
- EPG (program guide) is not implemented — out of scope for "browse and play everything".
