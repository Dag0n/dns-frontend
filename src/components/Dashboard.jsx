// src/components/Dashboard.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState, Modal, Chip, statusTone } from "./ui.jsx";

export default function Dashboard({ token, onSelectZone, user }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null); // request being edited, or null
  const [myRequests, setMyRequests] = useState([]);
  const [requestZoneName, setRequestZoneName] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestStatus, setRequestStatus] = useState({ message: "", type: "" });
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimCode, setClaimCode] = useState("");
  const [claimStatus, setClaimStatus] = useState({ message: "", type: "" });

  const loadZones = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/zones", { token });
      setZones(data.zones || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    try {
      const req = await apiRequest("/requests/mine", { token });
      setMyRequests(req.requests || []);
    } catch {
      /* requests list is non-critical */
    }
  };

  useEffect(() => {
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleClaim = async (e) => {
    e.preventDefault();
    setClaimStatus({ message: "", type: "" });
    try {
      const data = await apiRequest("/zones/claim", {
        method: "POST",
        token,
        body: { code: claimCode.trim() },
      });
      setClaimStatus({
        message: `Success! ${data.zone} is now yours to manage.`,
        type: "success",
      });
      setClaimCode("");
      await loadZones();
      setTimeout(() => {
        setShowClaimModal(false);
        setClaimStatus({ message: "", type: "" });
      }, 2000);
    } catch (err) {
      setClaimStatus({ message: err.message, type: "error" });
    }
  };

  const handleRequest = async (e) => {
    e.preventDefault();
    setRequestStatus({ message: "", type: "" });
    try {
      if (editingRequest) {
        await apiRequest(`/requests/${editingRequest.id}`, {
          method: "PUT",
          token,
          body: { zoneName: requestZoneName.trim(), reason: requestReason.trim() },
        });
        setRequestStatus({ message: "Request updated.", type: "success" });
      } else {
        await apiRequest("/requests/create", {
          method: "POST",
          token,
          body: { zoneName: requestZoneName.trim(), reason: requestReason.trim() },
        });
        setRequestStatus({
          message: "Request submitted! An administrator will review it soon.",
          type: "success",
        });
      }
      await loadZones();
      setTimeout(() => {
        setShowRequestModal(false);
        setEditingRequest(null);
        setRequestZoneName("");
        setRequestReason("");
        setRequestStatus({ message: "", type: "" });
      }, 1500);
    } catch (err) {
      setRequestStatus({ message: err.message, type: "error" });
    }
  };

  const openNewRequest = () => {
    setEditingRequest(null);
    setRequestZoneName("");
    setRequestReason("");
    setShowRequestModal(true);
  };

  const openEditRequest = (req) => {
    setEditingRequest(req);
    setRequestZoneName(req.zone_name);
    setRequestReason(req.reason);
    setShowRequestModal(true);
  };

  const handleWithdraw = async (req) => {
    const warning =
      req.status === "approved"
        ? `Withdraw your request for "${req.zone_name}"? This REVOKES your access to the zone — an administrator would have to re-assign it.`
        : `Withdraw your request for "${req.zone_name}"?`;
    if (!confirm(warning)) return;
    setError("");
    try {
      await apiRequest(`/requests/${req.id}`, { method: "DELETE", token });
      await loadZones();
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = search.trim()
    ? zones.filter((z) => z.name.toLowerCase().includes(search.trim().toLowerCase()))
    : zones;

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>Your domains</h1>
          <p className="muted">
            Welcome back, {user.email.split("@")[0]}.
            {zones.length > 0 &&
              ` You manage ${zones.length} ${zones.length === 1 ? "domain" : "domains"}.`}
          </p>
        </div>
        {zones.length > 0 && (
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => setShowClaimModal(true)}>
              <Icon name="key" size={16} />
              Claim with code
            </button>
            <button className="btn btn-primary" onClick={openNewRequest}>
              <Icon name="plus" size={16} />
              Request subdomain
            </button>
          </div>
        )}
      </div>

      {loading && <Loading label="Loading your domains…" />}

      <Alert type="error">{error}</Alert>

      {!loading && zones.length === 0 && !error && (
        <div className="card">
          <EmptyState
            icon="globe"
            title="No domains yet"
            actions={
              <>
                <button className="btn btn-primary" onClick={() => setShowClaimModal(true)}>
                  <Icon name="key" size={16} />
                  Claim with code
                </button>
                <button className="btn btn-secondary" onClick={openNewRequest}>
                  <Icon name="plus" size={16} />
                  Request access
                </button>
              </>
            }
          >
            Have a claim code from your diocese? Claim your parish domain
            instantly. Otherwise, request access and an administrator will
            review it.
          </EmptyState>
        </div>
      )}

      {!loading && zones.length > 0 && (
        <>
          {zones.length > 5 && (
            <div className="search-box" style={{ marginBottom: "1rem" }}>
              <Icon name="search" size={17} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search domains…"
                aria-label="Search domains"
              />
            </div>
          )}

          <div className="zone-grid">
            {filtered.map((z) => (
              <button key={z.id} className="zone-card" onClick={() => onSelectZone(z.name)}>
                <span className="zone-card-icon">
                  <Icon name="globe" size={21} />
                </span>
                <span className="zone-card-body">
                  <span className="zone-card-name">{z.name}</span>
                  <span className="zone-card-sub">Manage records &amp; nameservers</span>
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="muted">No domains match “{search}”.</p>
            )}
          </div>
        </>
      )}

      {myRequests.length > 0 && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="card-header">
            <div>
              <h2>Your requests</h2>
              <p className="muted">
                Subdomain requests you've made. Pending requests can be edited;
                withdrawing an approved request revokes your access.
              </p>
            </div>
          </div>
          <div className="snap-list">
            {myRequests.map((req) => (
              <div key={req.id} className="snap-item" style={{ alignItems: "flex-start" }}>
                <div className="snap-info" style={{ flex: 1 }}>
                  <div className="snap-when" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <code>{req.zone_name}</code>
                    <Chip tone={statusTone(req.status)}>{req.status}</Chip>
                  </div>
                  <div className="snap-meta" style={{ marginTop: "0.25rem" }}>
                    Requested{" "}
                    {new Date(req.created_at).toLocaleString("en-GB", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {req.reason && (
                    <p className="muted" style={{ marginTop: "0.3rem", fontSize: "0.85rem" }}>
                      “{req.reason}”
                    </p>
                  )}
                </div>
                <div className="row-actions">
                  {req.status === "pending" && (
                    <button className="btn btn-secondary btn-sm" onClick={() => openEditRequest(req)}>
                      <Icon name="edit" size={14} />
                      Edit
                    </button>
                  )}
                  {(req.status === "pending" || req.status === "approved") && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleWithdraw(req)}>
                      <Icon name="x" size={14} />
                      {req.status === "approved" ? "Revoke access" : "Withdraw"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showClaimModal && (
        <Modal title="Claim your parish domain" onClose={() => setShowClaimModal(false)}>
          <form onSubmit={handleClaim}>
            {claimStatus.message && (
              <Alert type={claimStatus.type === "error" ? "error" : "success"}>
                {claimStatus.message}
              </Alert>
            )}
            <label className="field">
              <span>Claim code</span>
              <input
                className="claim-input"
                type="text"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                placeholder="K7MPQ2XW9A"
                maxLength={10}
                required
                autoFocus
              />
              <span className="hint">
                Enter the code you received from your diocese. It links your
                parish's domain to this account.
              </span>
            </label>
            <div className="modal-foot" style={{ padding: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowClaimModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Claim domain
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showRequestModal && (
        <Modal title={editingRequest ? "Edit request" : "Request subdomain access"} onClose={() => { setShowRequestModal(false); setEditingRequest(null); }}>
          <form onSubmit={handleRequest}>
            {requestStatus.message && (
              <Alert type={requestStatus.type === "error" ? "error" : "success"}>
                {requestStatus.message}
              </Alert>
            )}
            <label className="field">
              <span>Requested subdomain</span>
              <input
                type="text"
                value={requestZoneName}
                onChange={(e) => setRequestZoneName(e.target.value)}
                placeholder="myparish.anglican.site"
                required
              />
              <span className="hint">Enter the full subdomain name you'd like to manage.</span>
            </label>
            <label className="field">
              <span>Reason for request</span>
              <textarea
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                placeholder="Briefly explain why you need access to this subdomain…"
                rows={4}
                required
              />
            </label>
            <div className="modal-foot" style={{ padding: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowRequestModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingRequest ? "Save changes" : "Submit request"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
