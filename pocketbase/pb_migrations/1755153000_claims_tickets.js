/// <reference path="../pb_data/types.d.ts" />

// - zones.claim_code: single-use code that lets a parish claim an imported,
//   ownerless zone (hidden so it can never leak through record APIs)
// - tickets / ticket_messages: built-in help desk
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    const zones = app.findCollectionByNameOrId("zones");
    zones.fields.add(new TextField({ name: "claim_code", hidden: true }));
    app.save(zones);

    const tickets = new Collection({
      type: "base",
      name: "tickets",
      fields: [
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true },
        { name: "subject", type: "text", required: true },
        { name: "status", type: "select", values: ["open", "closed"], maxSelect: 1, required: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    app.save(tickets);

    const messages = new Collection({
      type: "base",
      name: "ticket_messages",
      fields: [
        { name: "ticket", type: "relation", collectionId: tickets.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true },
        { name: "message", type: "text", required: true },
        { name: "created", type: "autodate", onCreate: true },
      ],
      indexes: ["CREATE INDEX `idx_ticket_messages_ticket` ON `ticket_messages` (`ticket`)"],
    });
    app.save(messages);
  },
  (app) => {
    ["ticket_messages", "tickets"].forEach((name) => {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // already gone
      }
    });
    const zones = app.findCollectionByNameOrId("zones");
    zones.fields.removeByName("claim_code");
    app.save(zones);
  }
);
