// src/components/AdminUsers.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function AdminUsers({ token, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/admin/users", { token });
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAdmin = async (userId, currentStatus) => {
    if (userId === currentUser.id && currentStatus) {
      setError("You cannot remove admin privileges from yourself");
      return;
    }

    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/users/${userId}/admin`, {
        method: "PUT",
        token,
        body: { is_admin: !currentStatus },
      });
      setMessage(
        currentStatus
          ? "Admin privileges revoked successfully"
          : "Admin privileges granted successfully"
      );
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p className="muted">Manage users and their permissions</p>
        </div>
      </div>

      {loading && (
        <div className="loading-state">
          <svg className="spinner" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p>Loading users...</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {message && <div className="message">{message}</div>}

      {!loading && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2>All Users</h2>
              <p className="muted">Total: {users.length} users</p>
            </div>
          </div>

          {users.length === 0 ? (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <h3>No users found</h3>
              <p className="muted">No users are registered in the system</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="zones-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Owned Zones</th>
                    <th>Managed Zones</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {u.email}
                          {u.id === currentUser.id && (
                            <span className="badge" style={{ fontSize: "11px" }}>You</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {u.is_admin ? (
                          <span className="request-status approved">Admin</span>
                        ) : (
                          <span className="request-status pending">User</span>
                        )}
                      </td>
                      <td>{u.owned_zones_count}</td>
                      <td>{u.managed_zones_count}</td>
                      <td>
                        <button
                          className={`btn ${u.is_admin ? "btn-ghost" : "btn-primary"}`}
                          onClick={() => toggleAdmin(u.id, u.is_admin)}
                          disabled={u.id === currentUser.id && u.is_admin}
                          style={{ fontSize: "13px", padding: "4px 12px" }}
                        >
                          {u.is_admin ? "Revoke Admin" : "Make Admin"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
