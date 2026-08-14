// src/components/AdminUsers.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState, Chip } from "./ui.jsx";

const LIMIT = 25;

export default function AdminUsers({ token, currentUser }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const loadUsers = async (q = search, off = offset) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (q.trim()) params.set("q", q.trim());
      const data = await apiRequest(`/admin/users?${params}`, { token });
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const handleSearch = (value) => {
    setSearch(value);
    setOffset(0);
    loadUsers(value, 0);
  };

  const toggleAdmin = async (u2) => {
    if (u2.id === currentUser.id && u2.is_admin) {
      setError("You cannot remove admin privileges from yourself");
      return;
    }
    setError("");
    setMessage("");
    setBusyId(u2.id);
    try {
      await apiRequest(`/admin/users/${u2.id}/admin`, {
        method: "PUT",
        token,
        body: { is_admin: !u2.is_admin },
      });
      setMessage(u2.is_admin ? "Admin privileges revoked" : "Admin privileges granted");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (u2) => {
    if (!confirm(`Send a password-reset email to ${u2.email}?`)) return;
    setError("");
    setMessage("");
    setBusyId(u2.id);
    try {
      await apiRequest(`/admin/users/${u2.id}/reset-password`, { method: "POST", token });
      setMessage(`Password-reset email sent to ${u2.email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleResetMfa = async (u2) => {
    if (
      !confirm(
        `Reset two-factor authentication for ${u2.email}? They will be able to sign in with just their password and can re-enrol from the Security page. Only do this for a verified request (e.g. a lost phone).`
      )
    )
      return;
    setError("");
    setMessage("");
    setBusyId(u2.id);
    try {
      await apiRequest(`/admin/users/${u2.id}/reset-mfa`, { method: "POST", token });
      setMessage(`Two-factor authentication reset for ${u2.email}.`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u2) => {
    if (
      !confirm(
        `Delete the account ${u2.email}? Their zones stay in the system but become unassigned. This cannot be undone.`
      )
    )
      return;
    setError("");
    setMessage("");
    setBusyId(u2.id);
    try {
      await apiRequest(`/admin/users/${u2.id}`, { method: "DELETE", token });
      setMessage(`Deleted ${u2.email}.`);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const canGoNext = offset + LIMIT < total;
  const canGoPrev = offset > 0;

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">Manage accounts, permissions and password resets.</p>
        </div>
      </div>

      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      <div className="card">
        <div className="card-header">
          <div>
            <h2>All users ({total})</h2>
          </div>
          <div className="search-box">
            <Icon name="search" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by email…"
              aria-label="Search users"
            />
          </div>
        </div>

        {loading ? (
          <Loading label="Loading users…" />
        ) : users.length === 0 ? (
          <EmptyState icon="users" title={search ? "No matches" : "No users found"}>
            {search ? `No users match “${search}”.` : "No users are registered in the system."}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data responsive">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Owned</th>
                    <th>Managed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u2) => (
                    <tr key={u2.id}>
                      <td data-label="Email">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                          {u2.email}
                          {u2.id === currentUser.id && <Chip tone="teal">You</Chip>}
                        </span>
                      </td>
                      <td data-label="Role">
                        <span style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
                          <Chip tone={u2.is_admin ? "green" : "gray"}>
                            {u2.is_admin ? "Admin" : "User"}
                          </Chip>
                          {u2.mfa_enabled && <Chip tone="teal">MFA</Chip>}
                        </span>
                      </td>
                      <td data-label="Owned zones">{u2.owned_zones_count}</td>
                      <td data-label="Managed zones">{u2.managed_zones_count}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => toggleAdmin(u2)}
                            disabled={busyId === u2.id || (u2.id === currentUser.id && u2.is_admin)}
                          >
                            {u2.is_admin ? "Revoke admin" : "Make admin"}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleResetPassword(u2)}
                            disabled={busyId === u2.id}
                            title="Email a password-reset link"
                          >
                            <Icon name="key" size={14} />
                            Reset password
                          </button>
                          {u2.mfa_enabled && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleResetMfa(u2)}
                              disabled={busyId === u2.id}
                              title="Disable their authenticator (lost device recovery)"
                            >
                              <Icon name="shield" size={14} />
                              Reset MFA
                            </button>
                          )}
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(u2)}
                            disabled={busyId === u2.id || u2.id === currentUser.id}
                          >
                            <Icon name="trash" size={14} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > LIMIT && (
              <div className="pager">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={!canGoPrev}
                >
                  <Icon name="chevronLeft" size={15} />
                  Previous
                </button>
                <span className="muted">
                  Page {Math.floor(offset / LIMIT) + 1} of {Math.ceil(total / LIMIT)}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={!canGoNext}
                >
                  Next
                  <Icon name="chevronRight" size={15} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
