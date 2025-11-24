// src/components/Dashboard.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function Dashboard({ token, onSelectZone, user }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestZoneName, setRequestZoneName] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestStatus, setRequestStatus] = useState({ message: "", type: "" });

  useEffect(() => {
    let cancelled = false;

    async function loadZones() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/zones", { token });
        if (!cancelled) {
          setZones(data.zones || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadZones();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="dashboard">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Welcome back, {user.email.split('@')[0]}</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Zones</div>
            <div className="stat-value">{zones.length}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div className="stat-content">
            <div className="stat-label">DNS Records</div>
            <div className="stat-value">—</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div className="stat-content">
            <div className="stat-label">Delegations</div>
            <div className="stat-value">—</div>
          </div>
        </div>

        {user.is_admin && (
          <div className="stat-card">
            <div className="stat-icon orange">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <line x1="20" y1="8" x2="20" y2="14"/>
                <line x1="23" y1="11" x2="17" y2="11"/>
              </svg>
            </div>
            <div className="stat-content">
              <div className="stat-label">Admin Access</div>
              <div className="stat-value">✓</div>
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Your DNS Zones</h2>
            <p className="muted">Select a zone to manage DNS records and delegation</p>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10 8 16 12 10 16 10 8"/>
          </svg>
        </div>

        {loading && (
          <div className="loading-state">
            <svg className="spinner" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <p>Loading zones...</p>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {!loading && zones.length === 0 && !error && (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <h3>No zones assigned yet</h3>
            <p className="muted">Request access to a subdomain or contact your diocese administrator.</p>
            <button className="btn btn-primary" style={{ marginTop: 'var(--space-lg)' }} onClick={() => setShowRequestModal(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Request Subdomain Access
            </button>
          </div>
        )}

        {!loading && zones.length > 0 && (
          <div className="zone-grid">
            {zones.map((z) => (
              <button
                key={z.id}
                className="zone-card"
                onClick={() => onSelectZone(z.name)}
              >
                <div className="zone-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polygon points="10 8 16 12 10 16 10 8"/>
                  </svg>
                </div>
                <div className="zone-card-content">
                  <div className="zone-card-title">{z.name}</div>
                  <div className="zone-card-subtitle">Click to manage</div>
                </div>
                <svg className="zone-card-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      {!loading && zones.length > 0 && (
        <div className="card">
          <h3>Quick Actions</h3>
          <div className="quick-actions">
            <button className="quick-action-btn" onClick={() => setShowRequestModal(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>Request New Subdomain</span>
            </button>
            <button className="quick-action-btn" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>View Documentation</span>
            </button>
            <button className="quick-action-btn" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <span>Get Support</span>
            </button>
          </div>
        </div>
      )}

      {/* Request Access Modal */}
      {showRequestModal && (
        <div className="modal-overlay" onClick={() => setShowRequestModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request Subdomain Access</h2>
              <button className="modal-close" onClick={() => setShowRequestModal(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setRequestStatus({ message: "", type: "" });
              try {
                await apiRequest("/requests/create", {
                  method: "POST",
                  token,
                  body: { zoneName: requestZoneName.trim(), reason: requestReason.trim() }
                });
                setRequestStatus({ message: "Request submitted successfully! An administrator will review it soon.", type: "success" });
                setRequestZoneName("");
                setRequestReason("");
                setTimeout(() => {
                  setShowRequestModal(false);
                  setRequestStatus({ message: "", type: "" });
                }, 2000);
              } catch (err) {
                setRequestStatus({ message: err.message, type: "error" });
              }
            }}>
              <div className="modal-body">
                {requestStatus.message && (
                  <div className={requestStatus.type === "error" ? "error" : "message"}>
                    {requestStatus.message}
                  </div>
                )}
                <div className="field">
                  <label>
                    <span>Requested Subdomain</span>
                    <input
                      type="text"
                      value={requestZoneName}
                      onChange={(e) => setRequestZoneName(e.target.value)}
                      placeholder="e.g., myparish.rubbish.dev"
                      required
                    />
                  </label>
                  <p className="muted" style={{ marginTop: 'var(--space-xs)' }}>
                    Enter the full subdomain name you'd like to manage
                  </p>
                </div>
                <div className="field">
                  <label>
                    <span>Reason for Request</span>
                    <textarea
                      value={requestReason}
                      onChange={(e) => setRequestReason(e.target.value)}
                      placeholder="Briefly explain why you need access to this subdomain..."
                      rows={4}
                      required
                    />
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowRequestModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
