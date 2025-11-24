// src/components/AuditLog.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function AuditLog({ token, isAdmin }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const loadLogs = async () => {
    setLoading(true);
    setError("");
    try {
      const endpoint = isAdmin ? "/admin/audit-log" : "/audit-log/my-zones";
      const data = await apiRequest(`${endpoint}?limit=${limit}&offset=${offset}`, {
        token,
      });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const formatAction = (action) => {
    const actionMap = {
      create_zone: "Created Zone",
      delete_zone: "Deleted Zone",
      assign_zone: "Assigned Zone",
      remove_zone_manager: "Removed Manager",
      update_zone_records: "Updated Records",
      update_zone_delegation: "Updated Delegation",
      approve_request: "Approved Request",
      deny_request: "Denied Request",
      grant_admin: "Granted Admin",
      revoke_admin: "Revoked Admin",
    };
    return actionMap[action] || action;
  };

  const formatDetails = (details) => {
    if (!details) return null;
    try {
      const parsed = JSON.parse(details);
      return Object.entries(parsed)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${key}: ${value.join(", ")}`;
          }
          return `${key}: ${value}`;
        })
        .join(", ");
    } catch {
      return details;
    }
  };

  const getActionColor = (action) => {
    if (action.includes("create") || action.includes("approve") || action.includes("grant")) {
      return "approved";
    }
    if (action.includes("delete") || action.includes("deny") || action.includes("revoke")) {
      return "denied";
    }
    return "pending";
  };

  const canGoNext = offset + limit < total;
  const canGoPrev = offset > 0;

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p className="muted">
            {isAdmin
              ? "View all system activity and changes"
              : "View activity for your zones"}
          </p>
        </div>
      </div>

      {loading && (
        <div className="loading-state">
          <svg className="spinner" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p>Loading audit log...</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {!loading && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Activity Log</h2>
              <p className="muted">
                Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}{" "}
                entries
              </p>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <h3>No activity yet</h3>
              <p className="muted">Activity will appear here when actions are performed</p>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="zones-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Target</th>
                      <th>User</th>
                      <th>Details</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <span className={`request-status ${getActionColor(log.action)}`}>
                            {formatAction(log.action)}
                          </span>
                        </td>
                        <td>
                          <code style={{ fontSize: "13px" }}>{log.target_id || "-"}</code>
                        </td>
                        <td>{log.email}</td>
                        <td style={{ fontSize: "13px", color: "var(--muted)" }}>
                          {formatDetails(log.details) || "-"}
                        </td>
                        <td>
                          {new Date(log.created_at).toLocaleString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > limit && (
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "var(--space-lg)",
                  paddingTop: "var(--space-lg)",
                  borderTop: "1px solid var(--border-color)"
                }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={!canGoPrev}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Previous
                  </button>
                  <span className="muted">
                    Page {Math.floor(offset / limit) + 1} of{" "}
                    {Math.ceil(total / limit)}
                  </span>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setOffset(offset + limit)}
                    disabled={!canGoNext}
                  >
                    Next
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
