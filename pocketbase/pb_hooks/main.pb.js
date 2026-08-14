/// <reference path="../pb_data/types.d.ts" />

// DNS manager API, served by PocketBase.
//
// Data lives in PocketBase collections (see pb_migrations/). DNS operations
// go through the DNS layer in utils.js: all parish records live inside the
// ONE parent zone (single-zone architecture) in PowerDNS, which acts as a
// hidden master behind public secondaries.
// (A Cloudflare-backed variant lives on the `cloudflare` branch.)
//
// PocketBase runs each handler in an isolated VM, so shared helpers are
// require()-d from utils.js inside every handler.

// ---------- AUTH ----------

// First registered user becomes global admin
routerAdd("POST", "/auth/register", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  const email = body.email;
  const password = body.password;
  if (!email || !password) {
    return e.json(400, { error: "email and password required" });
  }

  if (u.findUserByEmail(email)) {
    return e.json(400, { error: "email already in use" });
  }

  const isFirst = $app.countRecords("users") === 0;

  const col = $app.findCollectionByNameOrId("users");
  const rec = new Record(col);
  rec.setEmail(email);
  rec.setPassword(password);
  // The first user (bootstrap admin) is trusted; everyone else verifies by
  // email. Unverified users can still log in, but claiming zones and filing
  // access requests require verification once SMTP is configured (see
  // requireVerifiedEmail in utils.js).
  rec.setVerified(isFirst);
  rec.set("is_admin", isFirst);

  try {
    $app.save(rec);
  } catch (err) {
    return e.json(400, { error: "registration failed: " + err.message });
  }

  if (!isFirst) {
    try {
      $mails.sendRecordVerification($app, rec);
    } catch (err) {
      // SMTP not configured - verification is then not enforced either.
      console.log("verification email failed:", err);
    }
  }

  u.logAudit(e, rec, "register", "user", rec.id, null);

  const token = rec.newAuthToken();
  return e.json(200, { token: token, user: u.userPublic(rec) });
});

routerAdd("POST", "/auth/login", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  const email = body.email;
  const password = body.password;
  if (!email || !password) {
    return e.json(400, { error: "email and password required" });
  }

  const user = u.findUserByEmail(email);
  if (!user || !user.validatePassword(password)) {
    u.logAudit(e, user, "login_failed", "user", user ? user.id : "", { email: email });
    return e.json(401, { error: "invalid credentials" });
  }

  // Second factor (TOTP) for users who enabled it
  if (user.getBool("mfa_enabled")) {
    const totp = require(`${__hooks}/totp.js`);
    if (!body.otp) {
      // password was correct; ask the client for the authenticator code
      return e.json(200, { mfaRequired: true });
    }
    if (!totp.verify(user.getString("mfa_secret"), body.otp)) {
      u.logAudit(e, user, "login_mfa_failed", "user", user.id, null);
      return e.json(401, { error: "invalid authenticator code" });
    }
  }

  u.logAudit(e, user, "login", "user", user.id, null);

  const token = user.newAuthToken();
  return e.json(200, { token: token, user: u.userPublic(user) });
});

// Self-service password reset. Always answers ok so the response doesn't
// reveal whether an account exists. Requires SMTP (PocketBase dashboard,
// Settings -> Mail settings); the reset link uses PocketBase's built-in
// confirmation page.
routerAdd("POST", "/auth/forgot-password", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  const email = (body.email || "").trim();
  if (!email) return e.json(400, { error: "email required" });

  const user = u.findUserByEmail(email);
  if (user) {
    try {
      $mails.sendRecordPasswordReset($app, user);
      u.logAudit(e, user, "password_reset_requested", "user", user.id, null);
    } catch (err) {
      // Most likely SMTP is not configured; don't leak that to the caller.
      console.log("password reset email failed:", err);
    }
  }
  return e.json(200, { ok: true });
});

// ---------- MFA (TOTP) ----------

// Step 1: generate a secret; returns the otpauth:// URI for the QR code.
// MFA is not active until the user confirms a code via /auth/mfa/verify.
routerAdd("POST", "/auth/mfa/setup", (e) => {
  const totp = require(`${__hooks}/totp.js`);

  if (e.auth.getBool("mfa_enabled")) {
    return e.json(400, { error: "MFA is already enabled" });
  }

  const secret = totp.generateSecret();
  e.auth.set("mfa_secret", secret);
  e.auth.set("mfa_enabled", false);
  $app.save(e.auth);

  return e.json(200, {
    secret: secret,
    otpauthUri: totp.otpauthUri(secret, e.auth.getString("email"), "Anglican DNS"),
  });
}, $apis.requireAuth("users"));

// Step 2: confirm a code from the authenticator app to activate MFA.
routerAdd("POST", "/auth/mfa/verify", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const totp = require(`${__hooks}/totp.js`);
  const body = e.requestInfo().body || {};

  if (e.auth.getBool("mfa_enabled")) {
    return e.json(400, { error: "MFA is already enabled" });
  }
  const secret = e.auth.getString("mfa_secret");
  if (!secret) {
    return e.json(400, { error: "run /auth/mfa/setup first" });
  }
  if (!totp.verify(secret, body.code)) {
    return e.json(400, { error: "invalid authenticator code" });
  }

  e.auth.set("mfa_enabled", true);
  $app.save(e.auth);

  u.logAudit(e, e.auth, "enable_mfa", "user", e.auth.id, null);

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Disable MFA (requires a valid current code).
routerAdd("POST", "/auth/mfa/disable", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const totp = require(`${__hooks}/totp.js`);
  const body = e.requestInfo().body || {};

  if (!e.auth.getBool("mfa_enabled")) {
    return e.json(400, { error: "MFA is not enabled" });
  }
  if (!totp.verify(e.auth.getString("mfa_secret"), body.code)) {
    return e.json(400, { error: "invalid authenticator code" });
  }

  e.auth.set("mfa_enabled", false);
  e.auth.set("mfa_secret", "");
  $app.save(e.auth);

  u.logAudit(e, e.auth, "disable_mfa", "user", e.auth.id, null);

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/auth/me", (e) => {
  const u = require(`${__hooks}/utils.js`);
  return e.json(200, { user: u.userPublic(e.auth) });
}, $apis.requireAuth("users"));

// Resend the email-verification link (the verification page itself is
// PocketBase's built-in confirmation page).
routerAdd("POST", "/auth/resend-verification", (e) => {
  if (e.auth.getBool("verified")) {
    return e.json(400, { error: "your email is already verified" });
  }
  try {
    $mails.sendRecordVerification($app, e.auth);
  } catch (err) {
    return e.json(500, {
      error: "could not send the verification email - is SMTP configured in the PocketBase dashboard? (" + err.message + ")",
    });
  }
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- ADMIN ZONE MGMT ----------

routerAdd("GET", "/admin/zones", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const q = (e.request.url.query().get("q") || "").toLowerCase().trim();
  const limit = Math.min(parseInt(e.request.url.query().get("limit") || "25", 10) || 25, 500);
  const offset = parseInt(e.request.url.query().get("offset") || "0", 10) || 0;

  let records = $app.findAllRecords("zones");
  records.sort((a, b) => a.getString("name").localeCompare(b.getString("name")));
  if (q) {
    records = records.filter((zone) => {
      if (zone.getString("name").toLowerCase().includes(q)) return true;
      try {
        $app.expandRecord(zone, ["owner"], null);
        const owner = zone.expandedOne("owner");
        return owner ? owner.getString("email").toLowerCase().includes(q) : false;
      } catch (_) {
        return false;
      }
    });
  }
  const total = records.length;
  records = records.slice(offset, offset + limit);

  const zones = records.map((zone) => {
    let ownerEmail = null;
    let managers = [];
    try {
      $app.expandRecord(zone, ["owner", "managers"], null);
      const owner = zone.expandedOne("owner");
      if (owner) ownerEmail = owner.getString("email");
      managers = (zone.expandedAll("managers") || []).map((m) => ({
        id: m.id,
        email: m.getString("email"),
      }));
    } catch (_) {
      /* dangling relation */
    }
    return {
      id: zone.id,
      name: zone.getString("name"),
      owner_email: ownerEmail,
      managers: managers,
    };
  });

  return e.json(200, { zones: zones, total: total });
}, $apis.requireAuth("users"));

// Assign existing (imported) zone to a user (supports multiple emails)
routerAdd("POST", "/admin/zones/assign", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const body = e.requestInfo().body || {};
  const norm = u.normalizeZoneName(body.zoneName);
  if (norm.error) return e.json(400, { error: norm.error });
  const zoneName = norm.name;

  const emails = Array.isArray(body.email) ? body.email : [body.email];
  if (emails.length === 0 || emails.some((x) => !x)) {
    return e.json(400, { error: "at least one valid email required" });
  }

  const zone = u.findZoneByName(zoneName);
  if (!zone) {
    return e.json(400, { error: "zone not found in DB; did you import it?" });
  }

  const managers = zone.getStringSlice("managers");
  let addedCount = 0;

  for (let i = 0; i < emails.length; i++) {
    const user = u.findUserByEmail(emails[i].trim());
    if (!user) {
      return e.json(400, { error: `user not found: ${emails[i]}` });
    }
    if (!managers.includes(user.id)) {
      managers.push(user.id);
      addedCount++;
    }
    // Only claim ownership for an ownerless zone (e.g. bulk-imported);
    // assigning extra managers must never displace an existing owner
    // (that's what /zones/{name}/transfer-owner is for).
    if (i === 0 && !zone.getString("owner")) {
      zone.set("owner", user.id);
    }
  }

  zone.set("managers", managers);
  $app.save(zone);

  u.logAudit(e, e.auth, "assign_zone", "zone", zoneName, { emails: emails });

  return e.json(200, { ok: true, addedCount: addedCount });
}, $apis.requireAuth("users"));

// Create new zone in PowerDNS + DB and assign to user(s)
routerAdd("POST", "/admin/zones/create", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const body = e.requestInfo().body || {};
  const norm = u.normalizeZoneName(body.zoneName);
  if (norm.error) return e.json(400, { error: norm.error });
  const zoneName = norm.name;

  const emails = Array.isArray(body.email) ? body.email : [body.email];
  if (emails.length === 0 || emails.some((x) => !x)) {
    return e.json(400, { error: "at least one valid email required" });
  }

  if (!zoneName.endsWith("." + u.CFG.PARENT_DOMAIN) && zoneName !== u.CFG.PARENT_DOMAIN) {
    return e.json(400, { error: `zone must be subdomain of ${u.CFG.PARENT_DOMAIN}` });
  }

  // Verify all users exist
  const users = [];
  for (const email of emails) {
    const user = u.findUserByEmail(email.trim());
    if (!user) return e.json(400, { error: `user not found: ${email}` });
    users.push(user);
  }

  if (u.findZoneByName(zoneName)) {
    return e.json(400, { error: "zone already exists in DB (maybe imported)" });
  }

  const conflict = u.findConflictingZone(zoneName);
  if (conflict) {
    return e.json(400, {
      error: `overlaps with existing zone ${conflict} - nested zones are not allowed`,
    });
  }

  try {
    if (zoneName === u.CFG.PARENT_DOMAIN) {
      // one-time bootstrap: create the actual parent zone in PowerDNS
      u.createParentZone();
    } else {
      // single-zone model: a new app zone needs no PowerDNS changes,
      // but the parent zone must exist to hold its future records
      try {
        u.getParentRrsets();
      } catch (err) {
        if (err.status === 404) {
          return e.json(400, {
            error: `parent zone ${u.CFG.PARENT_DOMAIN} does not exist in PowerDNS - create it first (zone name = ${u.CFG.PARENT_DOMAIN})`,
          });
        }
        throw err;
      }
    }

    const col = $app.findCollectionByNameOrId("zones");
    const zone = new Record(col);
    zone.set("name", zoneName);
    zone.set("owner", users[0].id);
    zone.set("managers", users.map((x) => x.id));
    zone.set("delegation_mode", "internal");
    // New sub-zones start deliberately empty ("[]"), which also clears any
    // orphaned records left under that name. The parent-domain row is left
    // unset so its live apex records get adopted instead of wiped.
    if (zoneName !== u.CFG.PARENT_DOMAIN) {
      zone.set("rrsets", []);
    }
    u.suppressSyncHooks(10);
    $app.save(zone);
    u.syncPdns("create_zone");

    u.logAudit(e, e.auth, "create_zone", "zone", zoneName, { emails: emails });

    return e.json(200, { ok: true });
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Remove user from zone (admin only)
routerAdd("DELETE", "/admin/zones/{zoneName}/managers/{userId}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("zoneName");
  const userId = e.request.pathValue("userId");

  const zone = u.findZoneByName(zoneName);
  if (!zone) return e.json(404, { error: "zone not found" });

  const managers = zone.getStringSlice("managers");
  if (!managers.includes(userId)) {
    return e.json(404, { error: "manager not found for this zone" });
  }

  zone.set("managers", managers.filter((id) => id !== userId));
  $app.save(zone);

  u.logAudit(e, e.auth, "remove_zone_manager", "zone", zoneName, { userId: userId });

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Delete zone completely (admin only)
routerAdd("DELETE", "/admin/zones/{zoneName}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("zoneName");

  const zone = u.findZoneByName(zoneName);
  if (!zone) return e.json(404, { error: "zone not found" });

  if (zoneName === u.CFG.PARENT_DOMAIN) {
    return e.json(400, {
      error: "refusing to delete the parent zone - it holds every parish's records",
    });
  }

  try {
    // Snapshot from the row (the source of truth), adopting live records
    // first if this row predates PB-truth.
    let freshZone = zone;
    if (u.rrsetsUnset(zone)) {
      u.syncPdns("lazy-adopt");
      freshZone = u.findZoneByName(zoneName) || zone;
    }
    const current = u.parseZoneRrsets(freshZone);
    if (current.length > 0) {
      u.snapshotZone(zoneName, current, e.auth, "before delete_zone");
    }

    u.suppressSyncHooks(10);
    $app.delete(freshZone);
    // The reconcile removes the zone's records (and any delegation NS)
    // from PowerDNS; if it fails now, the cron heals it.
    u.syncPdns("delete_zone");

    u.logAudit(e, e.auth, "delete_zone", "zone", zoneName, null);

    return e.json(200, { ok: true });
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// ---------- USER ZONE MGMT ----------

// List zones for current user (owner or manager)
routerAdd("GET", "/zones", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zones = u.zonesForUser(e.auth.id).map((z) => ({
    id: z.id,
    name: z.getString("name"),
  }));
  return e.json(200, { zones: zones });
}, $apis.requireAuth("users"));

// Get zone details + delegation
routerAdd("GET", "/zones/{name}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");

  const zone = u.findZoneByName(zoneName);
  if (!u.userHasZoneAccess(zone, e.auth.id)) {
    return e.json(403, { error: "no access to this zone" });
  }

  try {
    const details = u.getZoneDetails(zoneName);
    // Access info so owners can manage sharing from the zone page.
    let ownerEmail = "";
    let managers = [];
    try {
      $app.expandRecord(zone, ["owner", "managers"], null);
      const owner = zone.expandedOne("owner");
      if (owner) ownerEmail = owner.getString("email");
      managers = (zone.expandedAll("managers") || []).map((m) => ({
        id: m.id,
        email: m.getString("email"),
      }));
    } catch (_) {
      /* expansion is best-effort */
    }
    details.access = {
      owner_email: ownerEmail,
      managers: managers,
      is_owner: zone.getString("owner") === e.auth.id,
    };
    return e.json(200, details);
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Add a manager to a zone you own
routerAdd("POST", "/zones/{name}/managers", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");

  const zone = u.findZoneByName(zoneName);
  if (!zone) return e.json(404, { error: "zone not found" });
  if (zone.getString("owner") !== e.auth.id && !e.auth.getBool("is_admin")) {
    return e.json(403, { error: "only the zone owner can manage access" });
  }

  const body = e.requestInfo().body || {};
  const email = (body.email || "").trim();
  if (!email) return e.json(400, { error: "email required" });

  const user = u.findUserByEmail(email);
  if (!user) {
    return e.json(404, { error: "no account with that email — ask them to register first" });
  }
  if (user.id === zone.getString("owner")) {
    return e.json(400, { error: "that user already owns this zone" });
  }

  const managers = zone.getStringSlice("managers");
  if (managers.includes(user.id)) {
    return e.json(400, { error: "that user is already a manager" });
  }
  managers.push(user.id);
  zone.set("managers", managers);
  $app.save(zone);

  u.logAudit(e, e.auth, "add_zone_manager", "zone", zoneName, { email: email });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Remove a manager from a zone you own
routerAdd("DELETE", "/zones/{name}/managers/{userId}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");
  const userId = e.request.pathValue("userId");

  const zone = u.findZoneByName(zoneName);
  if (!zone) return e.json(404, { error: "zone not found" });
  if (zone.getString("owner") !== e.auth.id && !e.auth.getBool("is_admin")) {
    return e.json(403, { error: "only the zone owner can manage access" });
  }

  const managers = zone.getStringSlice("managers");
  if (!managers.includes(userId)) {
    return e.json(404, { error: "that user is not a manager of this zone" });
  }
  zone.set("managers", managers.filter((id) => id !== userId));
  $app.save(zone);

  u.logAudit(e, e.auth, "remove_zone_manager", "zone", zoneName, { userId: userId });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Transfer zone ownership to one of its managers (current owner or admin).
// The previous owner stays on the zone as a manager.
routerAdd("POST", "/zones/{name}/transfer-owner", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");

  const zone = u.findZoneByName(zoneName);
  if (!zone) return e.json(404, { error: "zone not found" });
  const isOwner = zone.getString("owner") === e.auth.id;
  if (!isOwner && !e.auth.getBool("is_admin")) {
    return e.json(403, { error: "only the zone owner can transfer ownership" });
  }

  const body = e.requestInfo().body || {};
  const newOwnerId = (body.userId || "").trim();
  if (!newOwnerId) return e.json(400, { error: "userId required" });

  const managers = zone.getStringSlice("managers");
  if (!managers.includes(newOwnerId)) {
    return e.json(400, { error: "the new owner must already be a manager of this zone" });
  }

  let newOwner;
  try {
    newOwner = $app.findRecordById("users", newOwnerId);
  } catch (_) {
    return e.json(404, { error: "user not found" });
  }

  const oldOwnerId = zone.getString("owner");
  const nextManagers = managers.filter((id) => id !== newOwnerId);
  if (oldOwnerId && !nextManagers.includes(oldOwnerId)) {
    nextManagers.push(oldOwnerId);
  }
  zone.set("owner", newOwnerId);
  zone.set("managers", nextManagers);
  $app.save(zone);

  u.logAudit(e, e.auth, "transfer_zone_owner", "zone", zoneName, {
    newOwner: newOwner.getString("email"),
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Update RRsets (used by the UI basic/advanced editors)
routerAdd("PUT", "/zones/{name}/records", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");

  const zone = u.findZoneByName(zoneName);
  if (!u.userHasZoneAccess(zone, e.auth.id)) {
    return e.json(403, { error: "no access to this zone" });
  }

  const body = e.requestInfo().body || {};
  if (!Array.isArray(body.rrsets)) {
    return e.json(400, { error: "rrsets must be an array" });
  }

  try {
    const changes = u.applyRecordUpdate(zoneName, body.rrsets, e.auth);
    u.logAudit(e, e.auth, "update_zone_records", "zone", zoneName, {
      recordCount: body.rrsets.length,
      changes: changes,
    });
    return e.json(200, { ok: true });
  } catch (err) {
    if (err.status === 400) return e.json(400, { error: err.message });
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Update delegation (internal / external NS)
routerAdd("PUT", "/zones/{name}/delegation", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zoneName = e.request.pathValue("name");

  const zone = u.findZoneByName(zoneName);
  if (!u.userHasZoneAccess(zone, e.auth.id)) {
    return e.json(403, { error: "no access to this zone" });
  }

  const body = e.requestInfo().body || {};

  try {
    const restored = u.applyDelegation(zoneName, body.mode, body.externalNs, e.auth);
    u.logAudit(e, e.auth, "update_zone_delegation", "zone", zoneName, {
      mode: body.mode,
      restoredRrsets: restored,
    });
    return e.json(200, { ok: true, restored: restored });
  } catch (err) {
    if (err.status === 400) return e.json(400, { error: err.message });
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// ---------- SUBDOMAIN ACCESS REQUESTS ----------

// Create a request (any authenticated user)
routerAdd("POST", "/requests/create", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  const norm = u.normalizeZoneName(body.zoneName);
  if (norm.error) return e.json(400, { error: norm.error });
  const zoneName = norm.name;
  const reason = body.reason;
  if (!reason) {
    return e.json(400, { error: "zoneName and reason required" });
  }

  if (!zoneName.endsWith("." + u.CFG.PARENT_DOMAIN) && zoneName !== u.CFG.PARENT_DOMAIN) {
    return e.json(400, { error: `zone must be subdomain of ${u.CFG.PARENT_DOMAIN}` });
  }

  const verifyErr = u.requireVerifiedEmail(e);
  if (verifyErr) return e.json(403, { error: verifyErr });

  const conflict = u.findConflictingZone(zoneName);
  if (conflict) {
    return e.json(400, {
      error: `overlaps with existing zone ${conflict} - nested zones are not allowed`,
    });
  }

  let existing = null;
  try {
    existing = $app.findFirstRecordByFilter(
      "zone_requests",
      "user = {:uid} && zone_name = {:zone} && status = 'pending'",
      { uid: e.auth.id, zone: zoneName }
    );
  } catch (_) {
    /* none */
  }
  if (existing) {
    return e.json(400, { error: "you already have a pending request for this zone" });
  }

  const col = $app.findCollectionByNameOrId("zone_requests");
  const rec = new Record(col);
  rec.set("user", e.auth.id);
  rec.set("zone_name", zoneName);
  rec.set("reason", reason);
  rec.set("status", "pending");
  $app.save(rec);

  u.logAudit(e, e.auth, "request_created", "zone_request", rec.id, { zoneName: zoneName });

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// List the caller's own requests
routerAdd("GET", "/requests/mine", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const records = $app.findRecordsByFilter(
    "zone_requests",
    "user = {:uid}",
    "-created",
    0,
    0,
    { uid: e.auth.id }
  );
  const requests = records.map((r) => ({
    id: r.id,
    zone_name: r.getString("zone_name"),
    reason: r.getString("reason"),
    status: r.getString("status"),
    created_at: u.isoDate(r, "created"),
    updated_at: u.isoDate(r, "updated"),
  }));
  return e.json(200, { requests: requests });
}, $apis.requireAuth("users"));

// Edit your own request while it is still pending
routerAdd("PUT", "/requests/{id}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const id = e.request.pathValue("id");

  let rec;
  try {
    rec = $app.findRecordById("zone_requests", id);
  } catch (_) {
    return e.json(404, { error: "request not found" });
  }
  if (rec.getString("user") !== e.auth.id) {
    return e.json(403, { error: "not your request" });
  }
  if (rec.getString("status") !== "pending") {
    return e.json(400, { error: "only pending requests can be edited" });
  }

  const body = e.requestInfo().body || {};
  const norm = u.normalizeZoneName(body.zoneName);
  if (norm.error) return e.json(400, { error: norm.error });
  const zoneName = norm.name;
  const reason = (body.reason || "").trim();
  if (!reason) {
    return e.json(400, { error: "zoneName and reason required" });
  }
  if (!zoneName.endsWith("." + u.CFG.PARENT_DOMAIN) && zoneName !== u.CFG.PARENT_DOMAIN) {
    return e.json(400, { error: `zone must be subdomain of ${u.CFG.PARENT_DOMAIN}` });
  }
  const conflict = u.findConflictingZone(zoneName);
  if (conflict) {
    return e.json(400, {
      error: `overlaps with existing zone ${conflict} - nested zones are not allowed`,
    });
  }

  rec.set("zone_name", zoneName);
  rec.set("reason", reason);
  $app.save(rec);

  u.logAudit(e, e.auth, "request_updated", "zone_request", rec.id, { zoneName: zoneName });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Withdraw your own request. Withdrawing an APPROVED request also revokes
// your access to the zone (the zone itself stays, unassigned, for admins).
routerAdd("DELETE", "/requests/{id}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const id = e.request.pathValue("id");

  let rec;
  try {
    rec = $app.findRecordById("zone_requests", id);
  } catch (_) {
    return e.json(404, { error: "request not found" });
  }
  if (rec.getString("user") !== e.auth.id) {
    return e.json(403, { error: "not your request" });
  }

  const status = rec.getString("status");
  const zoneName = rec.getString("zone_name");
  let revokedAccess = false;

  if (status === "approved") {
    const zone = u.findZoneByName(zoneName);
    if (zone) {
      if (zone.getString("owner") === e.auth.id) {
        zone.set("owner", "");
        revokedAccess = true;
      }
      const managers = zone.getStringSlice("managers");
      if (managers.includes(e.auth.id)) {
        zone.set("managers", managers.filter((mid) => mid !== e.auth.id));
        revokedAccess = true;
      }
      if (revokedAccess) $app.save(zone);
    }
  }

  $app.delete(rec);

  u.logAudit(e, e.auth, "request_cancelled", "zone_request", id, {
    zoneName: zoneName,
    previousStatus: status,
    revokedAccess: revokedAccess,
  });
  return e.json(200, { ok: true, revokedAccess: revokedAccess });
}, $apis.requireAuth("users"));

// Get all requests (admin only)
routerAdd("GET", "/admin/requests", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const records = $app.findRecordsByFilter("zone_requests", "id != ''", "-created", 0, 0);

  const requests = records.map((r) => {
    let email = "";
    try {
      $app.expandRecord(r, ["user"], null);
      const user = r.expandedOne("user");
      if (user) email = user.getString("email");
    } catch (_) {
      /* deleted user */
    }
    return {
      id: r.id,
      zone_name: r.getString("zone_name"),
      reason: r.getString("reason"),
      status: r.getString("status"),
      created_at: u.isoDate(r, "created"),
      updated_at: u.isoDate(r, "updated"),
      email: email,
    };
  });

  return e.json(200, { requests: requests });
}, $apis.requireAuth("users"));

// Approve request (admin only)
routerAdd("POST", "/admin/requests/{id}/approve", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  let request = null;
  try {
    request = $app.findRecordById("zone_requests", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!request) return e.json(404, { error: "request not found" });
  if (request.getString("status") !== "pending") {
    return e.json(400, { error: "request is not pending" });
  }

  let user = null;
  try {
    user = $app.findRecordById("users", request.getString("user"));
  } catch (_) {
    /* deleted */
  }
  if (!user) return e.json(400, { error: "user not found" });

  // Re-validate the stored name: legacy rows predate normalization, and
  // PARENT_DOMAIN may have changed between filing and approval.
  const norm = u.normalizeZoneName(request.getString("zone_name"));
  if (norm.error) {
    return e.json(400, { error: "stored zone name is invalid: " + norm.error });
  }
  const zoneName = norm.name;
  if (!zoneName.endsWith("." + u.CFG.PARENT_DOMAIN) && zoneName !== u.CFG.PARENT_DOMAIN) {
    return e.json(400, { error: `zone must be subdomain of ${u.CFG.PARENT_DOMAIN}` });
  }
  if (u.findZoneByName(zoneName)) {
    return e.json(400, { error: "zone already exists in DB" });
  }
  // Re-check at approval time: a conflicting zone may have appeared since
  // the request was filed.
  const conflict = u.findConflictingZone(zoneName);
  if (conflict) {
    return e.json(400, {
      error: `overlaps with existing zone ${conflict} - nested zones are not allowed`,
    });
  }

  try {
    // single-zone model: no PowerDNS changes needed, but the parent must exist
    try {
      u.getParentRrsets();
    } catch (err) {
      if (err.status === 404) {
        return e.json(400, {
          error: `parent zone ${u.CFG.PARENT_DOMAIN} does not exist in PowerDNS - create it first`,
        });
      }
      throw err;
    }

    const col = $app.findCollectionByNameOrId("zones");
    const zone = new Record(col);
    zone.set("name", zoneName);
    zone.set("owner", user.id);
    zone.set("managers", [user.id]);
    zone.set("delegation_mode", "internal");
    zone.set("rrsets", []); // deliberately empty; sync clears any orphans
    u.suppressSyncHooks(10);
    $app.save(zone);
    u.syncPdns("approve_request");

    request.set("status", "approved");
    $app.save(request);

    u.logAudit(e, e.auth, "approve_request", "zone_request", request.id, {
      zoneName: zoneName,
      userEmail: user.getString("email"),
    });

    u.sendNotification(
      user.getString("email"),
      `Request approved: ${zoneName}`,
      `<p>Your request for <strong>${u.escapeHtml(zoneName)}</strong> has been approved — ` +
        `you can now manage its DNS records from your dashboard.</p>` +
        u.appLink()
    );

    return e.json(200, { ok: true });
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Deny request (admin only)
routerAdd("POST", "/admin/requests/{id}/deny", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  let request = null;
  try {
    request = $app.findRecordById("zone_requests", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!request) return e.json(404, { error: "request not found" });
  if (request.getString("status") !== "pending") {
    return e.json(400, { error: "request is not pending" });
  }

  request.set("status", "denied");
  $app.save(request);

  u.logAudit(e, e.auth, "deny_request", "zone_request", request.id, {
    zoneName: request.getString("zone_name"),
  });

  try {
    const requester = $app.findRecordById("users", request.getString("user"));
    u.sendNotification(
      requester.getString("email"),
      `Request declined: ${request.getString("zone_name")}`,
      `<p>Your request for <strong>${u.escapeHtml(request.getString("zone_name"))}</strong> was declined. ` +
        `If you think this is a mistake, open a support ticket from the app.</p>` +
        u.appLink()
    );
  } catch (_) {
    /* requester deleted - nothing to notify */
  }

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- USER MANAGEMENT ----------

// Get all users (admin only)
routerAdd("GET", "/admin/users", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const q = (e.request.url.query().get("q") || "").toLowerCase().trim();
  const limit = Math.min(parseInt(e.request.url.query().get("limit") || "25", 10) || 25, 200);
  const offset = parseInt(e.request.url.query().get("offset") || "0", 10) || 0;

  let userRecords = $app.findAllRecords("users");
  userRecords.sort((a, b) => a.getString("email").localeCompare(b.getString("email")));
  if (q) {
    userRecords = userRecords.filter((rec) => rec.getString("email").toLowerCase().includes(q));
  }
  const total = userRecords.length;

  const zones = $app.findAllRecords("zones");

  const users = userRecords.slice(offset, offset + limit).map((rec) => {
    let owned = 0;
    let managed = 0;
    for (const z of zones) {
      if (z.getString("owner") === rec.id) owned++;
      if (z.getStringSlice("managers").includes(rec.id)) managed++;
    }
    return {
      id: rec.id,
      email: rec.getString("email"),
      is_admin: rec.getBool("is_admin"),
      mfa_enabled: rec.getBool("mfa_enabled"),
      owned_zones_count: owned,
      managed_zones_count: managed,
    };
  });

  return e.json(200, { users: users, total: total });
}, $apis.requireAuth("users"));

// Delete a user (admin only). Their zones stay but become unassigned.
routerAdd("DELETE", "/admin/users/{userId}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const userId = e.request.pathValue("userId");
  if (userId === e.auth.id) {
    return e.json(400, { error: "you cannot delete your own account" });
  }

  let user;
  try {
    user = $app.findRecordById("users", userId);
  } catch (_) {
    return e.json(404, { error: "user not found" });
  }
  const email = user.getString("email");

  // Detach from zones first so no dangling relations remain.
  const zones = $app.findAllRecords("zones");
  for (const z of zones) {
    let dirty = false;
    if (z.getString("owner") === userId) {
      z.set("owner", "");
      dirty = true;
    }
    const managers = z.getStringSlice("managers");
    if (managers.includes(userId)) {
      z.set("managers", managers.filter((id) => id !== userId));
      dirty = true;
    }
    if (dirty) $app.save(z);
  }

  $app.delete(user);

  u.logAudit(e, e.auth, "delete_user", "user", userId, { email: email });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Email a password-reset link to a user (admin only). Requires SMTP to be
// configured in the PocketBase dashboard (Settings -> Mail settings).
routerAdd("POST", "/admin/users/{userId}/reset-password", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  let user;
  try {
    user = $app.findRecordById("users", e.request.pathValue("userId"));
  } catch (_) {
    return e.json(404, { error: "user not found" });
  }

  try {
    $mails.sendRecordPasswordReset($app, user);
  } catch (err) {
    return e.json(500, {
      error: "could not send reset email - is SMTP configured in the PocketBase dashboard? (" + err.message + ")",
    });
  }

  u.logAudit(e, e.auth, "password_reset_sent", "user", user.id, { email: user.getString("email") });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Reset a user's MFA (admin only) - the recovery path when someone loses
// their authenticator device. The user can re-enroll from the Security page.
routerAdd("POST", "/admin/users/{userId}/reset-mfa", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  let user;
  try {
    user = $app.findRecordById("users", e.request.pathValue("userId"));
  } catch (_) {
    return e.json(404, { error: "user not found" });
  }
  if (!user.getBool("mfa_enabled")) {
    return e.json(400, { error: "MFA is not enabled for this user" });
  }

  user.set("mfa_enabled", false);
  user.set("mfa_secret", "");
  $app.save(user);

  u.logAudit(e, e.auth, "reset_mfa", "user", user.id, { email: user.getString("email") });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Toggle admin status (admin only)
routerAdd("PUT", "/admin/users/{userId}/admin", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const userId = e.request.pathValue("userId");
  const body = e.requestInfo().body || {};

  if (typeof body.is_admin !== "boolean") {
    return e.json(400, { error: "is_admin must be a boolean" });
  }

  // Prevent removing admin from self
  if (userId === e.auth.id && !body.is_admin) {
    return e.json(400, { error: "Cannot remove admin from yourself" });
  }

  let user = null;
  try {
    user = $app.findRecordById("users", userId);
  } catch (_) {
    /* not found */
  }
  if (!user) return e.json(404, { error: "user not found" });

  user.set("is_admin", body.is_admin);
  $app.save(user);

  u.logAudit(e, e.auth, body.is_admin ? "grant_admin" : "revoke_admin", "user", userId, {
    email: user.getString("email"),
  });

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- ADMIN: EDIT ANY ZONE ----------

// Get any zone details (admin override)
routerAdd("GET", "/admin/zones/{name}/details", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("name");
  const zone = u.findZoneByName(zoneName);
  if (!zone) {
    return e.json(404, { error: "zone not found in DB" });
  }

  try {
    const details = u.getZoneDetails(zoneName);
    let ownerEmail = "";
    let managers = [];
    try {
      $app.expandRecord(zone, ["owner", "managers"], null);
      const owner = zone.expandedOne("owner");
      if (owner) ownerEmail = owner.getString("email");
      managers = (zone.expandedAll("managers") || []).map((m) => ({
        id: m.id,
        email: m.getString("email"),
      }));
    } catch (_) {
      /* expansion is best-effort */
    }
    // Admins get full access controls in the sharing UI.
    details.access = { owner_email: ownerEmail, managers: managers, is_owner: true };
    return e.json(200, details);
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Update any zone records (admin override)
routerAdd("PUT", "/admin/zones/{name}/records", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("name");
  if (!u.findZoneByName(zoneName)) {
    return e.json(404, { error: "zone not found in DB" });
  }

  const body = e.requestInfo().body || {};
  if (!Array.isArray(body.rrsets)) {
    return e.json(400, { error: "rrsets must be an array" });
  }

  try {
    const changes = u.applyRecordUpdate(zoneName, body.rrsets, e.auth);
    u.logAudit(e, e.auth, "update_zone_records", "zone", zoneName, {
      recordCount: body.rrsets.length,
      changes: changes,
    });
    return e.json(200, { ok: true });
  } catch (err) {
    if (err.status === 400) return e.json(400, { error: err.message });
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// Update any zone delegation (admin override)
routerAdd("PUT", "/admin/zones/{name}/delegation", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("name");
  if (!u.findZoneByName(zoneName)) {
    return e.json(404, { error: "zone not found in DB" });
  }

  const body = e.requestInfo().body || {};

  try {
    const restored = u.applyDelegation(zoneName, body.mode, body.externalNs, e.auth);
    u.logAudit(e, e.auth, "update_zone_delegation", "zone", zoneName, {
      mode: body.mode,
      restoredRrsets: restored,
    });
    return e.json(200, { ok: true, restored: restored });
  } catch (err) {
    if (err.status === 400) return e.json(400, { error: err.message });
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// ---------- BULK IMPORT & CLAIMING ----------

// Import a parent-domain zone file: every direct subdomain becomes a zone,
// unclaimed (no owner) with a claim code. Apex records go into the parent
// zone. Subdomains with their own NS records become external delegations.
// Pass dryRun: true to preview without changing anything.
routerAdd("POST", "/admin/zones/import", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const zf = require(`${__hooks}/zonefile.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const body = e.requestInfo().body || {};
  if (!body.zoneFile || typeof body.zoneFile !== "string") {
    return e.json(400, { error: "zoneFile (text) required" });
  }
  const dryRun = !!body.dryRun;

  const parent = u.CFG.PARENT_DOMAIN;
  const parentFqdn = parent + ".";
  const parsed = zf.parse(body.zoneFile, parent);
  const warnings = parsed.warnings.slice();

  // ---- group records: apex vs per-subdomain ----
  const apexRecords = [];
  const subs = {}; // subName -> {records: [], ns: []}
  for (const rec of parsed.records) {
    if (rec.name === parentFqdn) {
      if (rec.type !== "NS") apexRecords.push(rec); // parent NS handled by HE/registrar
      continue;
    }
    if (!rec.name.endsWith("." + parentFqdn)) {
      warnings.push(`outside ${parent}, skipped: ${rec.name}`);
      continue;
    }
    const rel = rec.name.slice(0, rec.name.length - parentFqdn.length - 1);
    const labels = rel.split(".");
    const subName = labels[labels.length - 1] + "." + parent;
    if (!subs[subName]) subs[subName] = { records: [], ns: [] };
    if (rec.type === "NS" && rec.name === subName + ".") {
      subs[subName].ns.push(rec.content);
    } else {
      subs[subName].records.push(rec);
    }
  }

  // ---- build the plan ----
  const plan = [];
  for (const subName of Object.keys(subs).sort()) {
    const entry = subs[subName];
    const isDefaultNs =
      entry.ns.length > 0 &&
      entry.ns.every((ns) => u.CFG.DEFAULT_NAMESERVERS.includes(ns));
    const mode = entry.ns.length > 0 && !isDefaultNs ? "external" : "internal";

    if (u.findZoneByName(subName)) {
      warnings.push(`${subName}: already exists, skipped`);
      continue;
    }
    const conflict = u.findConflictingZone(subName);
    if (conflict) {
      warnings.push(
        `${subName}: overlaps with existing zone ${conflict} (nested zones are not allowed), skipped`
      );
      continue;
    }
    if (mode === "external" && entry.records.length > 0) {
      warnings.push(
        `${subName}: externally delegated - its ${entry.records.length} record(s) live on the external provider and were not imported`
      );
    }
    plan.push({
      name: subName,
      mode: mode,
      externalNs: mode === "external" ? entry.ns : [],
      recordCount: mode === "internal" ? entry.records.length : 0,
      records: mode === "internal" ? entry.records : [],
    });
  }

  const preview = plan.map((p) => ({
    name: p.name,
    mode: p.mode,
    externalNs: p.externalNs,
    recordCount: p.recordCount,
  }));

  if (dryRun) {
    return e.json(200, {
      dryRun: true,
      apexRecordCount: apexRecords.length,
      zones: preview,
      warnings: warnings,
    });
  }

  // ---- execute ----
  try {
    // parent zone must exist in PowerDNS first
    try {
      u.getParentRrsets();
    } catch (err) {
      if (err.status === 404) {
        return e.json(400, {
          error: `parent zone ${parent} does not exist in PowerDNS - create it first (Admin Panel -> Create New Zone, zone name = ${parent})`,
        });
      }
      throw err;
    }

    // PB is the source of truth: the rows carry all record data, then one
    // reconcile projects everything into the parent zone as a single PATCH.
    const zonesCol = $app.findCollectionByNameOrId("zones");
    u.suppressSyncHooks(60); // one sync at the end, not one per row

    // Apex records merge into the parent-domain row (created ownerless if
    // it doesn't exist yet; adopted first if it predates PB-truth).
    const apexRrsets = zf.toRrsets(apexRecords);
    if (apexRrsets.length > 0) {
      let parentZone = u.findZoneByName(parent);
      if (parentZone && u.rrsetsUnset(parentZone)) {
        u.syncPdns("lazy-adopt");
        parentZone = u.findZoneByName(parent);
      }
      if (!parentZone) {
        parentZone = new Record(zonesCol);
        parentZone.set("name", parent);
      }
      const merged = {};
      u.parseZoneRrsets(parentZone).forEach((rr) => {
        merged[`${rr.type}||${rr.name}`] = rr;
      });
      apexRrsets.forEach((rr) => {
        merged[`${rr.type}||${rr.name}`] = u.cleanRrset(rr);
      });
      parentZone.set("rrsets", Object.keys(merged).map((k) => merged[k]));
      $app.save(parentZone);
    }

    const claimCodes = [];
    for (const p of plan) {
      const code = u.generateClaimCode();
      const rec = new Record(zonesCol);
      rec.set("name", p.name);
      rec.set("claim_code", code);
      if (p.mode === "external") {
        rec.set("delegation_mode", "external");
        rec.set("external_ns", p.externalNs);
        rec.set("rrsets", []);
      } else {
        rec.set("delegation_mode", "internal");
        rec.set("rrsets", zf.toRrsets(p.records).map((rr) => u.cleanRrset(rr)));
      }
      $app.save(rec);
      claimCodes.push({ zone: p.name, code: code });
    }

    const sync = u.syncPdns("import_zones");
    if (!sync.ok) {
      warnings.push(
        `zones saved, but publishing to DNS failed (${sync.error}) - the sync retries automatically every few minutes`
      );
    }

    u.logAudit(e, e.auth, "import_zones", "zone", parent, {
      created: plan.length,
      apexRecords: apexRecords.length,
    });

    return e.json(200, {
      created: preview,
      apexRecordCount: apexRecords.length,
      claimCodes: claimCodes,
      warnings: warnings,
    });
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// List unclaimed zones and their claim codes (admin only) - for distributing
// codes to parishes through a trusted channel.
routerAdd("GET", "/admin/zones/claim-codes", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const records = $app.findRecordsByFilter(
    "zones",
    "owner = '' && claim_code != ''",
    "name",
    0,
    0
  );
  return e.json(200, {
    zones: records.map((z) => ({
      id: z.id,
      name: z.getString("name"),
      code: z.getString("claim_code"),
    })),
  });
}, $apis.requireAuth("users"));

// Redeem a claim code: assigns the zone to the current user.
routerAdd("POST", "/zones/claim", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return e.json(400, { error: "code required" });

  const verifyErr = u.requireVerifiedEmail(e);
  if (verifyErr) return e.json(403, { error: verifyErr });

  let zone = null;
  try {
    zone = $app.findFirstRecordByFilter(
      "zones",
      "claim_code = {:code} && claim_code != ''",
      { code: code }
    );
  } catch (_) {
    /* not found */
  }
  if (!zone) {
    u.logAudit(e, e.auth, "claim_failed", "zone", "", { code: code });
    return e.json(400, { error: "invalid or already-used claim code" });
  }

  zone.set("owner", e.auth.id);
  zone.set("managers", [e.auth.id]);
  zone.set("claim_code", ""); // single use
  $app.save(zone);

  u.logAudit(e, e.auth, "claim_zone", "zone", zone.getString("name"), null);

  return e.json(200, { ok: true, zone: zone.getString("name") });
}, $apis.requireAuth("users"));

// ---------- SUPPORT TICKETS ----------

// Create a ticket
routerAdd("POST", "/tickets", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  if (!body.subject || !body.message) {
    return e.json(400, { error: "subject and message required" });
  }

  const ticket = new Record($app.findCollectionByNameOrId("tickets"));
  ticket.set("user", e.auth.id);
  ticket.set("subject", body.subject);
  ticket.set("status", "open");
  $app.save(ticket);

  const msg = new Record($app.findCollectionByNameOrId("ticket_messages"));
  msg.set("ticket", ticket.id);
  msg.set("user", e.auth.id);
  msg.set("message", body.message);
  $app.save(msg);

  u.logAudit(e, e.auth, "ticket_created", "ticket", ticket.id, { subject: body.subject });

  u.notifyAdmins(
    `New ticket: ${body.subject}`,
    `<p><strong>${u.escapeHtml(e.auth.getString("email"))}</strong> opened a support ticket:</p>` +
      `<p><strong>${u.escapeHtml(body.subject)}</strong></p>` +
      `<blockquote>${u.escapeHtml(body.message)}</blockquote>` +
      u.appLink(),
    e.auth.id
  );

  return e.json(200, { ok: true, id: ticket.id });
}, $apis.requireAuth("users"));

// List tickets (own for users, all for admins)
routerAdd("GET", "/tickets", (e) => {
  const u = require(`${__hooks}/utils.js`);

  const records = u.requireAdmin(e)
    ? $app.findRecordsByFilter("tickets", "id != ''", "-updated", 200, 0)
    : $app.findRecordsByFilter("tickets", "user = {:uid}", "-updated", 200, 0, { uid: e.auth.id });

  const tickets = records.map((t) => {
    let email = "";
    try {
      $app.expandRecord(t, ["user"], null);
      const usr = t.expandedOne("user");
      if (usr) email = usr.getString("email");
    } catch (_) {
      /* deleted user */
    }
    return {
      id: t.id,
      subject: t.getString("subject"),
      status: t.getString("status"),
      email: email,
      created_at: u.isoDate(t, "created"),
      updated_at: u.isoDate(t, "updated"),
    };
  });

  return e.json(200, { tickets: tickets });
}, $apis.requireAuth("users"));

// Ticket detail + full message thread
routerAdd("GET", "/tickets/{id}", (e) => {
  const u = require(`${__hooks}/utils.js`);

  let ticket = null;
  try {
    ticket = $app.findRecordById("tickets", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!ticket) return e.json(404, { error: "ticket not found" });
  if (ticket.getString("user") !== e.auth.id && !u.requireAdmin(e)) {
    return e.json(403, { error: "no access to this ticket" });
  }

  const msgs = $app.findRecordsByFilter(
    "ticket_messages",
    "ticket = {:tid}",
    "created",
    500,
    0,
    { tid: ticket.id }
  );

  const messages = msgs.map((m) => {
    let email = "";
    let isAdmin = false;
    try {
      $app.expandRecord(m, ["user"], null);
      const usr = m.expandedOne("user");
      if (usr) {
        email = usr.getString("email");
        isAdmin = usr.getBool("is_admin");
      }
    } catch (_) {
      /* deleted user */
    }
    return {
      id: m.id,
      message: m.getString("message"),
      email: email,
      is_admin: isAdmin,
      created_at: u.isoDate(m, "created"),
    };
  });

  return e.json(200, {
    id: ticket.id,
    subject: ticket.getString("subject"),
    status: ticket.getString("status"),
    created_at: u.isoDate(ticket, "created"),
    messages: messages,
  });
}, $apis.requireAuth("users"));

// Reply to a ticket (replying to a closed ticket reopens it)
routerAdd("POST", "/tickets/{id}/reply", (e) => {
  const u = require(`${__hooks}/utils.js`);
  const body = e.requestInfo().body || {};
  if (!body.message) return e.json(400, { error: "message required" });

  let ticket = null;
  try {
    ticket = $app.findRecordById("tickets", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!ticket) return e.json(404, { error: "ticket not found" });
  if (ticket.getString("user") !== e.auth.id && !u.requireAdmin(e)) {
    return e.json(403, { error: "no access to this ticket" });
  }

  const msg = new Record($app.findCollectionByNameOrId("ticket_messages"));
  msg.set("ticket", ticket.id);
  msg.set("user", e.auth.id);
  msg.set("message", body.message);
  $app.save(msg);

  if (ticket.getString("status") === "closed") {
    ticket.set("status", "open");
  }
  $app.save(ticket); // also bumps `updated` for list sorting

  u.logAudit(e, e.auth, "ticket_replied", "ticket", ticket.id, null);

  // Notify the other side of the conversation (best-effort, needs SMTP).
  const replyHtml =
    `<p>New reply on ticket "<strong>${u.escapeHtml(ticket.getString("subject"))}</strong>" ` +
    `from <strong>${u.escapeHtml(e.auth.getString("email"))}</strong>:</p>` +
    `<blockquote>${u.escapeHtml(body.message)}</blockquote>` +
    u.appLink();
  if (ticket.getString("user") === e.auth.id) {
    u.notifyAdmins(`Ticket reply: ${ticket.getString("subject")}`, replyHtml, e.auth.id);
  } else {
    try {
      const owner = $app.findRecordById("users", ticket.getString("user"));
      u.sendNotification(
        owner.getString("email"),
        `Support reply: ${ticket.getString("subject")}`,
        replyHtml
      );
    } catch (_) {
      /* ticket owner deleted */
    }
  }

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// Close a ticket (owner or admin)
routerAdd("POST", "/tickets/{id}/close", (e) => {
  const u = require(`${__hooks}/utils.js`);

  let ticket = null;
  try {
    ticket = $app.findRecordById("tickets", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!ticket) return e.json(404, { error: "ticket not found" });
  if (ticket.getString("user") !== e.auth.id && !u.requireAdmin(e)) {
    return e.json(403, { error: "no access to this ticket" });
  }

  ticket.set("status", "closed");
  $app.save(ticket);

  u.logAudit(e, e.auth, "ticket_closed", "ticket", ticket.id, null);

  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- ZONE SNAPSHOTS (rollback) ----------

// List snapshots for a zone (admin only)
routerAdd("GET", "/admin/zones/{name}/snapshots", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("name");

  const records = $app.findRecordsByFilter(
    "zone_snapshots",
    "zone_name = {:zone}",
    "-created",
    100,
    0,
    { zone: zoneName }
  );

  const snapshots = records.map((r) => {
    let email = "";
    try {
      $app.expandRecord(r, ["user"], null);
      const user = r.expandedOne("user");
      if (user) email = user.getString("email");
    } catch (_) {
      /* deleted user */
    }
    let recordCount = 0;
    try {
      recordCount = (JSON.parse(r.getString("rrsets")) || []).length;
    } catch (_) {
      /* unparsable */
    }
    return {
      id: r.id,
      zone_name: r.getString("zone_name"),
      reason: r.getString("reason"),
      record_count: recordCount,
      email: email,
      created_at: u.isoDate(r, "created"),
    };
  });

  return e.json(200, { snapshots: snapshots });
}, $apis.requireAuth("users"));

// Full contents of one snapshot, so the UI can show what changed (admin only)
routerAdd("GET", "/admin/zones/{name}/snapshots/{id}", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });
  const zoneName = e.request.pathValue("name");

  let snapshot;
  try {
    snapshot = $app.findRecordById("zone_snapshots", e.request.pathValue("id"));
  } catch (_) {
    return e.json(404, { error: "snapshot not found" });
  }
  if (snapshot.getString("zone_name") !== zoneName) {
    return e.json(404, { error: "snapshot not found for this zone" });
  }

  let rrsets = [];
  try {
    rrsets = JSON.parse(snapshot.getString("rrsets")) || [];
  } catch (_) {
    /* unparsable snapshot */
  }
  return e.json(200, { rrsets: rrsets });
}, $apis.requireAuth("users"));

// Restore a zone's records from a snapshot (admin only).
// The current state is snapshotted first, so a restore can itself be undone.
routerAdd("POST", "/admin/zones/{name}/snapshots/{id}/restore", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const zoneName = e.request.pathValue("name");
  if (!u.findZoneByName(zoneName)) {
    return e.json(404, { error: "zone not found in DB" });
  }

  let snapshot = null;
  try {
    snapshot = $app.findRecordById("zone_snapshots", e.request.pathValue("id"));
  } catch (_) {
    /* not found */
  }
  if (!snapshot || snapshot.getString("zone_name") !== zoneName) {
    return e.json(404, { error: "snapshot not found for this zone" });
  }

  let rrsets;
  try {
    rrsets = JSON.parse(snapshot.getString("rrsets")) || [];
  } catch (_) {
    return e.json(500, { error: "snapshot data is corrupt" });
  }

  try {
    const scope = u.subScope(zoneName);

    // Restoring records implies internal hosting: flip the row's delegation
    // (the reconcile then drops any delegation NS from PowerDNS).
    if (!scope.isParent) {
      const zone = u.findZoneByName(zoneName);
      if (zone.getString("delegation_mode") === "external") {
        u.suppressSyncHooks(10);
        zone.set("delegation_mode", "internal");
        zone.set("external_ns", []);
        $app.save(zone);
      }
    }

    // Older snapshots may contain the system rrsets of the pre-single-zone
    // era (child SOA / apex NS) - filter to restorable records only.
    const restorable = rrsets.filter(
      (rr) => rr && rr.name && scope.matches(rr.name) && !u.isSystemRrset(rr, scope)
    );

    u.applyRecordUpdate(zoneName, restorable, e.auth, "before restore_zone_snapshot");

    u.logAudit(e, e.auth, "restore_zone_snapshot", "zone", zoneName, {
      snapshotId: snapshot.id,
      snapshotDate: u.isoDate(snapshot, "created"),
    });

    return e.json(200, { ok: true });
  } catch (err) {
    console.log(err);
    return e.json(500, { error: err.message });
  }
}, $apis.requireAuth("users"));

// ---------- USERS COLLECTION GUARDS ----------

// Belt-and-braces on top of the locked users API rules (see the
// lock_users_rules migration): even if a rule is ever relaxed, the raw
// record API can never set privileged fields, and password auth must go
// through POST /auth/login so the TOTP check cannot be bypassed. These
// *Request hooks fire only for the built-in /api/collections endpoints,
// never for the $app.save() calls the custom routes use. Superusers are
// exempt so the PocketBase dashboard stays fully usable.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const u = require(`${__hooks}/utils.js`);
    u.assertNoPrivilegedUserFields(e);
  }
  e.next();
}, "users");

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const u = require(`${__hooks}/utils.js`);
    u.assertNoPrivilegedUserFields(e);
  }
  e.next();
}, "users");

onRecordAuthWithPasswordRequest((e) => {
  throw new ForbiddenError("use POST /auth/login");
}, "users");

// ---------- PDNS SYNC (PocketBase is the source of truth) ----------

// Any change to zone rows - including manual edits or deletes in the
// PocketBase dashboard - re-projects PocketBase state onto PowerDNS.
// App routes briefly suppress these hooks because they sync explicitly.
onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.syncHooksSuppressed()) u.syncPdns("zones-hook");
  e.next();
}, "zones");

onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.syncHooksSuppressed()) u.syncPdns("zones-hook");
  e.next();
}, "zones");

onRecordAfterDeleteSuccess((e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.syncHooksSuppressed()) u.syncPdns("zones-hook");
  e.next();
}, "zones");

// Reconcile every 5 minutes: adopts pre-PB-truth rows, heals drift (sqlite
// surgery, restored backups, a PowerDNS rebuilt from scratch) and retries
// syncs that failed while PowerDNS was unreachable.
cronAdd("pdns_reconcile", "*/5 * * * *", () => {
  const u = require(`${__hooks}/utils.js`);
  u.syncPdns("cron");
});

// Manual reconcile (admin) - returns what changed.
routerAdd("POST", "/admin/sync", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const res = u.syncPdns("manual");
  if (!res.ok) return e.json(502, { error: "sync failed: " + res.error });
  return e.json(200, res);
}, $apis.requireAuth("users"));

// Manually queue a DNS NOTIFY to the secondaries (admin). Normally NOTIFYs
// fire automatically on every serial bump; this is the "kick HE now" button
// for when a NOTIFY was missed and you don't want to wait out the SOA
// refresh timer.
routerAdd("POST", "/admin/notify", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  try {
    const serial = u.notifyParent();
    u.logAudit(e, e.auth, "notify_secondaries", "zone", u.CFG.PARENT_DOMAIN, { serial: serial });
    return e.json(200, { ok: true, serial: serial });
  } catch (err) {
    console.log(err);
    return e.json(502, { error: "notify failed: " + err.message });
  }
}, $apis.requireAuth("users"));

// ---------- MAINTENANCE ----------

// Prune zone snapshots older than 12 months so the DB (and its daily
// backups) don't grow forever. Each zone's newest snapshot is always kept,
// even when it's older, so rarely-edited zones never lose their last
// restore point. Runs daily at 03:30, after the 03:00 backup.
cronAdd("prune_zone_snapshots", "30 3 * * *", () => {
  const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000)
    .toISOString()
    .replace("T", " ");
  try {
    $app
      .db()
      .newQuery(
        // The inner SELECT uses SQLite's bare-column-with-MAX behaviour to
        // pick each zone's most recent snapshot id.
        "DELETE FROM zone_snapshots WHERE created < {:cutoff} AND id NOT IN " +
          "(SELECT id FROM (SELECT id, zone_name, MAX(created) FROM zone_snapshots GROUP BY zone_name))"
      )
      .bind({ cutoff: cutoff })
      .execute();
  } catch (err) {
    console.log("snapshot prune error:", err);
  }
});

// ---------- AUDIT LOG ----------

// Get audit log (admin only - all logs)
routerAdd("GET", "/admin/audit-log", (e) => {
  const u = require(`${__hooks}/utils.js`);
  if (!u.requireAdmin(e)) return e.json(403, { error: "Admin only" });

  const query = e.requestInfo().query || {};
  const limit = parseInt(query.limit) || 100;
  const offset = parseInt(query.offset) || 0;

  const records = $app.findRecordsByFilter("audit_log", "id != ''", "-created", limit, offset);
  const logs = records.map((r) => u.auditEntry(r));
  const total = $app.countRecords("audit_log");

  return e.json(200, { logs: logs, total: total, limit: limit, offset: offset });
}, $apis.requireAuth("users"));

// Get audit log for zones user has access to (regular users)
routerAdd("GET", "/audit-log/my-zones", (e) => {
  const u = require(`${__hooks}/utils.js`);

  const query = e.requestInfo().query || {};
  const limit = parseInt(query.limit) || 100;
  const offset = parseInt(query.offset) || 0;

  const zoneNames = u.zonesForUser(e.auth.id).map((z) => z.getString("name"));
  if (zoneNames.length === 0) {
    return e.json(200, { logs: [], total: 0, limit: limit, offset: offset });
  }

  const params = {};
  const conditions = zoneNames.map((name, i) => {
    params["z" + i] = name;
    return `target_id = {:z${i}}`;
  });
  const filter = `target_type = 'zone' && (${conditions.join(" || ")})`;

  const records = $app.findRecordsByFilter("audit_log", filter, "-created", limit, offset, params);
  const logs = records.map((r) => u.auditEntry(r));

  const total = $app.countRecords(
    "audit_log",
    $dbx.hashExp({ target_type: "zone" }),
    $dbx.in("target_id", ...zoneNames)
  );

  return e.json(200, { logs: logs, total: total, limit: limit, offset: offset });
}, $apis.requireAuth("users"));
