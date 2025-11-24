// src/components/AdminZones.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

export default function AdminZones({ token, onEditZone }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [assignZoneName, setAssignZoneName] = useState("");
  const [assignEmail, setAssignEmail] = useState("");

  const [createZoneName, setCreateZoneName] = useState("");
  const [createEmail, setCreateEmail] = useState("");

  const loadZones = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest("/admin/zones", { token });
      setZones(data.zones || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssign = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiRequest("/admin/zones/assign", {
        method: "POST",
        token,
        body: { email: assignEmail.trim(), zoneName: assignZoneName.trim() },
      });
      setMessage("Zone assigned successfully.");
      setAssignEmail("");
      setAssignZoneName("");
      await loadZones();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiRequest("/admin/zones/create", {
        method: "POST",
        token,
        body: { email: createEmail.trim(), zoneName: createZoneName.trim() },
      });
      setMessage("Zone created and assigned successfully.");
      setCreateEmail("");
      setCreateZoneName("");
      await loadZones();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (zoneName) => {
    if (!confirm(`Are you sure you want to delete the zone "${zoneName}"? This will remove it from PowerDNS and the database. This action cannot be undone.`)) {
      return;
    }

    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/zones/${encodeURIComponent(zoneName)}`, {
        method: "DELETE",
        token,
      });
      setMessage(`Zone "${zoneName}" deleted successfully.`);
      await loadZones();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="admin-page">
      <div className="card">
        <h2>Admin: Zones</h2>
        <p className="muted">
          Assign existing zones to users, or create new zones for parishes.
        </p>

        {loading && <p>Loading zones…</p>}
        {error && <p className="error">{error}</p>}
        {message && <p className="message">{message}</p>}

        <div className="admin-forms">
          <div className="admin-form">
            <h3>Create New Zone</h3>
            <p className="muted">
              Zone name must be under your parent domain (e.g.{" "}
              <code>oxford.rubbish.dev</code>).
            </p>
            <form onSubmit={handleCreate}>
              <label className="field">
                <span>User email (owner)</span>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Zone name</span>
                <input
                  type="text"
                  value={createZoneName}
                  onChange={(e) => setCreateZoneName(e.target.value)}
                  placeholder="parish.rubbish.dev"
                  required
                />
              </label>
              <button className="btn btn-primary" type="submit">
                Create & Assign
              </button>
            </form>
          </div>

          <div className="admin-form">
            <h3>Assign Existing Zone</h3>
            <p className="muted">
              For zones already present in PowerDNS & imported into the DB.
            </p>
            <form onSubmit={handleAssign}>
              <label className="field">
                <span>Zone name</span>
                <input
                  type="text"
                  value={assignZoneName}
                  onChange={(e) => setAssignZoneName(e.target.value)}
                  placeholder="parish.rubbish.dev"
                  required
                />
              </label>
              <label className="field">
                <span>User email</span>
                <input
                  type="email"
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  required
                />
              </label>
              <button className="btn btn-secondary" type="submit">
                Assign
              </button>
            </form>
          </div>
        </div>

        <h3>All Zones</h3>
        <div className="table-wrapper">
          <table className="zones-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Owner</th>
                <th>Managers</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td><code>{z.name}</code></td>
                  <td>{z.owner_email || <em>Unassigned</em>}</td>
                  <td>
                    {z.managers && z.managers.length > 0 ? (
                      <div style={{ fontSize: "13px" }}>
                        {z.managers.map((m) => (
                          <div key={m.id}>{m.email}</div>
                        ))}
                      </div>
                    ) : (
                      <em>None</em>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => onEditZone && onEditZone(z.name)}
                        style={{ fontSize: "13px", padding: "4px 12px" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => handleDelete(z.name)}
                        style={{ fontSize: "13px", padding: "4px 12px", color: "var(--danger)" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          <line x1="10" y1="11" x2="10" y2="17"/>
                          <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {zones.length === 0 && !loading && (
                <tr>
                  <td colSpan="4">
                    <span className="muted">No zones in database.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

