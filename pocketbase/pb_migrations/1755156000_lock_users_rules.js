/// <reference path="../pb_data/types.d.ts" />

// Locks the built-in users record + auth API. Before this, the users
// collection kept PocketBase's stock defaults, which let any authenticated
// user PATCH their own record - including the unprotected is_admin flag
// (privilege escalation to full admin) - plus self-register bypassing
// /auth/register, self-delete bypassing zone detachment, and call
// auth-with-password bypassing the TOTP check in POST /auth/login.
// All user access goes through the custom routes in pb_hooks/main.pb.js,
// which issue tokens with newAuthToken() and validate with
// $apis.requireAuth("users") - neither is affected by these rules. The
// token-gated email confirmation endpoints (verification, password reset)
// are collection-option driven and also unaffected.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    // null disables the built-in auth endpoints (auth-with-password etc.)
    // for non-superusers.
    users.authRule = null;
    // manageRule is already null (stock default) - left untouched.
    app.save(users);
  },
  (app) => {
    // Restore PocketBase stock defaults for the users collection.
    const users = app.findCollectionByNameOrId("users");
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.createRule = "";
    users.updateRule = "id = @request.auth.id";
    users.deleteRule = "id = @request.auth.id";
    users.authRule = "";
    app.save(users);
  }
);
