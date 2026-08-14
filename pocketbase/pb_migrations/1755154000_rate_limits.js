/// <reference path="../pb_data/types.d.ts" />

// Enable rate limiting out of the box (previously a manual dashboard step
// that was easy to forget). Limits are per client IP and target the
// brute-forceable endpoints: login (passwords + TOTP codes), registration,
// password reset, MFA setup/verify and claim-code redemption.
//
// Only applied when rate limiting is still disabled, so operator-tuned
// values are never clobbered. Adjust in Dashboard -> Settings -> Application.
migrate(
  (app) => {
    const settings = app.settings();
    if (settings.rateLimits.enabled) return;

    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      { label: "POST /auth/login", maxRequests: 10, duration: 60 },
      { label: "POST /auth/register", maxRequests: 15, duration: 300 },
      { label: "POST /auth/forgot-password", maxRequests: 5, duration: 300 },
      { label: "POST /auth/resend-verification", maxRequests: 5, duration: 300 },
      { label: "/auth/mfa/", maxRequests: 15, duration: 60 },
      { label: "POST /zones/claim", maxRequests: 10, duration: 300 },
    ];
    app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    settings.rateLimits.enabled = false;
    app.save(settings);
  }
);
