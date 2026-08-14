/// <reference path="../pb_data/types.d.ts" />

// Initial schema for the DNS manager:
// - adds is_admin flag to the built-in users auth collection
// - creates zones, zone_requests and audit_log collections
//
// All API rules are left locked (superuser only) on purpose: every access
// path goes through the custom routes in pb_hooks/main.pb.js, which enforce
// the same permission model the old Express server had.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    users.fields.add(
      new BoolField({
        name: "is_admin",
      })
    );
    app.save(users);

    const zones = new Collection({
      type: "base",
      name: "zones",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "owner", type: "relation", collectionId: users.id, maxSelect: 1 },
        { name: "managers", type: "relation", collectionId: users.id, maxSelect: 999 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_zones_name` ON `zones` (`name`)"],
    });
    app.save(zones);

    const zoneRequests = new Collection({
      type: "base",
      name: "zone_requests",
      fields: [
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true },
        { name: "zone_name", type: "text", required: true },
        { name: "reason", type: "text", required: true },
        { name: "status", type: "select", values: ["pending", "approved", "denied"], maxSelect: 1, required: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(zoneRequests);

    const auditLog = new Collection({
      type: "base",
      name: "audit_log",
      fields: [
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true },
        { name: "action", type: "text", required: true },
        { name: "target_type", type: "text", required: true },
        { name: "target_id", type: "text" },
        // stored as a JSON string (same as the old SQLite TEXT column)
        { name: "details", type: "text" },
        { name: "created", type: "autodate", onCreate: true },
      ],
    });
    app.save(auditLog);
  },
  (app) => {
    ["audit_log", "zone_requests", "zones"].forEach((name) => {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // already gone
      }
    });

    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("is_admin");
    app.save(users);
  }
);
