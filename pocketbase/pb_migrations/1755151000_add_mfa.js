/// <reference path="../pb_data/types.d.ts" />

// Adds opt-in TOTP two-factor auth fields to users.
// mfa_secret is hidden so it can never leak through record APIs.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");

    users.fields.add(
      new BoolField({
        name: "mfa_enabled",
      })
    );
    users.fields.add(
      new TextField({
        name: "mfa_secret",
        hidden: true,
      })
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("mfa_enabled");
    users.fields.removeByName("mfa_secret");
    app.save(users);
  }
);
