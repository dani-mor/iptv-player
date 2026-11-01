# Roadmap: the IPTV player on the tailnet (iPhone + Firestick)

Next phase of the project: move the server off the laptop onto the home server, reachable only over
Tailscale, and make the app feel native on the iPhone and the Firestick.

This repo is public, so this file has no addresses or tailnet names. The concrete deploy steps
(container ID, IPs, commands) live in the private home-network folder as `iptv-runbook.md`.

Last updated: **2026-11-01**

| Phase | Goal | Size | State |
|---|---|---|---|
| 0 | Make the server safe to run on the home network | 1–2 evenings | not started |
| 1 | Deploy it in its own container, HTTPS via `tailscale serve` | 1 evening | not started |
| 2 | iPhone and Firestick join, baseline test | 1 evening | not started |
| 3 | One account, shared state across devices | ~1 week | not started |
| 4 | iPhone integration (installable app, touch, AirPlay, PiP, push reminders) | 2–3 weeks | not started |
| 5 | Firestick integration (TV app, D-pad, remote keys, native player) | 3–4 weeks | not started |
| 6 | Devices working together (Play on TV, handoff, phone as remote) | 1–2 weeks | not started |
| 7 | Optional: MKV on iPhone, native iOS app | — | later |

Sizes are part-time estimates. Phases 4 and 5 can run in either order once 3 is done.

---

## How it fits

```
 iPhone (Tailscale on)      Firestick (Tailscale on)      laptop / iPad
        │ HTTPS                     │ HTTPS                     │
        └────────────── https://iptv.<tailnet>.ts.net ──────────┘
                                   │   (tailnet only; no funnel, no port forward)
                     ┌─────────────┴─────────────┐
                     │ LXC "iptv" on pve (wired) │
                     │  tailscale serve :443     │
                     │    → node server.js       │  listens on 127.0.0.1:4040 (the default)
                     │  /var/lib/iptv-player     │  guide cache, artwork cache, shared state
                     └─────────────┬─────────────┘
                                   │ provider API + streams, artwork, ESPN/MotoGP
                                internet
```

Choices and why:

- **Its own LXC on pve, not pve2.** Every video byte passes through the server twice (provider → server
  → device). pve is on Ethernet; pve2 is WiFi-only with 2–120 ms jitter, the DNAT bridge and the
  veth-attach failures. The app is light: 138 MB RSS measured, plus at most 128 MB of cached movie tails,
  so a 1 GB container fits even with pve's memory pressure. Revisit once pve2 is on Ethernet.
- **`tailscale serve` inside the container, not a `.lan` name through Nginx Proxy Manager.** It's the
  same pattern as CouchDB:
  - It gives real HTTPS on a `ts.net` name. The iPhone needs HTTPS to install the app to the home
    screen with a service worker and to receive push notifications.
  - It needs no records on the two Pi-holes, so the load-bearing DNS isn't touched at all.
  - It keeps NPM, whose timeouts and buffering are set up for web pages, out of the path of long
    video streams.
  - The server already listens only on loopback, so `tailscale serve` is the only way in.
- **Every device must run Tailscale, even at home.** The router isolates WiFi clients from the LAN, so
  the Firestick and the iPhone can't reach the container's LAN IP anyway.
- **Side effects:**
  - Away from home, streams come out of the home upload. An FHD channel needs about 5–8 Mbps, so watch
    the upload speed.
  - All devices reach the provider from one home IP, which suits providers that limit IPs.
  - The provider's connection limit is now shared by every device in the house (see Phase 3).

---

## Phase 0: make the server safe to run on the home network

On the laptop, `/proxy/media` fetches any URL it's given. Inside a container with a real LAN address,
that makes it a way for any tailnet device to reach the Proxmox API, the Pi-hole and NPM admin pages.
Fix that before deploying, and do the rest of the small server changes at the same time.

1. **Only proxy URLs the server issued.** Sign the URLs written into rewritten playlists (an HMAC with a
   per-process secret, in `lib/playlist.js`) and reject unsigned or tampered `/proxy/media` requests.
   Add a test next to `test/server-lib.test.js`.
2. **Pin the provider.** Add an optional `PROVIDER_SERVER` setting. When it's set, `/api/xtream`,
   `/api/login` and `/stream` refuse any other server. Phase 3 removes the `server` parameter entirely.
3. **Serve provider images through the server.** Channel logos and covers are often plain `http://`.
   On an HTTPS page they are mixed content, and Safari and Silk block or break them. Add
   `/proxy/image`: signed URLs, image content types only, cached.
4. **Add a `DATA_DIR` setting.** `.guide-cache/` and `.artwork-cache.json` currently sit next to
   `server.js`. Move them under `DATA_DIR`, falling back to the current location so the laptop setup
   keeps working.
5. **Add `/healthz`** returning `{ ok, uptime, guideAge }` for the home dashboard's HTTP check.
6. Update the README's "Notes & limitations" for the new setup.

Done when `npm run check` passes and an unsigned `/proxy/media?url=http://<some LAN address>` returns 403.

## Phase 1: deploy (steps in `iptv-runbook.md`)

1. Create a new unprivileged LXC on pve with Debian 13, 2 cores, 1 GB RAM and an 8 GB disk, on `vmbr0`
   with a real LAN IP.
2. Install Node 22+, clone this repo to `/opt/iptv-player`, run `npm ci --omit=dev`, and run it as a
   systemd service under its own user with `DATA_DIR=/var/lib/iptv-player`.
3. Pass the TUN device through to the container, install Tailscale, then run `tailscale serve --bg 4040`.
   Disable key expiry for the node.
4. Hook it into the infrastructure:
   - home dashboard HTTP check on `/healthz`
   - add the container to the weekly backup job
   - add it to the network docs' container table and the infra `ROADMAP.md`
5. Update by running `git pull --ff-only && npm ci --omit=dev && systemctl restart iptv-player`. To
   roll back, stop the container; the laptop copy still works.

Done when the laptop browser plays a live channel and a movie from `https://iptv.<tailnet>.ts.net` about
as fast as from `localhost`.

## Phase 2: devices join, baseline test

1. **iPhone**: it's already on the tailnet. Turn on Tailscale's VPN On Demand so it reconnects by itself.
2. **Firestick**:
   - Install the Tailscale app (Amazon Appstore, or sideload the Android TV APK) and sign in.
   - Disable key expiry for the node; signing in again with a remote is painful.
   - **Check that Tailscale is still connected after the stick wakes from sleep.** That is the biggest
     unknown in this plan.
3. Open the app in Safari (iPhone) and Silk (Firestick). Fill in this table:

| Check | iPhone Safari | Firestick Silk |
|---|---|---|
| Login, channel lists load | | |
| Live channel starts (seconds) | | |
| Live recovery when a stream stalls (iOS may use the native HLS player, which has no recovery) | | |
| Movie starts (seconds); seek | | |
| Episode plays, Continue Watching | | |
| Guide, Sport Center, match finder | | |
| Logos and covers show | | |
| Full screen | | |
| Remote: arrows, OK, Back (Firestick) | — | |

The movie-start speed-up (`lib/tail.js`) is tuned to how Chrome requests the end of an mp4. Safari,
Silk and later ExoPlayer request files differently, so record start times here before tuning anything.

## Phase 3: one account, shared state

Right now each browser logs in and keeps its own favourites. With several screens that breaks down:
typing a provider password with a TV remote is painful, and something started on the iPhone should
resume on the TV.

1. **Provider credentials live on the server** (an env file in the container, mode 600). Devices no
   longer log in. The frontend drops `server`/`username`/`password` from every request, which also
   closes the remaining open-proxy paths.
2. **Profiles from Tailscale identity.** `tailscale serve` adds `Tailscale-User-Login` to each request.
   Use it to keep state per person without a login screen.
   - Decide: a profile per Tailscale user, or one shared household profile?
3. **Move state to the server**: favourites, recently watched, Continue Watching positions, hidden
   categories, teams and competitions, reminders. Use a JSON store in `DATA_DIR` (SQLite later if
   needed). Keep the IndexedDB channel cache as a per-device speed-up.
4. **Connection-limit awareness.** The server proxies every stream, so it knows how many are open.
   Compare that with `user_info.max_connections` and show a warning such as "TV is using 1 of 2"
   before the provider starts cutting streams. Multiview counts each tile.

Done when the iPhone and the Firestick open straight into the app with the same favourites, and a
movie paused on one resumes on the other.

## Phase 4: iPhone integration

Starts as a home-screen web app; HTTPS from Phase 1 makes that possible.

1. **Phone layout.** Today there are only four breakpoints in `styles.css`.
   - The category sidebar becomes a drawer, with a bottom tab bar (Home, Live, Movies, Shows).
   - Larger touch targets and safe-area insets (notch, home indicator).
   - Everything hover-only gets a tap equivalent (29 `:hover` rules, e.g. the eye that hides a
     category).
   - The guide timeline scrolls by touch.
   - On a phone, Multiview is limited to 2 tiles or hidden.
2. **Installable app**:
   - web app manifest and icons
   - `display: standalone`
   - a service worker that caches the app's own files (never streams), so it opens instantly
   - Test on the iPad too.
3. **Native playback on iOS.** Use Safari's own HLS player when it's there, instead of hls.js. That gives
   AirPlay and picture-in-picture, and full screen on iPhone works on the `<video>` element itself
   (`webkitEnterFullscreen`).
   - Native HLS has none of the stall recovery in `live-player.js`, so port a light version that
     watches `timeupdate`/`stalled`/`error` and reloads.
4. **Lock screen and Control Center**: use the Media Session API for the channel or programme name,
   artwork, and play/pause.
5. **Push reminders**:
   - Reminders move to the server (Phase 3 state) and fire as Web Push, which works on iOS 16.4+ for
     home-screen apps. That needs VAPID keys in the server's env file.
   - Today reminders only show while the app is open.

Done when the app is installed on the home screen, it opens in under a second, a live channel goes to
picture-in-picture and AirPlay, and a "Remind me" arrives with the app closed.

## Phase 5: Firestick integration

1. **TV mode in the web UI** (detect the user agent, or `?tv=1` from the TV app):
   - **D-pad navigation**: arrows move focus between tiles and rows, OK opens.
   - Arrows already mean change channel (`main.js:200`) and seek (`main.js:213`), so they keep those
     meanings only while a player is in focus; otherwise they move focus.
   - **10-foot styling**: bigger type, a strong focus ring, no hover, nothing small near the screen
     edges.
   - **Typing**: use the on-screen keyboard, or let the iPhone type for the TV (Phase 6).
2. **A small Android TV app (Kotlin)**, so the TV gets a launcher icon and proper remote keys:
   - **Stage 1**:
     - A full-screen WebView on `https://iptv.<tailnet>.ts.net` with a launcher banner.
     - Remote keys mapped: Back → `Esc`, Play/Pause, rewind/fast-forward, channel up/down.
     - A clear "Tailscale is off" screen instead of a WebView error.
   - **Stage 2**:
     - Playback moves to Media3 ExoPlayer through a JS bridge, while the UI stays in the WebView.
     - ExoPlayer plays MKV, AC3/EAC3 (passed through to the TV or soundbar), and runs much lighter than
       hls.js on Firestick hardware.
     - Port the recovery rules (stall → reload, broken version → next version) and re-measure movie
       start against `lib/tail.js`.
3. **Install and updates**:
   - Install by sideloading over Tailscale (`adb connect <firestick-tailscale-ip>:5555` with ADB
     debugging enabled), or with the Downloader app from a URL on the server.
   - The server serves the latest APK and its version; the app checks on start and offers to update.
   - No Amazon Appstore listing.
4. **Firestick limits**:
   - Cheaper sticks are slow, so test Multiview at 2 tiles and keep 4 for the laptop.
   - Decide the default quality version if FHD stutters on the stick.

Done when the app starts from the Fire TV home screen, everything works with the remote alone, and an
MKV movie with 5.1 sound plays (stage 2).

## Phase 6: devices working together

The Firestick app keeps a live connection (SSE or WebSocket) to the server, so other devices can reach
it.

1. **Play on TV** from the iPhone: on any channel, movie or match, pick "TV" and it starts there.
2. **Phone as remote** while the TV plays: channel up/down, the channel list, the guide, volume and
   pause. The phone also types search text for the TV.
3. **Handoff**: "Continue on iPhone" from the TV, or the other way round, at the same position (uses
   Phase 3 state).
4. **Reminders reach the TV**: a banner on the Firestick ("Real Madrid – Barça starts in 5 min · Watch")
   as well as the push on the iPhone.

## Phase 7: optional

- **MKV/AVI on iPhone**: Safari can't play them. The server could remux them on the fly (ffmpeg,
  copying the codecs into HLS) without re-encoding, which is cheap on CPU. Only do this if it comes
  up often.
- **Native iOS app** (WKWebView plus AVPlayer): adds background audio and a more native feel. It needs
  the $99/year Apple developer account (TestFlight). A free account means re-signing every 7 days.
  Decide after living with the home-screen app.
- **Away-from-home quality**: if the home upload is the bottleneck, prefer the HD over the FHD version
  when the device isn't on the home network.

---

## Decisions pending with Dani

- Who gets access: just Dani, or the household too (another person's phone and the iPad are on the
  tailnet)? Use a Tailscale ACL on the `iptv` node either way. This also decides per-person or shared
  profiles (Phase 3).
- iPhone: stay a home-screen web app, or pay for a native app later (Phase 7)?
- Firestick stage 2 (ExoPlayer): worth it if MKV and surround sound matter on the TV.
