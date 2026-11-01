# Dani's Home Network — agent context

This folder holds the source and documentation for a self-hosted home server
setup running on two Proxmox hosts. If you are an agent working in this
directory, read this file first, then the task brief you were pointed at.

---

## How to work with Dani

- Comfortable with Linux and the command line, but not an expert. Explain
  briefly when something is not obvious; don't lecture.
- **Lead with the command.** Don't write three paragraphs before giving the
  thing to run.
- **One step at a time.** Do not fire off ten commands at once. Run one,
  read the real output, then decide the next.
- **Never assume something worked.** Verify from actual output. If a command
  fails, diagnose from what it printed, not from what you expected.
- **Be honest about uncertainty.** If you're not sure, say so.
- Work happens in sessions, picking up where the last one left off. Leave
  notes when you stop mid-task.

## Safety rules for acting on this network

This is live infrastructure that Dani's household actually uses. Photos, DNS
and media all run on it.

- **Do not run destructive commands without asking.** `pct destroy`,
  `rm -rf`, `iptables -F`, wiping storage, anything that takes a container
  down — confirm first.
- **DNS is load-bearing.** Pi-hole on CT 102 is the resolver for every
  Tailscale device. Breaking it takes the whole household off the internet,
  not just `.lan` names. Treat any change to it as high-risk and have a
  rollback ready before you touch it.
- **Don't restart pve2 casually.** It is WiFi-only and has a history of
  containers failing to attach their veth interfaces on boot.
- Prefer additive changes. Create new things alongside the old, verify, then
  cut over.
- `.env` files in this repo hold live Proxmox API tokens and the Pi-hole
  password. Never print their values, never commit them. If this directory
  ever becomes a git repo, `.gitignore` must contain `.env` before the first
  commit.

---

## Hosts

### pve — ThinkCentre m710q
- Proxmox VE 9.1
- LAN `192.168.1.100` (ethernet), Tailscale `100.114.120.51`
- 8GB RAM, 1TB WD HDD (single disk, no redundancy)
- WiFi exists as fallback (`wifi0`, Intel AC 3165) via a custom
  `wifi-connect.service` running `/usr/local/bin/wifi-start.sh`
- Carries everything critical: reverse proxy, DNS, photos
- **Resource pressure is likely here** — 8GB running Immich (Postgres +
  Redis + machine-learning) plus three other containers, on a spinning disk

### pve2 — ThinkPad P51s
- Proxmox VE 8.4
- LAN `192.168.1.85` via `wifi0` (MAC `f8:94:c2:91:5c:b2`), host also
  configured as `192.168.1.200`; Tailscale `100.114.179.88`
- 16GB RAM, i7-6500U, NVIDIA Quadro M520 2GB (**currently unused** — could
  do NVENC transcoding for Jellyfin)
- WiFi-only. `vmbr0` exists but is unplugged/unused. You cannot bridge
  containers onto the LAN through a WiFi client interface, which is why the
  containers live on an isolated bridge instead.
- Hosts the media stack on **`vmbr1`, `10.10.10.0/24`**, reached from
  outside via host-level iptables DNAT on `192.168.1.85:<port>`

---

## Containers

### On pve (bridge `vmbr0`, real LAN IPs)

| CT  | Name         | LAN IP        | Tailscale IP    | Port      | Role |
|-----|--------------|---------------|-----------------|-----------|------|
| 101 | nginx-proxy  | 192.168.1.102 | 100.65.185.121  | 80/81/443 | Nginx Proxy Manager |
| 102 | pihole       | 192.168.1.103 | 100.79.21.33    | 80/53     | Pi-hole v6, DNS + ad block |
| 103 | immich       | 192.168.1.104 | 100.99.76.118   | 2283      | Photos (Docker Compose stack) |
| 104 | supertracker | 192.168.1.105 | 100.96.55.11    | 5050      | Custom Flask stock dashboard |
| 105 | couchdb      | 192.168.1.106 | 100.80.208.2    | 443 (tailscale serve) | CouchDB for Obsidian LiveSync; binds 127.0.0.1:5984, exposed only via `tailscale serve` at `https://couchdb.hyrax-mulley.ts.net` |
| 106 | dashboard    | 192.168.1.107 | 100.68.21.67    | 8060      | `home-dashboard` Flask app (see below) |

`192.168.1.101` was Nextcloud, since deleted (its NPM proxy host `nextcloud.lan` still exists, stale).

### On pve2 (bridge `vmbr1`, DNAT'd via `192.168.1.85`)

| CT  | Name        | Internal IP | Port | Role |
|-----|-------------|-------------|------|------|
| 100 | jellyfin    | 10.10.10.2  | 8096 | Media server |
| 101 | jellyseerr  | 10.10.10.3  | 5055 | Media requests |
| 102 | sonarr      | 10.10.10.4  | 8989 | TV automation |
| 103 | radarr      | 10.10.10.5  | 7878 | Movie automation |
| 104 | qbittorrent | 10.10.10.7  | 8090 | Torrent client |
| 105 | prowlarr    | 10.10.10.8  | 9696 | Indexer manager |
| 106 | pihole2     | 10.10.10.6  | 53/80 | Pi-hole v6, secondary DNS — Tailscale `100.92.51.123`, LAN via DNAT `192.168.1.85:53` (udp+tcp) |

Note the CT IDs collide with pve's — always say which host you mean.

### Other Tailscale nodes
- `dani-laptop` `100.111.46.117`
- `iphone-15-pro` `100.91.25.17`

---

## DNS architecture

Two Pi-holes serve the whole tailnet (since 2026-09-11):

- **Primary**: CT 102 on pve, `192.168.1.103` / Tailscale `100.79.21.33`
- **Secondary**: CT 106 `pihole2` on pve2, `10.10.10.6` / Tailscale
  `100.92.51.123`, also reachable on the LAN via DNAT `192.168.1.85:53`
- Both are listed as global nameservers in the Tailscale admin console.
  Tailscale does **not** reliably do primary-then-fallback — clients may
  round-robin — so **both must hold identical local DNS records**. Any
  `.lan` record added to one must be added to the other, or lookups fail
  intermittently. Sync is by hand for now (~11 records); `nebula-sync` is
  the Pi-hole v6 option if that gets tedious. Gravity Sync is dead for v6.
- Upstreams on both: `1.1.1.1`, `1.0.0.1`
- Ad blocking on both (default StevenBlack list only)
- Local DNS records: every `.lan` name below resolves to nginx-proxy's
  **Tailscale** IP `100.65.185.121`, which then reverse-proxies to the right
  backend by LAN IP. Records live in `/etc/pihole/pihole.toml` under
  `[dns] hosts`; edit with `pihole-FTL --config dns.hosts '[...]'`.
- Quirk: FTL answers `<own-hostname>.lan` with its own IP regardless of the
  hosts list, so the primary answers `pihole.lan` → `100.79.21.33` while the
  secondary answers `100.65.185.121` (both reach the primary's admin UI).
  `pihole2.lan` → `100.92.51.123` is the secondary's admin UI.
- Verified 2026-09-11: with CT 102 stopped, `.lan`, public and blocked
  lookups all still work from dani-laptop. Both nodes are reached directly
  (no DERP), ~48 ms per uncached query either way.
- The secondary's own resolver is `1.1.1.1` (`pct set --nameserver`) and
  Tailscale runs with `--accept-dns=false` so it never depends on itself or
  the primary to resolve.

Current `.lan` domains: `proxy`, `pihole`, `immich`, `supertracker`,
`jellyfin`, `jellyseerr`, `sonarr`, `radarr`, `qbittorrent`, `prowlarr`,
`dashboard`. (No stale `nextcloud.lan` record exists.)

Pi-hole v6 config lives at `/etc/pihole/pihole.toml`. **v6 changed the API
substantially from v5** — auth is session-based (`POST /api/auth` with the
password, then send the returned sid as header `X-FTL-SID`). Do not assume
v5 endpoints or `?auth=<token>`.

Nginx Proxy Manager admin API: `http://192.168.1.102:81/api`
(`POST /api/tokens` with identity/secret for a bearer token). **Most `.lan`
proxy hosts are plain HTTP** — only `immich.lan` (and stale `nextcloud.lan`)
have a certificate. `https://<other>.lan` fails with a TLS "unrecognized
name" error; that is not an outage, use `http://`.

---

## Known quirks

**Container DNS breaks after reboot.** Proxmox injects Tailscale's IPv6 DNS
(`fd7a:115c:a1e0::53`), which is unreachable from inside containers. The
current workaround is a `fix-dns.service` on each container writing
`nameserver 1.1.1.1` to `/etc/resolv.conf` at boot. Side effect: containers
bypass Pi-hole entirely, so they get no ad-blocking and cannot resolve
`.lan` names. The cleaner fix is `pct set <ctid> --nameserver <ip>`.

**Tailscale inside unprivileged LXC** needs TUN passthrough in
`/etc/pve/lxc/<ctid>.conf`:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

**pve2 DNAT rules match container traffic too.** The PREROUTING DNAT rules
have no source/interface match, so a container's *outbound* connection to
`<any host>:<DNAT'd port>` gets redirected back into `vmbr1`. This bit the
port-53 rules (Pi-hole's upstream queries looped back to itself); they carry
`! -s 10.10.10.0/24` for that reason. Add the same to any future rule whose
port a container might also talk *out* to. Rules persist via
`netfilter-persistent save` → `/etc/iptables/rules.v4`.

**Router WiFi client isolation.** WiFi clients on the LAN (e.g. dani-laptop
at `192.168.1.74`) cannot reach pve2's `192.168.1.85` at all — not even
ping — nor pve's LAN IPs. Wired pve can. So from the laptop, always use
Tailscale IPs; LAN-IP tests from the laptop prove nothing.

**pve has two identical backup jobs** (both `101,102`, `sun 01:00`, keep 2)
— every Sunday backs up twice. Harmless; flagged on the dashboard. Also the
primary Pi-hole is a minor version behind the secondary (dashboard shows it).

**Media pipeline (tuned 2026-09-23).** qBittorrent (pve2 CT 104) saves to
`/data/torrents` (was its private `/root/Downloads`, which silently broke
every Radarr import). Radarr/Sonarr hardlink into `/data/media/{movies,tv}`,
set folders `775` group GID 2000 (`media`, `jellyfin` is a member in CT 100;
host GID 102000) so Jellyfin can delete, unmonitor deleted items, and keep
15 GB free. qBittorrent stops seeding at ratio 1.0 or 24 h, then Radarr/Sonarr
remove the torrent copy. Radarr/Sonarr → Connect → Jellyfin (API keys named
Radarr/Sonarr) refresh the library on import. Radarr HD-1080p profile no longer
allows Remux (20–40 GB each). Jellyfin: QSV already passed through
(`dev0/dev1` in `100.conf`); HW decode h264/hevc(8-bit)/mpeg2/vc1 — Skylake
cannot decode 10-bit HEVC, so that is CPU; OpenCL tone mapping on (tested
3.9× realtime on a 4K DoVi file); CT 100 cores 2→4.

**pve2 dual-route.** Both `vmbr0` (unplugged) and `wifi0` could technically
route `192.168.1.0/24`. Fixed via explicit route metrics, but if a health
check to pve2 ever flaps, look here first.

**pve2 veth attach failures.** Containers on `vmbr1` have occasionally come
up "running" per Proxmox while their veth never attached — so the container
is running but unreachable. Still unresolved. Any health check should
distinguish "Proxmox says running" from "actually answering on its port."

**WiFi interface naming** is pinned on both hosts via
`/etc/systemd/network/10-wifi.link` (pve MAC `18:56:80:99:f1:56`), with
`iwlwifi` + `iwlmvm` in `/etc/modules` and a `wifi-connect.service` at boot.
The default gateway lives on `wifi0`, not on `vmbr0`.

---

## Backups (current state — weak, known)

- pve job `backup-9eccdfdd-7808`: CT 101,102,104,105,106 weekly (Sun 01:00),
  keep 2, to `local` (`/var/lib/vz/dump/`) — the same single disk.
- pve2 job: CT 100–106 weekly (Sun 02:00), keep 2, to its own `local`.
- immich (CT 103): **71 GB of photos, not backed up anywhere** — too big to
  keep twice on pve's disk. Config-only cron backup exists.
- Nothing is off-host or off-site yet. Phase 1 in `ROADMAP.md` (Proxmox
  Backup Server on pve2 + off-site copy) fixes this once HDDs arrive.

Dani is aware and sourcing HDDs. Don't re-litigate it unless asked.

---

## Roadmap

`ROADMAP.md` in this folder is the phased improvement plan with per-step
status — read it before starting infrastructure work, update it when a step
lands. Headline facts from the 2026-09-11 review: Immich holds **71 GB of
photos with no backup** (disk grown to 157 GB); pve's apt sources were
pointing at bookworm (fixed, upgrade pending); Tailscale key expiry still on
for pve2/couchdb/dashboard; backups are same-disk only until Phase 1 (PBS on
pve2 once HDDs arrive).

## Code in this folder

- `home-dashboard/` — Flask status dashboard for the whole network,
  **deployed** on pve CT 106 (`192.168.1.107:8060`, Tailscale
  `100.68.21.67`) as `http://dashboard.lan`. Rewritten 2026-09-11: background
  poller (no import-time poll), parallel checks, protocol-aware `http`/`dns`
  probes, both Pi-holes with a records-in-sync diff, backups parsed from
  vzdump task logs (the PVEAuditor token cannot list backup files), 24h
  history persisted in `/var/lib/home-dashboard/`. Code lives in
  `/opt/home-dashboard` (root-owned); redeploy = tarball + `deploy.sh`, see
  its README. `config.yaml.example` is the real config (secrets only in
  `.env`). Proxmox API tokens are `root@pam!dashboard-readonly` (PVEAuditor)
  on both hosts. Previous version kept at `/root/home-dashboard.old` in the
  container for rollback. `DASHBOARD_PASSWORD` is empty = no auth (Tailscale
  only). The dashboard container uses Tailscale MagicDNS for its resolver
  (unlike the others), so it depends on the Pi-holes for public names.
- `supertracker_app/` — the stock dashboard running on CT 104.

---

## Access summary

| Target | URL |
|---|---|
| Proxmox pve | `https://100.114.120.51:8006` |
| Proxmox pve2 | `https://100.114.179.88:8006` |
| Pi-hole (primary) | `http://pihole.lan/admin` |
| Pi-hole (secondary) | `http://pihole2.lan/admin` / `http://100.92.51.123/admin` |
| Nginx Proxy Manager | `https://proxy.lan` |
| Immich | `https://immich.lan` / `http://100.99.76.118:2283` (iPhone app) |
| SuperTracker | `http://supertracker.lan` |
| Dashboard | `http://dashboard.lan` |
| CouchDB | `https://couchdb.hyrax-mulley.ts.net/_utils/` |

All `.lan` names require Tailscale.
