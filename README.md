# Anglican DNS Manager

A web-based DNS management platform for delegating subdomains of a parent
domain (staging: `anglican.site`, production: `anglican.org`) to their own
managers. Users manage records for the zones assigned to them; admins control
zone creation, assignment and access requests.

## Architecture

```
React (Vite) frontend  ──►  PocketBase (auth, data, custom API routes)  ──►  PowerDNS API
                             pb_public/     pb_hooks/  pb_migrations/         (hidden master)
                                                                                   │ AXFR
                                                                                   ▼
                                                                     Hurricane Electric secondaries
                                                                     (public nameservers)
```

- **PocketBase** is the entire backend *and the source of truth*: a single
  binary providing authentication, the SQLite-backed database, and the app's
  API as custom routes in `pocketbase/pb_hooks/`. Every zone row stores its
  own rrsets and delegation state; collections are created automatically by
  the migrations in `pocketbase/pb_migrations/` on first start.
- **Single-zone model**: every parish's records live *inside* the one parent
  zone. An app "zone" (parish.anglican.org) is a permission boundary in
  PocketBase plus the record subset under that name suffix — so secondaries
  only ever slave one zone. External delegation is an NS record set inside
  the parent.
- **PowerDNS is a projection, not a truth store**: a reconciler
  (`reconcilePdns` in `pb_hooks/utils.js`) assembles the desired parent-zone
  state from the zone rows, diffs it against what PowerDNS serves, and
  PATCHes only the differences. It runs after every app write, on any
  zones-row change (PocketBase dashboard edits included), every 5 minutes by
  cron, and on demand via **Sync DNS** in the admin panel — so drift always
  heals toward PocketBase, and a lost PowerDNS DB can be rebuilt from
  scratch with one sync. Zone rows that predate this architecture are
  *adopted* automatically (their live records are captured into the row on
  first sync — nothing is deleted by enabling it). SOA and the apex NS
  records stay PowerDNS/HE-managed and are never touched.
- **PowerDNS** holds the parent zone as a **hidden master** — Hurricane
  Electric's nameservers serve the public via zone transfers (see
  [DEPLOY.md](DEPLOY.md)). The zone is created with `SOA-EDIT-API: DEFAULT`
  so every reconcile that changes something bumps the SOA serial, which is
  what triggers NOTIFY → AXFR to the secondaries (propagation in seconds;
  details and pitfalls in DEPLOY.md's troubleshooting table). A
  Cloudflare-backed variant lives on the **`cloudflare` branch**.

> **Deploying to a server?** [DEPLOY.md](DEPLOY.md) is the complete runbook:
> Ubuntu VPS setup, PowerDNS install & config, PocketBase as a systemd
> service, Hurricane Electric secondaries, Namecheap, backups and restores.

## Features

- **Authentication**: token-based auth backed by PocketBase; the first
  registered user automatically becomes admin. Self-service password reset
  and email verification once SMTP is configured (Dashboard → Settings →
  Mail settings) — with SMTP on, claiming zones and filing access requests
  require a verified address
- **Two-factor authentication**: opt-in TOTP (authenticator app), set up
  per-user from the Security page; admins can reset a user's MFA after a
  lost device
- **Zone management**: per-zone record editing (A, AAAA, CNAME, MX, TXT, SRV,
  CAA, and more), basic table editor plus an advanced raw-JSON editor.
  Records are validated server-side with human-readable errors (bad IPs,
  unqualified hostnames, malformed MX/SRV/CAA) and TXT content is quoted
  automatically before it reaches PowerDNS
- **Delegation**: switch a subdomain between internal hosting and external
  nameservers; switching back to internal automatically restores the
  records snapshotted when the zone went external
- **Email notifications** (when SMTP is configured): requesters are told
  when their request is approved or declined; ticket activity notifies the
  other side (new tickets and user replies go to admins, admin replies go
  to the ticket owner)
- **Bulk import**: paste the parent domain's zone file and every subdomain is
  created as an unclaimed zone with a single-use claim code
- **Claim codes**: parishes redeem a code (distributed through a trusted
  diocesan channel) to take ownership of their pre-created zone instantly
- **Access requests**: users request subdomains; admins approve or deny
- **Multi-manager zones**: each zone has an owner plus any number of managers
- **Support tickets**: built-in help desk - users open tickets, admins reply,
  threads reopen on reply
- **Full audit trail**: every mutation and auth event (including failed
  logins) recorded with actor email and IP
- **Rollback**: automatic snapshot of a zone's records before every change,
  restorable by admins from the zone page. Snapshots older than 12 months
  are pruned nightly, always keeping each zone's newest one

## Local development

Prerequisites: Node.js 18+, a [PocketBase](https://pocketbase.io/docs/)
binary (v0.23+), and a PowerDNS server with its API enabled (any dev
instance works).

```bash
git clone <repository-url>
cd dns-frontend
npm install
```

Download the PocketBase binary for your platform from
https://github.com/pocketbase/pocketbase/releases into `pocketbase/`
(the binary and its `pb_data/` are gitignored).

Configuration lives in `pocketbase/pb_hooks/utils.js` with environment
variable overrides:

| Variable | Purpose | Example |
|---|---|---|
| `PDNS_API_URL` | PowerDNS API endpoint | `http://127.0.0.1:8081/api/v1` |
| `PDNS_API_KEY` | PowerDNS API key — **required, no default**; DNS operations fail with a clear error if unset | *(from pdns.conf)* |
| `PDNS_API_SERVER_ID` | PowerDNS server id | `localhost` |
| `PARENT_DOMAIN` | Domain all zones live under | `anglican.site` |
| `DEFAULT_NAMESERVERS` | NS records written for internal zones (comma-separated, trailing dots) | `ns2.he.net.,ns3.he.net.,ns4.he.net.,ns5.he.net.` |
| `PRIMARY_NAMESERVER` | SOA primary NS | `ns2.he.net.` |
| `HOSTMASTER_EMAIL` | SOA hostmaster (DNS form) | `hostmaster.anglican.site.` |

Run the backend and frontend:

```bash
# terminal 1
cd pocketbase && ./pocketbase serve --http 127.0.0.1:8090

# terminal 2 - set src/config.js API_BASE to http://127.0.0.1:8090 first
npm run dev
```

Open http://localhost:5173 and register — the first account becomes admin.
(PocketBase also prompts once to create a *superuser* for its own dashboard
at `/_/`; that account is separate from app users.)

`npm run build` produces `dist/` for production; served from PocketBase's
`pb_public/` directory the app and API share one origin, so set
`API_BASE = ""` in `src/config.js` for deployed builds.

## API

All routes are served by PocketBase from `pocketbase/pb_hooks/main.pb.js`.
Authenticated routes expect the PocketBase auth token in the `Authorization`
header.

| Route | Who | Purpose |
|---|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | public / any user | Auth (login returns `{mfaRequired: true}` when a TOTP code is needed) |
| `POST /auth/forgot-password` | public | Email a password-reset link; always answers ok so it can't be used to probe which emails exist (needs SMTP) |
| `POST /auth/resend-verification` | any user | Resend the email-verification link (needs SMTP) |
| `POST /auth/mfa/setup` / `verify` / `disable` | any user | TOTP second-factor lifecycle |
| `GET /zones`, `GET /zones/{name}` | zone owner/manager | List zones; zone records + delegation |
| `PUT /zones/{name}/records`, `PUT /zones/{name}/delegation` | zone owner/manager | Update records (validated server-side) / switch delegation — switching back to internal restores the pre-external snapshot and returns `restored` (rrset count) |
| `POST /requests/create` | any user | Request a subdomain |
| `GET /requests/mine` | any user | List your own requests |
| `PUT /requests/{id}` | request owner | Edit your request (pending only) |
| `DELETE /requests/{id}` | request owner | Withdraw a request; withdrawing an approved one revokes your zone access |
| `POST /zones/{name}/managers`, `DELETE /zones/{name}/managers/{userId}` | zone owner | Share / unshare your zone with other registered users |
| `POST /zones/{name}/transfer-owner` | zone owner / admin | Hand ownership to an existing manager (previous owner stays as manager) |
| `POST /zones/claim` | any user | Redeem a claim code to take ownership of a zone |
| `POST /admin/zones/import` | admin | Bulk-import a zone file (`dryRun: true` to preview) |
| `GET /admin/zones/claim-codes` | admin | List unclaimed zones and their codes |
| `POST /tickets`, `GET /tickets`, `GET /tickets/{id}` | any user | Support tickets (admins see all) |
| `POST /tickets/{id}/reply`, `POST /tickets/{id}/close` | ticket owner / admin | Reply (reopens if closed) / close |
| `GET /admin/zones`, `POST /admin/zones/create`, `POST /admin/zones/assign` | admin | List zones (`q`/`limit`/`offset` for search + pagination) / create / assign |
| `DELETE /admin/zones/{name}`, `DELETE /admin/zones/{name}/managers/{userId}` | admin | Delete zone / remove a manager |
| `GET /admin/zones/{name}/details`, `PUT .../records`, `PUT .../delegation` | admin | Edit any zone |
| `GET /admin/zones/{name}/snapshots`, `GET .../snapshots/{id}`, `POST .../snapshots/{id}/restore` | admin | List snapshots / full snapshot contents (for the what-changed diff) / roll back |
| `GET /admin/requests`, `POST /admin/requests/{id}/approve` / `deny` | admin | Handle access requests |
| `GET /admin/users`, `PUT /admin/users/{userId}/admin` | admin | List users (`q`/`limit`/`offset` for search + pagination) / toggle admin |
| `DELETE /admin/users/{userId}`, `POST /admin/users/{userId}/reset-password` | admin | Delete a user (their zones become unassigned) / email them a password-reset link (needs SMTP configured in the PocketBase dashboard) |
| `POST /admin/users/{userId}/reset-mfa` | admin | Disable a user's TOTP (lost-device recovery); they can re-enrol from the Security page |
| `POST /admin/sync` | admin | Reconcile PowerDNS with PocketBase now (also runs automatically after writes, on zone-row changes, and every 5 min); returns `{replaced, deleted, adopted}` |
| `POST /admin/notify` | admin | Queue a DNS NOTIFY to the secondaries (HE) so they re-check the zone now; returns the current SOA serial. NOTIFYs also fire automatically on every serial bump |
| `GET /admin/audit-log`, `GET /audit-log/my-zones` | admin / any user | Audit trail (paginated) |

## Database schema (PocketBase collections)

### users (auth collection)
- `email` (unique) with bcrypt-hashed password managed by PocketBase
- `is_admin`: admin flag
- `mfa_enabled`, `mfa_secret` (hidden): TOTP second factor

### zones
- `name`: zone name (e.g. `parish.anglican.site`), unique
- `owner`: relation to users (primary owner; empty = unclaimed)
- `managers`: multi-relation to users (everyone who can edit the zone)
- `claim_code` (hidden): single-use code for claiming an imported zone
- `rrsets` (json): the zone's records — **the source of truth** that the
  reconciler projects into PowerDNS. `""` (never set) means "not yet
  adopted" and is filled from live PowerDNS on first sync; `[]` means
  deliberately empty. External zones keep their rrsets here (unpublished),
  which is why a delegation round-trip is lossless
- `delegation_mode` (`internal`/`external`) and `external_ns` (json):
  delegation state; external publishes only the NS rrset

Zone names may never nest inside one another (no `www.parish.anglican.site`
while `parish.anglican.site` exists, in either creation order): scoping is by
name suffix, so nested zones would both control the same records. Creation,
requests, approval and import all reject such overlaps (the parent domain is
exempt — its app zone covers only apex records).

### zone_requests
- `user`, `zone_name`, `reason`, `status` (pending/approved/denied)

### tickets / ticket_messages
- Help desk: `tickets` (user, subject, open/closed) with threaded
  `ticket_messages` (ticket, user, message)

### audit_log
- `user`: relation to users (empty for failed logins with unknown emails)
- `actor_email`, `ip`: who acted and from where, kept even if the user is deleted
- `action`, `target_type`, `target_id`, `details`: what happened and to what

Logged actions cover every mutation and auth event: register, login,
login_failed, login_mfa_failed, enable/disable/reset_mfa,
password_reset_requested/sent, request_created, request_updated,
request_cancelled, approve/deny_request, create/assign/delete_zone,
transfer_zone_owner, add/remove_zone_manager, update_zone_records,
update_zone_delegation, import_zones, claim_zone, claim_failed,
grant/revoke_admin, delete_user, restore_zone_snapshot,
ticket_created/replied/closed. The reconciler additionally logs `pdns_sync`
(with what it replaced/deleted/adopted) whenever a sync changed anything.

For `update_zone_records`, `details.changes` holds a compact before/after
diff (`added` / `changed` / `removed` rrsets, capped at 30 entries each);
the Activity page renders it as an expandable per-entry diff.

### zone_snapshots
- A full copy of a zone's rrsets stored automatically **before every change**
  (record updates, delegation switches, zone deletion, restores).
- Admins list and restore snapshots from the zone edit page; a restore
  snapshots the current state first, so restores are themselves reversible.
- Switching a zone's delegation back to internal automatically restores the
  "before switch to external delegation" snapshot, so a delegation
  round-trip never strands records.
- **Retention**: a nightly job (03:30) deletes snapshots older than 12
  months, always keeping each zone's most recent snapshot as a last restore
  point.

All collection API rules are locked (superuser-only); access goes exclusively
through the custom routes, which enforce the app's permission model.

## Auditing, backups & rollback

- **App audit trail**: `audit_log` records every auth event and mutation with
  actor email + IP, shown in the app's Activity Log.
- **Request logs**: PocketBase's dashboard (Logs) additionally records every
  HTTP request; retention is set to 30 days.
- **Zone rollback**: `zone_snapshots` captures records before each change —
  per-zone restore for admins on the zone edit page (12-month retention;
  each zone's newest snapshot is always kept).
- **Database backups**: automatic daily PocketBase backups (03:00, keeping 7)
  are enabled by migration, covering users, zones, requests, audit log and
  snapshots. Configure S3 off-site storage under Dashboard → Settings →
  Backups for production.
- **PowerDNS**: a projection of PocketBase — losing its database costs no
  data. Rebuild: create the parent zone, then run **Sync DNS** (or wait for
  the 5-minute reconcile). The backup cron in [DEPLOY.md](DEPLOY.md) remains
  as belt-and-braces.

## Security notes

- Provide the PowerDNS API key via the `PDNS_API_KEY` environment variable —
  never commit it. There is deliberately no fallback: DNS operations refuse
  to run without it
- Auth tokens (PocketBase JWTs) are stored in localStorage; the frontend
  drops the session and returns to the login page on any 401 (expired or
  revoked token) and revalidates the cached user via `/auth/me` on load
- Passwords are hashed with bcrypt by PocketBase; TOTP MFA available
  per-user, with admin-driven reset for lost devices
- Email verification is enforced for zone claiming and access requests
  whenever SMTP is enabled (the first registered user — the bootstrap
  admin — is auto-verified)
- Admin endpoints check `is_admin`; zone endpoints check ownership/management
- Nested zone names are rejected everywhere so no zone can reach into
  another's records
- Rate limiting is enabled automatically by migration (per-IP limits on
  login, registration, password reset, MFA and claim endpoints); tune it
  under Dashboard → Settings → Application
- The PocketBase dashboard (`/_/`) is protected by its own superuser account

## License

MIT License
