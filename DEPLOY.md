# Deployment Runbook — Anglican DNS Manager

Complete, from-scratch deployment guide. Written so that anyone can stand up,
operate, or recover this system without prior knowledge of it.

**Staging:** `anglican.site` &nbsp;•&nbsp; **Production (later):** `anglican.org`

## Architecture

```
users / the internet
        │
        ▼  DNS queries (port 53)
Hurricane Electric  ns2–ns5.he.net        ← public, anycast nameservers
        │
        │  AXFR zone transfers + NOTIFY (port 53, TCP+UDP)
        ▼
┌─────────────────────────── VPS ───────────────────────────┐
│  PowerDNS (hidden master)     127.0.0.1:8081 = API        │
│      ▲ REST API                                           │
│  PocketBase (single binary)   :80/:443 public             │
│    • serves the React frontend (pb_public/)               │
│    • custom API routes (pb_hooks/)                        │
│    • users/zones/audit/snapshots DB (pb_data/)            │
└───────────────────────────────────────────────────────────┘
```

Key ideas:

- **PocketBase is the source of truth**: zone rows store the records;
  PowerDNS is a continuously reconciled projection (synced after every
  write, on zone-row changes, every 5 minutes by cron, and via the admin
  panel's **Sync DNS** button). Drift heals toward PocketBase, and a lost
  PowerDNS DB is rebuildable with one sync.
- **Single zone**: every parish's records live *inside* the one parent zone
  (`anglican.site`). A "parish zone" in the app is a permission boundary,
  not a separate DNS zone. Hurricane Electric therefore only ever needs to
  slave **one** zone — the parent — no matter how many parishes exist.
- **Hidden master**: PowerDNS never answers public DNS queries — Hurricane
  Electric's nameservers do. The VPS only serves zone transfers to HE, and
  the web app to admins.
- **Cloudflare variant**: a version of the app that stores records in
  Cloudflare instead of PowerDNS+HE lives on the **`cloudflare` git branch**.

---

## 1. Prerequisites

- A VPS (1 core / 1 GB RAM / any small disk is fine), Ubuntu 24.04 LTS
  assumed below (22.04 works identically).
  Note its public IPv4 — referred to as `VPS_IP` throughout.
- The domain registered at Namecheap.
- A free account at https://dns.he.net.
- Locally: Node.js 18+ to build the frontend.

Pick the admin hostname now. This guide uses `dnsadmin.anglican.site` for the
web app.

## 2. VPS base setup

```bash
apt update && apt upgrade -y
apt install -y ufw sqlite3 curl unzip

# swap (recommended on 1GB RAM)
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# firewall: SSH + web public; port 53 ONLY for Hurricane Electric
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from 216.218.133.2 to any port 53        # slave.dns.he.net (AXFR + SOA checks)
ufw allow from 2001:470:600::2 to any port 53      # same, IPv6
ufw enable
```

Port 53 is deliberately **not** open to the public — HE is the only party
that ever needs it. This makes the DNS server invisible to internet scanners.

## 3. Install & configure PowerDNS

Ubuntu runs `systemd-resolved`, whose stub listener occupies port 53 and
would block PowerDNS from starting. Free the port first (this keeps outbound
DNS resolution working for the VPS itself):

```bash
mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNSStubListener=no\n' > /etc/systemd/resolved.conf.d/no-stub.conf
ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
systemctl enable --now systemd-resolved
systemctl restart systemd-resolved

# verify the VPS can still resolve external names - this MUST work:
dig +short acme-v02.api.letsencrypt.org | head -1
```

> ⚠️ If `systemd-resolved` is disabled on the image, the symlink above
> dangles and the VPS loses **all** outbound DNS resolution. Symptoms:
> Let's Encrypt issuance fails (browser shows a TLS "internal error"
> alert), `apt` and `curl` fail by hostname while raw-IP connections
> work. Fix: `systemctl enable --now systemd-resolved` (with the
> stub-listener override above so port 53 stays free for PowerDNS).

Then install PowerDNS:

```bash
apt install -y pdns-server pdns-backend-sqlite3

# create the database
mkdir -p /var/lib/powerdns
sqlite3 /var/lib/powerdns/pdns.sqlite3 < /usr/share/pdns-backend-sqlite3/schema/schema.sqlite3.sql
chown -R pdns:pdns /var/lib/powerdns
```

Generate an API key and keep it somewhere safe (it goes into both PowerDNS
and the PocketBase service below). The app has **no built-in fallback key**:
if `PDNS_API_KEY` is missing from the service environment, every DNS
operation fails with a clear error rather than running with a guessable key.

```bash
openssl rand -base64 24
```

Replace `/etc/powerdns/pdns.conf` with:

```ini
# ---- backend ----
launch=gsqlite3
gsqlite3-database=/var/lib/powerdns/pdns.sqlite3

# ---- REST API (used by PocketBase hooks; localhost only) ----
api=yes
api-key=PASTE_GENERATED_KEY_HERE
webserver=yes
webserver-address=127.0.0.1
webserver-port=8081
webserver-allow-from=127.0.0.1

# ---- hidden master for Hurricane Electric ----
primary=yes
allow-axfr-ips=216.218.133.2/32,2001:470:600::2
also-notify=216.218.130.2
# NOTIFYs go to ns1.he.net (216.218.130.2). Do NOT notify slave.dns.he.net
# (216.218.133.2) - that host only *initiates* AXFR pulls and refuses
# inbound port 53, so notifications to it fail and changes then wait for
# HE's SOA refresh timer (3 hours).

# ---- listening ----
local-address=0.0.0.0, ::
```

```bash
systemctl restart pdns && systemctl enable pdns

# sanity check the API:
curl -s -H "X-API-Key: PASTE_GENERATED_KEY_HERE" http://127.0.0.1:8081/api/v1/servers/localhost | head -c 200
```

> The default install ships `/etc/powerdns/pdns.d/bind.conf` enabling the
> bind backend — delete anything in `pdns.d/` that references backends other
> than gsqlite3, or PowerDNS will log config errors.

## 4. Install the app (PocketBase)

```bash
useradd -r -m -d /opt/dns-manager -s /usr/sbin/nologin dnsapp
cd /opt/dns-manager

# PocketBase binary (check for newer releases; v0.23+ required)
curl -sL -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.29.3/pocketbase_0.29.3_linux_amd64.zip
unzip pb.zip pocketbase && rm pb.zip
```

Copy from this repository onto the VPS (e.g. `scp -r pocketbase/pb_hooks pocketbase/pb_migrations root@VPS_IP:/opt/dns-manager/`):

- `pocketbase/pb_hooks/`      → `/opt/dns-manager/pb_hooks/`
- `pocketbase/pb_migrations/` → `/opt/dns-manager/pb_migrations/`

Build the frontend **locally** (not on the VPS) and upload it:

```bash
# on your workstation, in the repo:
#   src/config.js: export const API_BASE = "";   ← same-origin, no CORS
npm install && npm run build
scp -r dist/* root@VPS_IP:/opt/dns-manager/pb_public/
```

`API_BASE = ""` works because PocketBase serves the frontend and the API from
the same origin.

Create `/etc/systemd/system/dns-manager.service`:

```ini
[Unit]
Description=Anglican DNS Manager (PocketBase)
After=network-online.target pdns.service
Wants=network-online.target

[Service]
Type=simple
User=dnsapp
Group=dnsapp
WorkingDirectory=/opt/dns-manager
Environment=PDNS_API_URL=http://127.0.0.1:8081/api/v1
Environment=PDNS_API_KEY=PASTE_GENERATED_KEY_HERE
Environment=PDNS_API_SERVER_ID=localhost
Environment=PARENT_DOMAIN=anglican.site
Environment=DEFAULT_NAMESERVERS=ns2.he.net.,ns3.he.net.,ns4.he.net.,ns5.he.net.
Environment=PRIMARY_NAMESERVER=ns2.he.net.
Environment=HOSTMASTER_EMAIL=hostmaster.anglican.site.
ExecStart=/opt/dns-manager/pocketbase serve dnsadmin.anglican.site \
  --http=0.0.0.0:80 --https=0.0.0.0:443 \
  --dir=/opt/dns-manager/pb_data \
  --hooksDir=/opt/dns-manager/pb_hooks \
  --migrationsDir=/opt/dns-manager/pb_migrations \
  --publicDir=/opt/dns-manager/pb_public
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Passing the domain to `serve` makes PocketBase obtain and renew a Let's
Encrypt certificate automatically (this needs `dnsadmin.anglican.site` to
resolve to the VPS first — see step 6; until then the site is reachable on
plain HTTP via `http://VPS_IP`).

```bash
chown -R dnsapp:dnsapp /opt/dns-manager
systemctl daemon-reload
systemctl enable --now dns-manager
journalctl -u dns-manager -f    # watch it come up; migrations apply on first start
```

First-run accounts:

```bash
# PocketBase dashboard superuser (infrastructure access at /_/ - NOT an app user)
sudo -u dnsapp /opt/dns-manager/pocketbase superuser upsert ops@example.org 'STRONG_PASSWORD' --dir=/opt/dns-manager/pb_data
```

Then open the web app and **register the first user — that account
automatically becomes the app admin.** Enable MFA for it on the Security page
immediately.

In the dashboard (`/_/`), configure **SMTP** (Settings → Mail settings) —
it powers self-service "forgot password" links, admin-triggered password
resets, email verification, and notification emails (request
approved/declined, support-ticket activity). Once SMTP is enabled the app
requires a verified email before users can claim zones or file access
requests (the bootstrap admin is auto-verified). Also set the **App URL**
(Settings → Application) so notification emails can link back to the app.
Rate limiting is enabled automatically by migration with per-IP limits on
the auth, MFA and claim endpoints; review or tune it under
Settings → Application.

## 5. Bootstrap the DNS zones

In the web app, logged in as the admin:

> After the first record change, verify the serial machinery end-to-end on
> the VPS: `dig +short SOA anglican.site @127.0.0.1` — the serial
> (`YYYYMMDDnn`) must increase with every saved change (the app creates the
> zone with `SOA-EDIT-API: DEFAULT`, which does this). If it doesn't move,
> see Troubleshooting — without serial bumps, NOTIFYs never fire and HE
> never re-transfers.

1. **Admin Panel → Create New Zone**: zone name `anglican.site`, your admin
   email as owner. (Creating the parent domain itself is allowed. This app
   zone manages **only apex (`@`) records** — every subdomain, including
   infrastructure hostnames, gets its own app zone.)
2. **Create New Zone** again: `dnsadmin.anglican.site`. Open it and add an
   `A` record at the apex (`@`) with value `VPS_IP`. (App zones are
   permission boundaries — in PowerDNS the record still lives inside the
   single parent zone.)

## 6. Hurricane Electric + Namecheap

1. **dns.he.net → Add a new slave**: zone `anglican.site`, master `VPS_IP`.
   Within a minute or two the zone should turn from red to normal —
   check `journalctl -u pdns -f` for the AXFR, or verify:

   ```bash
   dig SOA anglican.site @ns2.he.net +short   # serial must match:
   dig SOA anglican.site @127.0.0.1 +short    # (run on the VPS)
   ```

2. **Namecheap → Domain List → anglican.site → Nameservers → Custom DNS**:

   ```
   ns2.he.net
   ns3.he.net
   ns4.he.net
   ns5.he.net
   ```

3. After propagation (minutes to a few hours):

   ```bash
   dig NS anglican.site +short                 # → ns2-ns5.he.net
   dig A dnsadmin.anglican.site +short         # → VPS_IP
   ```

Once `dnsadmin.anglican.site` resolves publicly, restart the app
(`systemctl restart dns-manager`) so PocketBase can complete the Let's
Encrypt handshake, then use **https://dnsadmin.anglican.site**.

## 7. Ongoing operations

### Adding a parish zone

One step: Admin Panel → Create New Zone (`parish.anglican.site`), approve
the user's request, or bulk-import a zone file. **Nothing is needed at
Hurricane Electric** — parish records live inside the parent zone, which HE
already slaves. Everything (record edits, delegation changes, new parishes)
propagates automatically via NOTIFY, with HE's SOA refresh timer as the
safety net.

### Backups — three layers

| What | How | Where |
|---|---|---|
| App DB (users, zones, audit, snapshots) | PocketBase automatic backup, daily 03:00, keeps 7 (enabled by migration) | `pb_data/backups/`; configure S3 in Dashboard → Settings → Backups for off-site |
| Per-zone record history | Automatic snapshot before every change; restore from the zone's admin page. Snapshots older than 12 months are pruned nightly at 03:30 (each zone's newest is always kept) | inside the app DB (so covered by the backups above) |
| PowerDNS DB | cron job below — belt-and-braces only: PowerDNS is a projection of PocketBase and can be rebuilt with one **Sync DNS** | `/var/backups/pdns/` |

```bash
cat > /etc/cron.daily/pdns-backup <<'EOF'
#!/bin/sh
mkdir -p /var/backups/pdns
sqlite3 /var/lib/powerdns/pdns.sqlite3 ".backup /var/backups/pdns/pdns-$(date +%F).sqlite3"
find /var/backups/pdns -name 'pdns-*.sqlite3' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/pdns-backup
```

### Restore procedures

- **One zone's records were broken:** open the zone as admin → Snapshots →
  Restore. (The pre-restore state is snapshotted too, so this is reversible.)
- **App DB lost/corrupt:** stop `dns-manager`, restore a backup zip from
  `pb_data/backups/` (or the dashboard's Backups UI if it still runs),
  start again.
- **PowerDNS DB lost:** no DNS data is lost — PocketBase is the source of
  truth. Recreate an empty PowerDNS DB (schema import from §3), create the
  parent zone (Admin Panel → Create New Zone, zone name = the parent
  domain — or it may still exist), then hit **Sync DNS** in the admin panel
  (or wait ≤5 min for the reconcile cron): every zone's records are
  re-published in one PATCH. The `/var/backups/pdns/` copies remain as a
  faster alternative: restore one, and the reconciler fixes any staleness
  automatically.
- **Whole VPS lost:** rebuild via this document; restore the PocketBase DB
  from an off-site copy — PowerDNS then repopulates itself via the
  reconciler. HE keeps serving the last transferred zone data for up to
  7 days (SOA expire) — that's your outage window for DNS itself.

### Upgrades

- **PocketBase:** download the new binary, replace `/opt/dns-manager/pocketbase`,
  `systemctl restart dns-manager`. Migrations run automatically. Take a manual
  backup first (Dashboard → Backups).
- **PowerDNS:** `apt upgrade`; config is in `/etc/powerdns/pdns.conf`.
- **Frontend/hooks:** rebuild `dist/` locally → upload to `pb_public/`;
  copy changed `pb_hooks/` files → restart `dns-manager`.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| HE shows the zone red / serial 0 | `journalctl -u pdns` for AXFR attempts; is UFW allowing 216.218.133.2 on 53 **TCP**? Does the VPS IP at HE match the current master IP? |
| Changes not appearing publicly | Compare serials: `dig SOA zone @ns2.he.net +short` vs `@127.0.0.1`. If master is ahead, HE missed the NOTIFY — it self-heals within the refresh interval (3h), or click **Notify HE** in Admin Panel → Zones to re-send it immediately. |
| `journalctl -u pdns` shows "Notification … failed after retries" | NOTIFYs are going to the wrong host. `also-notify` must be `216.218.130.2` (ns1.he.net); `216.218.133.2` refuses inbound port 53. Test: `dig +opcode=notify soa <zone> @216.218.130.2` → expect NOERROR. Can also be set per-zone without touching pdns.conf: `curl -X POST -H "X-API-Key: …" -d '{"kind":"ALSO-NOTIFY","metadata":["216.218.130.2"]}' http://127.0.0.1:8081/api/v1/servers/localhost/zones/<zone>./metadata` |
| App saves succeed but the serial never increments (`dig SOA @127.0.0.1` stays the same, HE never updates even when polling) | The zone's `SOA-EDIT-API` metadata is missing or invalid. It must be `DEFAULT` — **`INCEPTION-INCREMENT` is not a valid SOA-EDIT-API kind and is silently ignored** (it's a transfer-time SOA-EDIT kind). Fix: `curl -X PUT -H "X-API-Key: …" -H 'Content-Type: application/json' -d '{"kind":"Master","soa_edit_api":"DEFAULT"}' http://127.0.0.1:8081/api/v1/servers/localhost/zones/<zone>.` then make any change and confirm the serial bumps. |
| HTTPS fails with TLS "internal error" alert, no cert issued | The VPS can't reach Let's Encrypt — usually broken DNS resolution. `dig +short acme-v02.api.letsencrypt.org` on the VPS must return addresses; see the systemd-resolved warning in §3. Also confirm the domain's public IP forwards 80+443 to the VPS. |
| App 500s on zone pages | `journalctl -u dns-manager`; usually the PDNS API — verify `curl -H "X-API-Key: ..." http://127.0.0.1:8081/api/v1/servers/localhost` and that the key matches the service env. |
| Login issues / audit review | Activity Log in the app records every login, failure, and change with IP. PocketBase's own request log: Dashboard → Logs. |
| Let's Encrypt not issuing | The domain must resolve to the VPS and port 80+443 must be reachable; watch `journalctl -u dns-manager` during startup. |

## 9. Security checklist (before pointing real traffic)

- [ ] Unique `api-key` in pdns.conf, mirrored in the systemd unit (never
      committed). If a key was ever committed or shared, rotate it: new key in
      pdns.conf, update the systemd unit, restart `pdns` + `dns-manager`
- [ ] Port 53 firewalled to HE's transfer IPs only
- [ ] PocketBase dashboard superuser has a strong password (+ store in the team vault)
- [ ] First app user registered, MFA enabled; MFA encouraged/required for all admins
- [ ] SMTP configured (Settings → Mail settings) so password resets and email
      verification work
- [ ] Rate limits (enabled automatically by migration) reviewed under
      Settings → Application
- [ ] S3 off-site backups configured and tested (do one restore drill)
- [ ] SSH: key-only auth, `PasswordAuthentication no`
- [ ] **One-time after deploying the users-API lockdown** (migration
      `1755156000_lock_users_rules`): audit for prior self-elevation — every
      row from
      `sqlite3 /opt/dns-manager/pb_data/data.db "SELECT id,email,is_admin,created FROM users WHERE is_admin=1;"`
      must be a known admin (before the lockdown, any authenticated user
      could set their own `is_admin` via the built-in record API). Also check
      for legacy names the new zone-name normalization would reject:
      `SELECT name FROM zones WHERE name != lower(trim(name));` and the same
      for `zone_requests.zone_name` — fix any hits manually via the
      dashboard (do not mass-rename zones blindly; renames trigger PDNS
      sync)
