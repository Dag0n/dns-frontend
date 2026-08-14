/// <reference path="../pb_data/types.d.ts" />

// Heavy-auditing expansion:
// - audit_log: user becomes optional (failed logins have no user), adds
//   actor_email + ip so every entry records who/where even without a user
// - zone_snapshots: full copy of a zone's rrsets taken before every change,
//   enabling per-zone rollback
// - enables daily automatic PocketBase backups and 30-day request log retention
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    const auditLog = app.findCollectionByNameOrId("audit_log");
    const userField = auditLog.fields.getByName("user");
    userField.required = false;
    auditLog.fields.add(new TextField({ name: "actor_email" }));
    auditLog.fields.add(new TextField({ name: "ip" }));
    app.save(auditLog);

    const snapshots = new Collection({
      type: "base",
      name: "zone_snapshots",
      fields: [
        { name: "zone_name", type: "text", required: true },
        // full rrsets array as returned by PowerDNS at the time of the change
        { name: "rrsets", type: "json", maxSize: 5242880 },
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1 },
        // why the snapshot was taken, e.g. "before update_zone_records"
        { name: "reason", type: "text" },
        { name: "created", type: "autodate", onCreate: true },
      ],
      indexes: ["CREATE INDEX `idx_zone_snapshots_zone` ON `zone_snapshots` (`zone_name`)"],
    });
    app.save(snapshots);

    // Automatic daily backups at 03:00, keeping the last 7,
    // and keep PocketBase's own request logs for 30 days.
    const settings = app.settings();
    if (!settings.backups.cron) {
      settings.backups.cron = "0 3 * * *";
      settings.backups.cronMaxKeep = 7;
    }
    settings.logs.maxDays = 30;
    app.save(settings);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("zone_snapshots"));
    } catch (_) {
      // already gone
    }
    const auditLog = app.findCollectionByNameOrId("audit_log");
    auditLog.fields.removeByName("actor_email");
    auditLog.fields.removeByName("ip");
    const userField = auditLog.fields.getByName("user");
    userField.required = true;
    app.save(auditLog);
  }
);
