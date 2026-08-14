// src/components/Security.jsx
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest } from "../api";
import { Alert, Loading, Chip } from "./ui.jsx";

export default function Security({ token }) {
  const [mfaEnabled, setMfaEnabled] = useState(null); // null = loading
  const [emailVerified, setEmailVerified] = useState(null); // null = loading
  const [setup, setSetup] = useState(null); // { secret, otpauthUri }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest("/auth/me", { token });
        if (!cancelled) {
          setMfaEnabled(!!data.user.mfa_enabled);
          setEmailVerified(!!data.user.verified);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const resendVerification = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/auth/resend-verification", { method: "POST", token });
      setMessage("Verification email sent — check your inbox, then refresh this page.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/auth/mfa/setup", { method: "POST", token });
      setSetup(data);
      setCode("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/auth/mfa/verify", {
        method: "POST",
        token,
        body: { code: code.trim() },
      });
      setMfaEnabled(true);
      setSetup(null);
      setCode("");
      setMessage("Two-factor authentication is now enabled. You'll be asked for a code at every login.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/auth/mfa/disable", {
        method: "POST",
        token,
        body: { code: code.trim() },
      });
      setMfaEnabled(false);
      setCode("");
      setMessage("Two-factor authentication has been disabled.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Security</h1>
          <p className="muted">Protect your account with two-factor authentication.</p>
        </div>
      </div>

      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      {emailVerified === false && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Email verification</h2>
              <p className="muted">
                Your email address hasn't been verified yet. Claiming a domain
                and requesting subdomains require a verified address.
              </p>
            </div>
            <Chip tone="amber">Unverified</Chip>
          </div>
          <button className="btn btn-primary" onClick={resendVerification} disabled={busy}>
            Send verification email
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2>Two-factor authentication</h2>
            <p className="muted">
              Adds a 6-digit code from an authenticator app (Google
              Authenticator, Authy, 1Password…) to your login.
            </p>
          </div>
          {mfaEnabled !== null && (
            <Chip tone={mfaEnabled ? "green" : "amber"}>
              {mfaEnabled ? "Enabled" : "Disabled"}
            </Chip>
          )}
        </div>

        {mfaEnabled === null && !error && <Loading label="Checking status…" />}

        {mfaEnabled === false && !setup && (
          <button className="btn btn-primary" onClick={startSetup} disabled={busy}>
            Enable two-factor authentication
          </button>
        )}

        {mfaEnabled === false && setup && (
          <div>
            <ol className="muted" style={{ margin: "0 0 0.5rem 1.2rem", lineHeight: 1.9 }}>
              <li>Scan the QR code with your authenticator app</li>
              <li>Enter the 6-digit code it shows to confirm</li>
            </ol>
            <div className="qr-box">
              <QRCodeSVG value={setup.otpauthUri} size={180} />
            </div>
            <p className="muted" style={{ marginBottom: "1rem" }}>
              Can't scan? Enter this secret manually: <code>{setup.secret}</code>
            </p>
            <form onSubmit={confirmSetup} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>6-digit code</span>
                <input
                  className="otp-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  autoFocus
                />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                Confirm &amp; enable
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSetup(null);
                  setCode("");
                  setError("");
                }}
              >
                Cancel
              </button>
            </form>
          </div>
        )}

        {mfaEnabled === true && (
          <form onSubmit={disableMfa} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>Current code</span>
              <input
                className="otp-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                required
              />
            </label>
            <button className="btn btn-danger" type="submit" disabled={busy}>
              Disable two-factor authentication
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
