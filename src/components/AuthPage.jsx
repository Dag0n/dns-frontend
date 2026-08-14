// src/components/AuthPage.jsx
import { useState } from "react";
import { apiRequest } from "../api";
import { Alert, BrandMark } from "./ui.jsx";

export default function AuthPage({ onAuthSuccess, notice = "" }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setMfaStep(false);
    setOtp("");
    setForgotSent(false);
  };

  const toggleMode = () => switchMode(mode === "login" ? "register" : "login");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (mode === "forgot") {
        await apiRequest("/auth/forgot-password", {
          method: "POST",
          body: { email: email.trim() },
        });
        setForgotSent(true);
        return;
      }
      const body = { email, password };
      if (mfaStep) body.otp = otp.trim();
      const data = await apiRequest(`/auth/${mode}`, {
        method: "POST",
        body,
      });
      if (data.mfaRequired) {
        setMfaStep(true);
        return;
      }
      onAuthSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={52} />
          <div>
            <h1>Anglican DNS</h1>
            <p>
              {mfaStep
                ? "Enter the code from your authenticator app."
                : mode === "forgot"
                ? "Enter your email and we'll send you a reset link."
                : "Manage your parish domain in one place."}
            </p>
          </div>
        </div>

        {!mfaStep && mode !== "forgot" && (
          <div className="tabs" style={{ width: "100%", marginBottom: "1.4rem" }}>
            <button
              className={`tab ${mode === "login" ? "active" : ""}`}
              style={{ flex: 1 }}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              className={`tab ${mode === "register" ? "active" : ""}`}
              style={{ flex: 1 }}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
          </div>
        )}

        {notice && !error && <Alert type="info">{notice}</Alert>}

        <form onSubmit={handleSubmit}>
          {!mfaStep && !forgotSent && (
            <>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@parish.org"
                  required
                  autoComplete="email"
                />
              </label>

              {mode !== "forgot" && (
                <label className="field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                  />
                </label>
              )}
            </>
          )}

          {forgotSent && (
            <Alert type="success">
              If an account exists for that address, a password-reset email is
              on its way. Check your inbox (and spam folder).
            </Alert>
          )}

          {mfaStep && (
            <label className="field">
              <span>Authenticator code</span>
              <input
                className="otp-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                required
                autoFocus
                autoComplete="one-time-code"
                style={{ maxWidth: "100%" }}
              />
            </label>
          )}

          <Alert type="error">{error}</Alert>

          {!forgotSent && (
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : mfaStep
                ? "Verify code"
                : mode === "forgot"
                ? "Send reset link"
                : mode === "login"
                ? "Sign in"
                : "Create account"}
            </button>
          )}

          {mode === "forgot" && (
            <p className="auth-hint">
              <button
                type="button"
                className="link-button"
                onClick={() => switchMode("login")}
              >
                ← Back to sign in
              </button>
            </p>
          )}

          {mfaStep && (
            <p className="auth-hint">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setMfaStep(false);
                  setOtp("");
                  setError("");
                }}
              >
                ← Back to sign in
              </button>
            </p>
          )}
        </form>

        {!mfaStep && mode !== "forgot" && (
          <p className="auth-hint">
            {mode === "login" ? (
              <>
                First time here?{" "}
                <button type="button" className="link-button" onClick={toggleMode}>
                  Create an account
                </button>
                <br />
                <button
                  type="button"
                  className="link-button"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot your password?
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button type="button" className="link-button" onClick={toggleMode}>
                  Back to sign in
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
