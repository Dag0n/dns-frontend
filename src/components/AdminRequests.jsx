// src/components/AdminRequests.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState, Chip, statusTone } from "./ui.jsx";

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
      setMessage("Request approved.");
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

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const processedRequests = requests.filter((r) => r.status !== "pending");

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Subdomain requests</h1>
          <p className="muted">Review and approve user requests for subdomain access.</p>
        </div>
      </div>

      {loading && <Loading label="Loading requests…" />}
      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      {!loading && (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Pending ({pendingRequests.length})</h2>
              </div>
            </div>

            {pendingRequests.length === 0 ? (
              <EmptyState icon="check" title="All caught up">
                There are no requests waiting for review.
              </EmptyState>
            ) : (
              <div className="snap-list">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="snap-item" style={{ alignItems: "flex-start" }}>
                    <div className="snap-info" style={{ flex: 1 }}>
                      <div className="snap-when" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                        <code>{req.zone_name}</code>
                        <Chip tone="amber">pending</Chip>
                      </div>
                      <div className="snap-meta" style={{ marginTop: "0.25rem" }}>
                        Requested by {req.email} ·{" "}
                        {new Date(req.created_at).toLocaleString("en-GB", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      {req.reason && (
                        <p style={{ marginTop: "0.4rem", fontSize: "0.9rem", color: "var(--ink-700)" }}>
                          “{req.reason}”
                        </p>
                      )}
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => handleApprove(req.id)}>
                        <Icon name="check" size={15} />
                        Approve
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeny(req.id)}>
                        <Icon name="x" size={15} />
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {processedRequests.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>History</h2>
                  <p className="muted">Previously processed requests.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data responsive">
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
                        <td data-label="Subdomain"><code>{req.zone_name}</code></td>
                        <td data-label="User">{req.email}</td>
                        <td data-label="Status">
                          <Chip tone={statusTone(req.status)}>{req.status}</Chip>
                        </td>
                        <td data-label="Date">
                          {new Date(req.updated_at || req.created_at).toLocaleDateString()}
                        </td>
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
