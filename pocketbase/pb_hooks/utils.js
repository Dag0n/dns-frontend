// Shared helpers for the DNS manager PocketBase hooks.
//
// SINGLE-ZONE ARCHITECTURE: all parish records live inside the ONE parent
// zone (PARENT_DOMAIN) in PowerDNS. An app "zone" (e.g. parish.anglican.org)
// is a permission boundary in PocketBase plus the subset of parent-zone
// records under that name suffix. This means the parent zone is the only
// zone secondaries (Hurricane Electric) ever need to slave.
//
// - internal parish: its records sit in the parent zone; no NS records
// - external parish: an NS rrset at the parish name delegates it away;
//   no other records are kept under that suffix
//
// NOTE: PocketBase executes each route handler in its own isolated JS VM,
// so this module must be require()-d inside every handler:
//   const u = require(`${__hooks}/utils.js`);

// Values can be overridden via environment variables when starting PocketBase.
function env(name, fallback) {
  const v = $os.getenv(name);
  return v !== "" ? v : fallback;
}

const CFG = {
  // PowerDNS API config
  PDNS_API_URL: env("PDNS_API_URL", "http://127.0.0.1:8081/api/v1"),
  PDNS_API_SERVER_ID: env("PDNS_API_SERVER_ID", "localhost"),
  // No fallback on purpose: the key must come from the environment (systemd
  // unit in production - see DEPLOY.md). pdnsRequest() refuses to run without
  // it so a misconfigured deploy fails loudly instead of using a known key.
  PDNS_API_KEY: env("PDNS_API_KEY", ""),

  // Staging: anglican.site. Later change to anglican.org.
  PARENT_DOMAIN: env("PARENT_DOMAIN", "anglican.site"),
  // Public NS records of the parent zone (comma-separated, trailing dots)
  DEFAULT_NAMESERVERS: env("DEFAULT_NAMESERVERS", "ns2.he.net.,ns3.he.net.,ns4.he.net.,ns5.he.net.")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  PRIMARY_NAMESERVER: env("PRIMARY_NAMESERVER", "ns2.he.net."), // Primary NS for SOA
  HOSTMASTER_EMAIL: env("HOSTMASTER_EMAIL", "hostmaster.anglican.site."), // Admin email for SOA
};

// ---------- PowerDNS ----------

function pdnsRequest(path, method, body) {
  if (!CFG.PDNS_API_KEY) {
    const err = new Error(
      "PDNS_API_KEY is not set - configure it in the service environment (see DEPLOY.md)"
    );
    err.status = 500;
    throw err;
  }
  method = method || "GET";
  const headers = { "X-API-Key": CFG.PDNS_API_KEY };
  if (body) headers["Content-Type"] = "application/json";

  const res = $http.send({
    url: CFG.PDNS_API_URL + path,
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : "",
    timeout: 30,
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    let text = "";
    try {
      text = res.raw !== undefined ? res.raw : toString(res.body);
    } catch (_) {
      /* ignore */
    }
    const err = new Error(`PowerDNS error ${res.statusCode}: ${text}`);
    err.status = res.statusCode;
    throw err;
  }
  if (res.statusCode === 204) return null;
  try {
    return res.json;
  } catch (_) {
    return null;
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function fqdn(zoneName) {
  return zoneName.endsWith(".") ? zoneName : zoneName + ".";
}

function soaSerial() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01"; // YYYYMMDD01
}

// Create the PARENT zone in PowerDNS (one-time bootstrap).
function createParentZone() {
  const full = fqdn(CFG.PARENT_DOMAIN);
  const soaContent = `${CFG.PRIMARY_NAMESERVER} ${CFG.HOSTMASTER_EMAIL} ${soaSerial()} 10800 3600 604800 3600`;

  pdnsRequest(`/servers/${CFG.PDNS_API_SERVER_ID}/zones`, "POST", {
    name: full,
    kind: "Master",
    nameservers: CFG.DEFAULT_NAMESERVERS,
    // Must be "DEFAULT" (YYYYMMDDnn, bumped on every API change). Beware:
    // "INCEPTION-INCREMENT" is only a SOA-EDIT (transfer-time) kind - as a
    // SOA-EDIT-API value PowerDNS silently ignores it, the serial then never
    // increments and secondaries never see any changes.
    soa_edit_api: "DEFAULT",
    rrsets: [
      {
        name: full,
        type: "SOA",
        ttl: 3600,
        records: [{ content: soaContent, disabled: false }],
      },
    ],
  });
}

function parentZonePath() {
  return `/servers/${CFG.PDNS_API_SERVER_ID}/zones/${encodeURIComponent(fqdn(CFG.PARENT_DOMAIN))}`;
}

// All rrsets of the parent zone. Throws {status: 404} if it doesn't exist yet.
function getParentRrsets() {
  const parent = pdnsRequest(parentZonePath());
  return parent.rrsets || [];
}

// Apply rrset changes (changetype REPLACE/DELETE) to the parent zone.
function patchParent(rrsets) {
  if (rrsets.length === 0) return;
  pdnsRequest(parentZonePath(), "PATCH", { rrsets: rrsets });
}

// Queue a DNS NOTIFY for the parent zone to the also-notify targets
// (ns1.he.net), prompting the secondaries to check the serial and AXFR.
// Returns the current SOA serial so the UI can show what was announced.
function notifyParent() {
  pdnsRequest(parentZonePath() + "/notify", "PUT");
  let serial = null;
  try {
    const soa = getParentRrsets().find((rr) => rr.type === "SOA");
    if (soa && soa.records[0]) serial = soa.records[0].content.split(/\s+/)[2];
  } catch (_) {
    /* serial is informational only */
  }
  return serial;
}

// Scoping: which parent-zone records belong to an app zone.
// The parent domain itself is a special app zone covering ONLY apex records.
function subScope(zoneName) {
  const subFqdn = fqdn(zoneName);
  const isParent = zoneName === CFG.PARENT_DOMAIN;
  return {
    subFqdn: subFqdn,
    isParent: isParent,
    matches: function (name) {
      if (isParent) return name === subFqdn;
      return name === subFqdn || name.endsWith("." + subFqdn);
    },
  };
}

// True for rrsets the app never lets users touch directly:
// the SOA, and the NS rrset at the app zone's own name
// (parent apex NS = the public nameservers; sub apex NS = delegation).
function isSystemRrset(rr, scope) {
  if (rr.type === "SOA") return true;
  if (rr.type === "NS" && rr.name === scope.subFqdn) return true;
  return false;
}

// The editable records of an app zone (delegation NS and SOA excluded).
function getSubRecords(allRrsets, scope) {
  return allRrsets.filter((rr) => scope.matches(rr.name) && !isSystemRrset(rr, scope));
}

// ---------- PocketBase-as-source-of-truth sync ----------
//
// PocketBase holds the DESIRED DNS state: each zone row stores its rrsets
// and delegation, the parent-domain row stores the apex records. PowerDNS
// (and via AXFR, Hurricane Electric) is a projection: reconcilePdns()
// assembles the desired parent-zone state from the rows, diffs it against
// what PowerDNS actually serves, and PATCHes only the differences. It runs
// after every app write, from zone record hooks (dashboard edits included)
// and on a cron - so drift always heals toward PocketBase.

function parseZoneRrsets(zone) {
  try {
    return JSON.parse(zone.getString("rrsets")) || [];
  } catch (_) {
    return [];
  }
}

// True when a zone row has never had its rrsets written (rows that predate
// PB-as-truth) and must be ADOPTED from live PowerDNS before any reconcile
// may treat its records as orphans. A NULL json field comes back from
// getString as "null" (not ""), so check every not-a-real-array shape -
// getting this wrong deletes records, so err on the side of "unset".
function rrsetsUnset(zone) {
  const raw = zone.getString("rrsets");
  if (raw === "" || raw === "null" || raw === "undefined") return true;
  try {
    return !Array.isArray(JSON.parse(raw));
  } catch (_) {
    return true;
  }
}

function parseJsonField(record, field) {
  try {
    return JSON.parse(record.getString(field)) || [];
  } catch (_) {
    return [];
  }
}

// Normalize an rrset for storage/publishing (drops changetype/comments,
// quotes bare TXT content - also covers rrsets written straight into rows
// via the dashboard, which bypass the route-level normalization).
function cleanRrset(rr) {
  return {
    name: rr.name,
    type: rr.type,
    ttl: rr.ttl == null ? 3600 : parseInt(rr.ttl, 10),
    records: (rr.records || []).map((r) => ({
      content: normalizeRecordContent(rr.type, r.content),
      disabled: false,
    })),
  };
}

// App routes sync explicitly after their own writes; this briefly silences
// the zones record hooks so those writes don't trigger a second sync.
// Time-boxed (not a flag) so a crash can never leave sync stuck off.
function suppressSyncHooks(seconds) {
  $app.store().set("pdns_sync_suppress_until", Date.now() + seconds * 1000);
}

function syncHooksSuppressed() {
  const until = $app.store().get("pdns_sync_suppress_until");
  return typeof until === "number" && Date.now() < until;
}

// Reconcile PowerDNS with PocketBase. Zone rows whose `rrsets` was never
// set (pre-existing rows) are ADOPTED first: their live PowerDNS records
// are captured into the row, so enabling this on a running instance never
// deletes anything. Throws if PowerDNS is unreachable (callers use
// syncPdns for the never-throws variant).
function reconcilePdns(trigger) {
  const zones = $app.findAllRecords("zones");
  if (zones.length === 0) {
    // Safety valve: an empty (fresh or corrupt) DB must never wipe the
    // parent zone - there is simply nothing to reconcile against.
    return { ok: true, stats: { skipped: "no zones in DB" } };
  }

  const keyOf = (rr) => `${rr.type}||${rr.name}`;
  const actual = getParentRrsets();
  const actualByKey = {};
  for (const rr of actual) actualByKey[keyOf(rr)] = rr;

  // Adoption pass: capture live records for rows that predate PB-truth.
  let adopted = 0;
  for (const zone of zones) {
    if (!rrsetsUnset(zone)) continue;
    const scope = subScope(zone.getString("name"));
    const live = getSubRecords(actual, scope).map(cleanRrset);
    const delegNs = scope.isParent ? null : actualByKey[`NS||${scope.subFqdn}`];
    suppressSyncHooks(10);
    zone.set("rrsets", live);
    if (!scope.isParent) {
      zone.set("delegation_mode", delegNs ? "external" : "internal");
      zone.set("external_ns", delegNs ? delegNs.records.map((r) => r.content) : []);
    }
    $app.save(zone);
    adopted++;
  }

  // Desired parent-zone state from the rows.
  const desired = {};
  let haveParentRow = false;
  const skippedZones = [];
  const parentDotSuffix = "." + fqdn(CFG.PARENT_DOMAIN);
  for (const zone of zones) {
    const zoneName = zone.getString("name");
    // Rows outside the parent's namespace (possible via direct dashboard
    // edits) can never publish into the parent zone - skip them instead of
    // letting one bad row 422 every sync forever.
    if (zoneName !== CFG.PARENT_DOMAIN && !fqdn(zoneName).endsWith(parentDotSuffix)) {
      skippedZones.push(zoneName);
      continue;
    }
    const scope = subScope(zoneName);
    if (scope.isParent) haveParentRow = true;
    if (!scope.isParent && zone.getString("delegation_mode") === "external") {
      const ns = parseJsonField(zone, "external_ns");
      if (ns.length > 0) {
        desired[`NS||${scope.subFqdn}`] = {
          name: scope.subFqdn,
          type: "NS",
          ttl: 3600,
          records: ns.map((c) => ({ content: c, disabled: false })),
        };
      }
      continue; // external zones publish only their delegation NS
    }
    for (const raw of parseZoneRrsets(zone)) {
      if (!raw || !raw.name || !raw.type) continue;
      if (!scope.matches(raw.name) || isSystemRrset(raw, scope)) continue;
      desired[keyOf(raw)] = cleanRrset(raw);
    }
  }

  // Diff desired vs actual. Invalid rrsets (dashboard-written garbage) are
  // NOT patched - but they stay in `desired`, so an existing valid version
  // in PowerDNS is left untouched rather than deleted.
  const contentsKey = (rr) =>
    JSON.stringify(((rr && rr.records) || []).map((r) => r.content).sort());
  const patch = [];
  const skippedRrsets = [];
  let replaced = 0;
  for (const key of Object.keys(desired)) {
    const want = desired[key];
    const have = actualByKey[key];
    if (!have || have.ttl !== want.ttl || contentsKey(have) !== contentsKey(want)) {
      let invalid = !isFqdn(want.name) ? "invalid name" : null;
      if (!invalid) {
        for (const r of want.records) {
          const cerr = validateRecordContent(want.type, r.content);
          if (cerr) {
            invalid = cerr;
            break;
          }
        }
      }
      if (invalid) {
        skippedRrsets.push(`${want.type} ${want.name}: ${invalid}`);
        continue;
      }
      patch.push(Object.assign({ changetype: "REPLACE" }, want));
      replaced++;
    }
  }
  const parentScope = subScope(CFG.PARENT_DOMAIN);
  const deletedKeys = [];
  for (const rr of actual) {
    if (rr.type === "SOA") continue;
    if (isSystemRrset(rr, parentScope)) continue; // apex NS = public nameservers
    if (desired[keyOf(rr)]) continue;
    // Apex records are unmanaged until a parent-domain app zone row exists.
    if (rr.name === fqdn(CFG.PARENT_DOMAIN) && !haveParentRow) continue;
    patch.push({ name: rr.name, type: rr.type, changetype: "DELETE" });
    deletedKeys.push(`${rr.type} ${rr.name}`);
  }

  patchParent(patch);

  const stats = {
    trigger: trigger,
    replaced: replaced,
    deleted: deletedKeys.length,
    adopted: adopted,
    skippedZones: skippedZones.slice(0, 20),
    skippedRrsets: skippedRrsets.slice(0, 20),
  };
  // Skips repeat on every cron run while the bad row exists - only audit
  // them when the skip set changes, so the log isn't flooded.
  const skipSig = JSON.stringify([stats.skippedZones, stats.skippedRrsets]);
  const skipsChanged =
    (skippedZones.length > 0 || skippedRrsets.length > 0) &&
    $app.store().get("pdns_sync_skip_sig") !== skipSig;
  $app.store().set("pdns_sync_skip_sig", skipSig);
  if (patch.length > 0 || adopted > 0 || skipsChanged) {
    console.log("pdns sync:", JSON.stringify(stats), "deleted:", deletedKeys.slice(0, 20).join(", "));
    logAudit(null, null, "pdns_sync", "zone", CFG.PARENT_DOMAIN,
      Object.assign({ deletedKeys: deletedKeys.slice(0, 30) }, stats));
  }
  return { ok: true, stats: stats };
}

// Never-throws wrapper: PocketBase stays the source of truth even when
// PowerDNS is down - the reconcile cron retries until it heals.
function syncPdns(trigger) {
  try {
    return reconcilePdns(trigger);
  } catch (err) {
    console.log(`pdns sync failed (${trigger}):`, err);
    return { ok: false, error: err.message };
  }
}

// Zone details for the UI, straight from the zone row (PowerDNS is only
// consulted the first time, to adopt rows that predate PB-truth).
function getZoneDetails(zoneName) {
  let zone = findZoneByName(zoneName);
  if (!zone) {
    const err = new Error("zone not found in DB");
    err.status = 404;
    throw err;
  }
  if (rrsetsUnset(zone)) {
    syncPdns("lazy-adopt");
    zone = findZoneByName(zoneName);
  }
  const scope = subScope(zoneName);
  const external = !scope.isParent && zone.getString("delegation_mode") === "external";

  return {
    hasInternalZone: !external,
    rrsets: parseZoneRrsets(zone),
    delegation: {
      mode: external ? "external" : "internal",
      externalNs: external ? parseJsonField(zone, "external_ns") : [],
    },
  };
}

// ---------- record validation ----------

// Hostname labels: letters/digits/hyphen plus underscore (service records
// like _dmarc or _acme-challenge need it), optional leading wildcard label.
// Must be fully qualified, i.e. end with a dot.
const FQDN_RE = /^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+$/i;
const IPV4_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function isFqdn(s) {
  return typeof s === "string" && s.length > 1 && s.length <= 254 && FQDN_RE.test(s);
}

function isIPv6(s) {
  if (typeof s !== "string" || !s.length) return false;
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groupsOf = (part) => (part === "" ? [] : part.split(":"));
  const groups = groupsOf(halves[0]).concat(halves.length === 2 ? groupsOf(halves[1]) : []);
  let count = groups.length;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (i === groups.length - 1 && g.includes(".")) {
      // embedded IPv4 tail, e.g. ::ffff:192.0.2.1 (counts as two groups)
      if (!IPV4_RE.test(g)) return false;
      count++;
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return false;
  }
  return halves.length === 2 ? count <= 7 : count === 8;
}

function isIntInRange(v, min, max) {
  if (!/^\d+$/.test(String(v))) return false;
  const n = parseInt(v, 10);
  return n >= min && n <= max;
}

// TXT content must reach PowerDNS quoted; users type it bare.
function normalizeRecordContent(type, content) {
  let c = String(content == null ? "" : content).trim();
  if (type === "TXT" && c && !c.startsWith('"')) {
    c = '"' + c.replace(/"/g, '\\"') + '"';
  }
  return c;
}

// Per-type sanity checks with human-readable messages, so typos come back
// as clear 400s instead of raw PowerDNS 422 errors. Types not listed pass
// through untouched (power users, advanced editor).
function validateRecordContent(type, content) {
  const parts = String(content).trim().split(/\s+/);
  switch (type) {
    case "A":
      return IPV4_RE.test(content) ? null : "must be a valid IPv4 address, e.g. 192.0.2.1";
    case "AAAA":
      return isIPv6(content) ? null : "must be a valid IPv6 address, e.g. 2001:db8::1";
    case "CNAME":
    case "PTR":
    case "NS":
      return isFqdn(content)
        ? null
        : "must be a fully-qualified hostname ending with a dot, e.g. host.example.com.";
    case "MX":
      if (parts.length !== 2 || !isIntInRange(parts[0], 0, 65535)) {
        return 'must be "<priority> <mailserver.>", e.g. 10 mail.example.com.';
      }
      return parts[1] === "." || isFqdn(parts[1])
        ? null
        : "mail server must be a fully-qualified hostname ending with a dot";
    case "SRV":
      if (
        parts.length !== 4 ||
        !isIntInRange(parts[0], 0, 65535) ||
        !isIntInRange(parts[1], 0, 65535) ||
        !isIntInRange(parts[2], 0, 65535)
      ) {
        return 'must be "<priority> <weight> <port> <target.>", e.g. 0 5 443 sip.example.com.';
      }
      return parts[3] === "." || isFqdn(parts[3])
        ? null
        : 'target must be a fully-qualified hostname ending with a dot (or "." for none)';
    case "CAA": {
      if (
        parts.length < 3 ||
        !isIntInRange(parts[0], 0, 255) ||
        !["issue", "issuewild", "iodef"].includes(parts[1])
      ) {
        return 'must be "<flags> <issue|issuewild|iodef> "value"", e.g. 0 issue "letsencrypt.org"';
      }
      const value = parts.slice(2).join(" ");
      return /^".*"$/.test(value) ? null : "value must be wrapped in double quotes";
    }
    default:
      return null;
  }
}

// Store a full copy of an app zone's records so the change can be rolled back.
function snapshotZone(zoneName, rrsets, user, reason) {
  try {
    const col = $app.findCollectionByNameOrId("zone_snapshots");
    const rec = new Record(col);
    rec.set("zone_name", zoneName);
    rec.set("rrsets", rrsets || []);
    if (user) rec.set("user", user.id);
    rec.set("reason", reason || "");
    $app.save(rec);
  } catch (err) {
    console.log("Zone snapshot error:", err);
  }
}

// Replace an app zone's records: validates, snapshots, writes the new state
// to the zone row (the source of truth), then syncs PowerDNS. Deeper
// sub-delegation NS rrsets that were simply omitted are retained - removing
// a delegation must be explicit (changetype DELETE).
// Throws {status: 400} for invalid records or records outside the zone.
function applyRecordUpdate(zoneName, rrsets, user, snapshotReason) {
  const scope = subScope(zoneName);
  if (!findZoneByName(zoneName)) {
    throw badRequest("zone not found in DB");
  }

  for (const rr of rrsets) {
    if (!rr || !rr.name || !rr.type) {
      throw badRequest("each rrset needs a name and type");
    }
    if (!scope.matches(rr.name)) {
      throw badRequest(`record ${rr.name} is outside ${zoneName}`);
    }
    if (rr.type === "SOA") {
      throw badRequest("SOA records are managed automatically");
    }
    if (rr.type === "NS" && rr.name === scope.subFqdn) {
      throw badRequest("use the delegation settings to change nameservers");
    }

    // Validate what will actually be written (DELETEs carry no data).
    if ((rr.changetype || "REPLACE") !== "DELETE") {
      if (!isFqdn(rr.name)) {
        throw badRequest(`${rr.name} is not a valid DNS name`);
      }
      if (rr.ttl != null && !isIntInRange(rr.ttl, 1, 604800)) {
        throw badRequest(`${rr.name}: TTL must be a number between 1 and 604800 seconds`);
      }
      for (const r of rr.records || []) {
        if (!r || typeof r.content !== "string" || !r.content.trim()) {
          throw badRequest(`${rr.type} record at ${rr.name} has empty content`);
        }
        r.content = normalizeRecordContent(rr.type, r.content);
        const contentErr = validateRecordContent(rr.type, r.content);
        if (contentErr) {
          throw badRequest(`${rr.type} record at ${rr.name}: ${contentErr}`);
        }
      }
    }
  }

  // Adopt live records first if this row predates PB-truth, then read the
  // current state from the row - NOT from PowerDNS.
  let zone = findZoneByName(zoneName);
  if (rrsetsUnset(zone)) {
    syncPdns("lazy-adopt");
    zone = findZoneByName(zoneName);
  }
  const current = parseZoneRrsets(zone);

  snapshotZone(zoneName, current, user, snapshotReason || "before update_zone_records");

  // Next state: submitted rrsets, minus explicit DELETEs, plus retained NS.
  const next = {};
  rrsets.forEach((rr) => {
    const key = `${rr.type}||${rr.name}`;
    if ((rr.changetype || "REPLACE") === "DELETE") {
      next[key] = null;
    } else {
      next[key] = cleanRrset(rr);
    }
  });
  current.forEach((rr) => {
    const key = `${rr.type}||${rr.name}`;
    if (rr.type === "NS" && !(key in next)) {
      next[key] = cleanRrset(rr); // omitted sub-delegation: retain
    }
  });
  const nextList = Object.keys(next)
    .map((k) => next[k])
    .filter(Boolean);

  // Compact before/after diff for the audit log.
  const clip = (s) => (String(s).length > 200 ? String(s).slice(0, 200) + "…" : String(s));
  const contentsOf = (rr) => ((rr && rr.records) || []).map((r) => clip(r.content));
  const curByKey = {};
  current.forEach((rr) => {
    curByKey[`${rr.type}||${rr.name}`] = rr;
  });
  const nextByKey = {};
  nextList.forEach((rr) => {
    nextByKey[`${rr.type}||${rr.name}`] = rr;
  });
  const changes = { added: [], removed: [], changed: [] };
  nextList.forEach((rr) => {
    const cur = curByKey[`${rr.type}||${rr.name}`];
    const after = { name: rr.name, type: rr.type, ttl: rr.ttl, records: contentsOf(rr) };
    if (!cur) {
      changes.added.push(after);
      return;
    }
    const beforeRecords = contentsOf(cur);
    const same =
      cur.ttl === rr.ttl &&
      JSON.stringify(beforeRecords.slice().sort()) === JSON.stringify(after.records.slice().sort());
    if (!same) {
      changes.changed.push({
        name: rr.name,
        type: rr.type,
        before: { ttl: cur.ttl, records: beforeRecords },
        after: { ttl: rr.ttl, records: after.records },
      });
    }
  });
  current.forEach((rr) => {
    if (!nextByKey[`${rr.type}||${rr.name}`]) {
      changes.removed.push({
        name: rr.name,
        type: rr.type,
        ttl: rr.ttl,
        records: contentsOf(rr),
      });
    }
  });
  // Keep audit entries bounded even for huge bulk edits.
  ["added", "removed", "changed"].forEach((k) => {
    if (changes[k].length > 30) {
      changes[k] = changes[k].slice(0, 30).concat([{ truncated: true }]);
    }
  });

  // Write the truth, then project it to PowerDNS.
  suppressSyncHooks(10);
  zone.set("rrsets", nextList);
  $app.save(zone);

  const sync = syncPdns("update_zone_records");
  if (!sync.ok) changes.syncFailed = true; // truth saved; cron will heal DNS

  return changes;
}

// Switch an app zone between internal hosting and external delegation.
// PocketBase keeps the zone's rrsets in BOTH modes - external zones just
// don't publish them (only their delegation NS goes to PowerDNS), so a
// delegation round-trip is lossless by construction.
// Returns the number of rrsets republished when switching back to internal.
function applyDelegation(zoneName, mode, externalNs, user) {
  const scope = subScope(zoneName);
  if (scope.isParent) {
    throw badRequest("the parent domain's delegation is managed at the registrar");
  }
  let zone = findZoneByName(zoneName);
  if (!zone) throw badRequest("zone not found in DB");
  if (rrsetsUnset(zone)) {
    syncPdns("lazy-adopt");
    zone = findZoneByName(zoneName);
  }

  let restored = 0;
  if (mode === "external") {
    if (!Array.isArray(externalNs) || externalNs.length === 0) {
      throw badRequest("externalNs array required for external mode");
    }
    const current = parseZoneRrsets(zone);
    if (current.length > 0) {
      snapshotZone(zoneName, current, user, "before switch to external delegation");
    }
    suppressSyncHooks(10);
    zone.set("delegation_mode", "external");
    zone.set("external_ns", externalNs.map((ns) => (ns.endsWith(".") ? ns : ns + ".")));
    $app.save(zone);
  } else {
    suppressSyncHooks(10);
    zone.set("delegation_mode", "internal");
    zone.set("external_ns", []);
    $app.save(zone);
    restored = parseZoneRrsets(zone).length;

    // Legacy fallback: zones delegated away under the pre-PB-truth code had
    // their records deleted from PowerDNS, so the row adopted as empty -
    // recover them from the snapshot taken at the switch.
    if (restored === 0) {
      let snaps = [];
      try {
        snaps = $app.findRecordsByFilter(
          "zone_snapshots",
          "zone_name = {:zone} && reason = 'before switch to external delegation'",
          "-created",
          1,
          0,
          { zone: zoneName }
        );
      } catch (_) {
        /* no snapshot */
      }
      if (snaps.length > 0) {
        let rrsets = [];
        try {
          rrsets = JSON.parse(snaps[0].getString("rrsets")) || [];
        } catch (_) {
          /* unparsable snapshot */
        }
        const restorable = rrsets
          .filter((rr) => rr && rr.name && scope.matches(rr.name) && !isSystemRrset(rr, scope))
          .map(cleanRrset);
        if (restorable.length > 0) {
          suppressSyncHooks(10);
          zone.set("rrsets", restorable);
          $app.save(zone);
          restored = restorable.length;
        }
      }
    }
  }

  syncPdns("update_zone_delegation");
  return restored;
}

// ---------- DB helpers ----------

function requireAdmin(e) {
  return !!(e.auth && e.auth.getBool("is_admin"));
}

// App zones must not nest inside one another: scoping is by name suffix, so
// nested zones would BOTH control the same records - and a save from the
// outer zone would silently delete the inner zone's records (its rrsets are
// never part of the outer owner's submitted set). Returns the name of a
// conflicting existing zone, or null. The parent domain is exempt in both
// directions: its app zone covers only apex records.
function findConflictingZone(zoneName) {
  if (zoneName === CFG.PARENT_DOMAIN) return null;
  const zones = $app.findAllRecords("zones");
  for (const z of zones) {
    const name = z.getString("name");
    if (name === CFG.PARENT_DOMAIN || name === zoneName) continue;
    if (zoneName.endsWith("." + name) || name.endsWith("." + zoneName)) {
      return name;
    }
  }
  return null;
}

// Email-verification gate for self-service actions (zone claiming, access
// requests). Only enforced when SMTP is configured - without it users would
// have no way to verify and would be locked out. Returns an error message
// string, or null when the caller may proceed.
function requireVerifiedEmail(e) {
  if (!$app.settings().smtp.enabled) return null;
  if (e.auth.getBool("verified")) return null;
  return "please verify your email address first - use the verification link we emailed you, or resend it from the Security page";
}

function findZoneByName(name) {
  try {
    return $app.findFirstRecordByFilter("zones", "name = {:name}", { name: name });
  } catch (_) {
    return null;
  }
}

function findUserByEmail(email) {
  try {
    return $app.findAuthRecordByEmail("users", email);
  } catch (_) {
    return null;
  }
}

function userHasZoneAccess(zone, userId) {
  if (!zone) return false;
  if (zone.getString("owner") === userId) return true;
  return zone.getStringSlice("managers").includes(userId);
}

// Zone records the given user owns or manages.
function zonesForUser(userId) {
  return $app.findRecordsByFilter(
    "zones",
    "owner.id = {:uid} || managers.id ?= {:uid}",
    "name",
    0,
    0,
    { uid: userId }
  );
}

// Unambiguous alphabet (no 0/O, 1/I/L) for claim codes read over the phone.
function generateClaimCode() {
  return $security.randomStringWithAlphabet(10, "ABCDEFGHJKMNPQRSTUVWXYZ23456789");
}

// Write an audit entry. `user` is a user Record or null (e.g. failed login
// for an unknown email - the attempted email then goes in details.email and
// is copied to actor_email). The request event `e` provides the client IP.
function logAudit(e, user, action, targetType, targetId, details) {
  try {
    const col = $app.findCollectionByNameOrId("audit_log");
    const rec = new Record(col);
    if (user) {
      rec.set("user", user.id);
      rec.set("actor_email", user.getString("email"));
    } else if (details && details.email) {
      rec.set("actor_email", String(details.email));
    }
    try {
      rec.set("ip", e ? e.realIP() : "");
    } catch (_) {
      /* ip is best-effort */
    }
    rec.set("action", action);
    rec.set("target_type", targetType);
    rec.set("target_id", targetId || "");
    rec.set("details", details ? JSON.stringify(details) : "");
    $app.save(rec);
  } catch (err) {
    console.log("Audit log error:", err);
  }
}

// ---------- email notifications ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// "Open the app" footer link, if the app URL is configured in the
// PocketBase dashboard (Settings -> Application -> App URL).
function appLink() {
  const meta = $app.settings().meta;
  const url = (meta.appURL || "").replace(/\/$/, "");
  return url ? `<p><a href="${url}">Open ${escapeHtml(meta.appName)}</a></p>` : "";
}

// Best-effort notification email: silently does nothing when SMTP is not
// configured, and never throws into the calling route.
function sendNotification(toEmail, subject, html) {
  if (!toEmail) return;
  try {
    if (!$app.settings().smtp.enabled) return;
    const meta = $app.settings().meta;
    const message = new MailerMessage({
      from: { address: meta.senderAddress, name: meta.senderName },
      to: [{ address: toEmail }],
      subject: `[${meta.appName}] ${subject}`,
      html: html,
    });
    $app.newMailClient().send(message);
  } catch (err) {
    console.log("notification email failed:", err);
  }
}

// Notify every admin except (optionally) the acting user.
function notifyAdmins(subject, html, excludeUserId) {
  try {
    const admins = $app.findRecordsByFilter("users", "is_admin = true", "", 0, 0);
    admins
      .filter((a) => a.id !== excludeUserId)
      .forEach((a) => sendNotification(a.getString("email"), subject, html));
  } catch (err) {
    console.log("admin notification failed:", err);
  }
}

// ---------- response shaping ----------

function userPublic(record) {
  return {
    id: record.id,
    email: record.getString("email"),
    is_admin: record.getBool("is_admin"),
    mfa_enabled: record.getBool("mfa_enabled"),
    verified: record.getBool("verified"),
  };
}

// PocketBase autodate format is "2006-01-02 15:04:05.000Z";
// convert to ISO so `new Date(...)` parses it everywhere.
function isoDate(record, field) {
  const v = record.getString(field);
  return v ? v.replace(" ", "T") : v;
}

function auditEntry(record) {
  let email = record.getString("actor_email");
  try {
    $app.expandRecord(record, ["user"], null);
    const user = record.expandedOne("user");
    if (user) email = user.getString("email");
  } catch (_) {
    /* deleted user - actor_email still identifies them */
  }
  return {
    id: record.id,
    action: record.getString("action"),
    target_type: record.getString("target_type"),
    target_id: record.getString("target_id"),
    details: record.getString("details") || null,
    ip: record.getString("ip"),
    created_at: isoDate(record, "created"),
    email: email,
  };
}

module.exports = {
  CFG: CFG,
  pdnsRequest: pdnsRequest,
  badRequest: badRequest,
  fqdn: fqdn,
  soaSerial: soaSerial,
  createParentZone: createParentZone,
  getParentRrsets: getParentRrsets,
  patchParent: patchParent,
  notifyParent: notifyParent,
  subScope: subScope,
  isSystemRrset: isSystemRrset,
  getSubRecords: getSubRecords,
  getZoneDetails: getZoneDetails,
  parseZoneRrsets: parseZoneRrsets,
  rrsetsUnset: rrsetsUnset,
  parseJsonField: parseJsonField,
  cleanRrset: cleanRrset,
  suppressSyncHooks: suppressSyncHooks,
  syncHooksSuppressed: syncHooksSuppressed,
  reconcilePdns: reconcilePdns,
  syncPdns: syncPdns,
  snapshotZone: snapshotZone,
  applyRecordUpdate: applyRecordUpdate,
  applyDelegation: applyDelegation,
  requireAdmin: requireAdmin,
  findConflictingZone: findConflictingZone,
  requireVerifiedEmail: requireVerifiedEmail,
  findZoneByName: findZoneByName,
  findUserByEmail: findUserByEmail,
  userHasZoneAccess: userHasZoneAccess,
  zonesForUser: zonesForUser,
  generateClaimCode: generateClaimCode,
  logAudit: logAudit,
  escapeHtml: escapeHtml,
  appLink: appLink,
  sendNotification: sendNotification,
  notifyAdmins: notifyAdmins,
  userPublic: userPublic,
  isoDate: isoDate,
  auditEntry: auditEntry,
};
