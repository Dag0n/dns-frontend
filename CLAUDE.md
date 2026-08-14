# CLAUDE.md — agent guide for this repo

## What this is

Anglican DNS Manager: React (Vite) frontend + PocketBase backend
(`pocketbase/pb_hooks/` custom routes) driving a PowerDNS hidden master,
with Hurricane Electric as public secondaries. Architecture and API:
[README.md](README.md). Full server runbook: [DEPLOY.md](DEPLOY.md).

## Non‑negotiable: docs stay in sync

**Any change to server configuration, deployment steps, API routes, DB
schema, or operational behavior MUST update [DEPLOY.md](DEPLOY.md) and/or
[README.md](README.md) in the same commit/change.** This includes changes
made directly on a server (systemd units, pdns.conf, resolver config,
firewall): mirror them into DEPLOY.md immediately so the runbook can always
rebuild the box from scratch. If you find live config that contradicts the
docs, fix the docs (or the config) — never leave them diverged silently.

## Key operational facts (staging)

- **Server addresses, hostnames, and login details live in `CLAUDE.local.md`**
  (gitignored). Never put IPs, hostnames, usernames, or other identifiable
  server information in any tracked file — this repo is public on GitHub.
- Staging box is an internal, VPN-reachable Ubuntu server behind NAT. App at
  `https://dnsadmin.anglican.site` (PocketBase obtains/renews the Let's
  Encrypt cert itself; HTTP redirects to HTTPS).
- SSH is rate-limited: too many connection attempts in a short window
  triggers a lockout. Use a single multiplexed connection
  (`ControlMaster`/`ControlPath`) for multi-step server work.
- PowerDNS NOTIFYs go to **216.218.130.2** (ns1.he.net);
  216.218.133.2 is the AXFR puller only and refuses NOTIFY (see DEPLOY.md
  troubleshooting).
- The box must have working outbound DNS (`systemd-resolved` enabled with
  stub listener off) or Let's Encrypt issuance breaks.

## Deploying changes

- Frontend: `VITE_API_BASE="" npm run build`, upload `dist/*` to
  `/opt/dns-manager/pb_public/` (owned by `dnsapp:dnsapp`). No service
  restart needed. Back up the previous `pb_public` first.
- Hooks (`pocketbase/pb_hooks/`): copy to `/opt/dns-manager/pb_hooks/`,
  then `systemctl restart dns-manager`.
- Never commit or print secrets (PDNS API key lives in the systemd unit on
  the server; server passwords stay out of the repo).

## Conventions

- Plain JS React (no TypeScript), single stylesheet `src/index.css`
  (light theme, mobile-first; bottom nav under 900px), shared UI kit in
  `src/components/ui.jsx`.
- Keep all API calls/payloads matching the routes table in README.md;
  update both when routes change.
