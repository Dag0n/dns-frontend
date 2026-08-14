/// <reference path="../pb_data/types.d.ts" />

// PocketBase becomes the source of truth for DNS data. Each zone row now
// stores its own rrsets and delegation state; PowerDNS is a continuously
// reconciled projection of these rows (see reconcilePdns in pb_hooks/utils.js).
//
// rrsets semantics: "" (never set) = not yet adopted - the reconciler
// captures the zone's live PowerDNS records into the row on first sync;
// "[]" = deliberately empty. This distinction is what makes the switch
// safe on an already-running instance without a manual data migration.
migrate(
  (app) => {
    const zones = app.findCollectionByNameOrId("zones");
    zones.fields.add(
      new JSONField({
        name: "rrsets",
        maxSize: 5242880,
      })
    );
    zones.fields.add(
      new TextField({
        name: "delegation_mode", // "" or "internal" = internal, "external" = delegated away
      })
    );
    zones.fields.add(
      new JSONField({
        name: "external_ns",
        maxSize: 65536,
      })
    );
    app.save(zones);
  },
  (app) => {
    const zones = app.findCollectionByNameOrId("zones");
    zones.fields.removeByName("rrsets");
    zones.fields.removeByName("delegation_mode");
    zones.fields.removeByName("external_ns");
    app.save(zones);
  }
);
