// src/components/AdminZones.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState } from "./ui.jsx";

export default function AdminZones({ token, onEditZone }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [assignZoneName, setAssignZoneName] = useState("");
  const [assignEmail, setAssignEmail] = useState("");

  const [createZoneName, setCreateZoneName] = useState("");
  const [createEmail, setCreateEmail] = useState("");

  const [zoneFileText, setZoneFileText] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [claimCodes, setClaimCodes] = useState([]);
  const [search, setSearch] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const loadZones = async (q = search, off = offset) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (q.trim()) params.set("q", q.trim());
      const data = await apiRequest(`/admin/zones?${params}`, { token });
      setZones(data.zones || []);
      setTotal(data.total || 0);
      const codes = await apiRequest("/admin/zones/claim-codes", { token });
      setClaimCodes(codes.zones || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const handleSearch = (value) => {
    setSearch(value);
    setOffset(0);
    loadZones(value, 0);
  };

  const handleImportPreview = async () => {
    setError("");
    setMessage("");
    setImportBusy(true);
    try {
      const data = await apiRequest("/admin/zones/import", {
        method: "POST",
        token,
        body: { zoneFile: zoneFileText, dryRun: true },
      });
      setImportPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setImportBusy(false);
    }
  };

  const handleImportRun = async () => {
    if (
      !confirm(
        `Import ${importPreview.zones.length} zone(s) into DNS and create them as unclaimed (each gets a claim code)?`
      )
    ) {
      return;
    }
    setError("");
    setMessage("");
    setImportBusy(true);
    try {
      const data = await apiRequest("/admin/zones/import", {
        method: "POST",
        token,
        body: { zoneFile: zoneFileText, dryRun: false },
      });
      setMessage(
        `Imported ${data.created.length} zone(s)` +
          (data.apexRecordCount ? ` and ${data.apexRecordCount} apex record(s)` : "") +
          ". Claim codes are listed below."
      );
      setImportPreview(null);
      setZoneFileText("");
      await loadZones();
    } catch (err) {
      setError(err.message);
    } finally {
      setImportBusy(false);
    }
  };

  const copyCodesCsv = async () => {
    const csv = "zone,claim_code\n" + claimCodes.map((c) => `${c.name},${c.code}`).join("\n");
    await navigator.clipboard.writeText(csv);
    setMessage("Claim codes copied to clipboard as CSV.");
  };

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
    if (!confirm(`Are you sure you want to delete the zone "${zoneName}"? This will remove its DNS records and its database entry. This action cannot be undone.`)) {
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

  const handleSync = async () => {
    setError("");
    setMessage("");
    setSyncBusy(true);
    try {
      const res = await apiRequest("/admin/sync", { method: "POST", token });
      const s = res.stats || {};
      const skips = [
        ...(s.skippedZones || []).map((z) => `zone ${z} is outside the parent domain`),
        ...(s.skippedRrsets || []),
      ];
      setMessage(
        s.skipped
          ? `Sync skipped: ${s.skipped}.`
          : `DNS sync complete — ${s.replaced || 0} updated, ${s.deleted || 0} removed, ${s.adopted || 0} adopted.` +
              (skips.length ? ` Not published (${skips.length}): ${skips.join("; ")}` : "")
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleNotify = async () => {
    setError("");
    setMessage("");
    setNotifyBusy(true);
    try {
      const res = await apiRequest("/admin/notify", { method: "POST", token });
      setMessage(
        `NOTIFY queued to the secondary nameservers` +
          (res.serial ? ` (zone serial ${res.serial})` : "") +
          ". They re-transfer within seconds if the serial changed."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setNotifyBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Zone management</h1>
          <p className="muted">Create, assign and import parish zones.</p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncBusy}
            title="Reconcile PowerDNS with the zones stored here"
          >
            <Icon name="history" size={16} />
            {syncBusy ? "Syncing…" : "Sync DNS"}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleNotify}
            disabled={notifyBusy}
            title="Queue a DNS NOTIFY so Hurricane Electric re-checks the zone now"
          >
            <Icon name="server" size={16} />
            {notifyBusy ? "Notifying…" : "Notify HE"}
          </button>
        </div>
      </div>

      {loading && <Loading label="Loading zones…" />}
      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      {!loading && (
        <>
          <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <h3>Create new zone</h3>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                Must be under the parent domain, e.g. <code>oxford.anglican.site</code>.
              </p>
              <form onSubmit={handleCreate}>
                <label className="field">
                  <span>Zone name</span>
                  <input
                    type="text"
                    value={createZoneName}
                    onChange={(e) => setCreateZoneName(e.target.value)}
                    placeholder="parish.anglican.site"
                    required
                  />
                </label>
                <label className="field">
                  <span>Owner email</span>
                  <input
                    type="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                  />
                </label>
                <button className="btn btn-primary" type="submit">
                  <Icon name="plus" size={16} />
                  Create &amp; assign
                </button>
              </form>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <h3>Assign existing zone</h3>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                For zones already in the database (e.g. bulk-imported).
              </p>
              <form onSubmit={handleAssign}>
                <label className="field">
                  <span>Zone name</span>
                  <input
                    type="text"
                    value={assignZoneName}
                    onChange={(e) => setAssignZoneName(e.target.value)}
                    placeholder="parish.anglican.site"
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
                  Assign zone
                </button>
              </form>
            </div>
          </div>

          <details className="panel" style={{ marginTop: "1.25rem" }}>
            <summary>
              <Icon name="server" size={18} />
              Bulk import from zone file
            </summary>
            <div className="panel-body">
              <p className="muted" style={{ marginBottom: "0.8rem" }}>
                Paste the parent domain's zone file (BIND format). Every direct
                subdomain becomes an <strong>unclaimed</strong> zone with a claim
                code; parishes redeem their code from the dashboard to take
                ownership. Subdomains with their own NS records are imported as
                external delegations.
              </p>
              <textarea
                className="code-area"
                style={{ minHeight: 160 }}
                value={zoneFileText}
                onChange={(e) => {
                  setZoneFileText(e.target.value);
                  setImportPreview(null);
                }}
                placeholder={"$ORIGIN anglican.org.\nparish1  A  192.0.2.10\nwww.parish1  CNAME  parish1\nparish2  NS  ns1.otherprovider.com."}
                spellCheck={false}
              />
              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleImportPreview}
                  disabled={importBusy || !zoneFileText.trim()}
                >
                  {importBusy ? "Working…" : "Preview import"}
                </button>
                {importPreview && importPreview.zones.length > 0 && (
                  <button className="btn btn-primary" onClick={handleImportRun} disabled={importBusy}>
                    Import {importPreview.zones.length} zone(s)
                  </button>
                )}
              </div>

              {importPreview && (
                <div style={{ marginTop: "1rem" }}>
                  <p className="muted" style={{ marginBottom: "0.6rem" }}>
                    {importPreview.zones.length} zone(s) to create
                    {importPreview.apexRecordCount > 0 &&
                      `, ${importPreview.apexRecordCount} apex record(s) for the parent zone`}
                  </p>
                  {importPreview.zones.length > 0 && (
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr><th>Zone</th><th>Mode</th><th>Records</th></tr>
                        </thead>
                        <tbody>
                          {importPreview.zones.map((z) => (
                            <tr key={z.name}>
                              <td><code>{z.name}</code></td>
                              <td>{z.mode === "external" ? `external (${z.externalNs.join(", ")})` : "internal"}</td>
                              <td>{z.recordCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {importPreview.warnings.length > 0 && (
                    <div style={{ marginTop: "0.6rem" }}>
                      {importPreview.warnings.map((w, i) => (
                        <p key={i} className="muted">⚠ {w}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>

          {claimCodes.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>Unclaimed zones ({claimCodes.length})</h2>
                  <p className="muted">
                    Distribute these single-use codes to parishes through a
                    trusted channel. A code assigns the zone to whoever redeems it.
                  </p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={copyCodesCsv}>
                  <Icon name="copy" size={15} />
                  Copy as CSV
                </button>
              </div>
              <div className="table-wrap">
                <table className="data responsive">
                  <thead>
                    <tr><th>Zone</th><th>Claim code</th></tr>
                  </thead>
                  <tbody>
                    {claimCodes.map((c) => (
                      <tr key={c.id}>
                        <td data-label="Zone"><code>{c.name}</code></td>
                        <td data-label="Claim code"><code style={{ letterSpacing: "2px" }}>{c.code}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div>
                <h2>All zones ({total})</h2>
              </div>
              <div className="search-box">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search zones or owners…"
                  aria-label="Search zones"
                />
              </div>
            </div>

            {zones.length === 0 ? (
              <EmptyState icon="globe" title={search ? "No matches" : "No zones in database"}>
                {search
                  ? `No zones match “${search}”.`
                  : "Create a zone or import a zone file to get started."}
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data responsive">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th>Owner</th>
                      <th>Managers</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((z) => (
                      <tr key={z.id}>
                        <td data-label="Zone"><code>{z.name}</code></td>
                        <td data-label="Owner">{z.owner_email || <em className="muted">Unassigned</em>}</td>
                        <td data-label="Managers">
                          {z.managers && z.managers.length > 0 ? (
                            z.managers.map((m) => <div key={m.id}>{m.email}</div>)
                          ) : (
                            <em className="muted">None</em>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => onEditZone && onEditZone(z.name)}
                            >
                              <Icon name="edit" size={14} />
                              Edit
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(z.name)}
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
            )}

            {total > LIMIT && (
              <div className="pager">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
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
                  disabled={offset + LIMIT >= total}
                >
                  Next
                  <Icon name="chevronRight" size={15} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
