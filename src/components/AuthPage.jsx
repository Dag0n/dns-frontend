// src/components/AuthPage.jsx
import { useState } from "react";
import { apiRequest } from "../api";

export default function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const data = await apiRequest(`/auth/${mode}`, {
        method: "POST",
        body: { email, password },
      });
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
        <h1>Anglican DNS Manager</h1>
        <p className="auth-subtitle">
          Sign in to manage your subdomain DNS records.
        </p>

        <div className="auth-toggle">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>

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

          {error && <p className="error">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Please wait..." : mode === "login" ? "Login" : "Register"}
          </button>
        </form>

        <p className="auth-hint">
          {mode === "login" ? (
            <>
              First time here?{" "}
              <button type="button" className="link-button" onClick={toggleMode}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button type="button" className="link-button" onClick={toggleMode}>
                Back to login
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
