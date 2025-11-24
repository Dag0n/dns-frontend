// src/components/AdminRequests.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function AdminRequests({ token }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRequests = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/admin/requests", { token });
      setRequests(data.requests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (requestId) => {
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/requests/${requestId}/approve`, {
        method: "POST",
        token,
      });
      setMessage("Request approved successfully!");
      await loadRequests();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeny = async (requestId) => {
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/requests/${requestId}/deny`, {
        method: "POST",
        token,
      });
      setMessage("Request denied.");
      await loadRequests();
    } catch (err) {
      setError(err.message);
    }
  };

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const processedRequests = requests.filter(r => r.status !== 'pending');

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Subdomain Requests</h1>
          <p className="muted">Review and approve user requests for subdomain access</p>
        </div>
      </div>

      {loading && (
        <div className="loading-state">
          <svg className="spinner" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p>Loading requests...</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {message && <div className="message">{message}</div>}

      {!loading && (
        <>
          {/* Pending Requests */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Pending Requests</h2>
                <p className="muted">These requests need your attention</p>
              </div>
              <div className="stat-badge">
                {pendingRequests.length}
              </div>
            </div>

            {pendingRequests.length === 0 ? (
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <h3>No pending requests</h3>
                <p className="muted">All requests have been processed</p>
              </div>
            ) : (
              <div className="requests-list">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="request-card">
                    <div className="request-icon pending">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div className="request-content">
                      <div className="request-header">
                        <h3>{req.zone_name}</h3>
                        <span className="request-status pending">Pending</span>
                      </div>
                      <p className="request-user">Requested by: {req.user_email}</p>
                      <p className="request-reason">{req.reason}</p>
                      <p className="request-date">
                        {new Date(req.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <div className="request-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() => handleApprove(req.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Approve
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleDeny(req.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Request History */}
          {processedRequests.length > 0 && (
            <div className="card">
              <h2>Request History</h2>
              <p className="muted" style={{ marginBottom: 'var(--space-lg)' }}>Previously processed requests</p>

              <div className="table-wrapper">
                <table className="zones-table">
                  <thead>
                    <tr>
                      <th>Subdomain</th>
                      <th>User</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedRequests.map((req) => (
                      <tr key={req.id}>
                        <td>{req.zone_name}</td>
                        <td>{req.user_email}</td>
                        <td>
                          <span className={`request-status ${req.status}`}>
                            {req.status}
                          </span>
                        </td>
                        <td>{new Date(req.updated_at || req.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
