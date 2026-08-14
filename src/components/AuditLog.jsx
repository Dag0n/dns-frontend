// src/components/AuditLog.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState, Chip } from "./ui.jsx";

const ACTION_LABELS = {
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
  delete_user: "Deleted User",
  password_reset_sent: "Sent Password Reset",
  transfer_zone_owner: "Transferred Ownership",
  enable_mfa: "Enabled MFA",
  disable_mfa: "Disabled MFA",
  register: "Registered",
  login: "Signed In",
  login_failed: "Failed Sign-In",
  login_mfa_failed: "Failed MFA Code",
  request_created: "Requested Zone",
  request_updated: "Updated Request",
  request_cancelled: "Withdrew Request",
  add_zone_manager: "Added Manager",
  restore_zone_snapshot: "Restored Snapshot",
  import_zones: "Imported Zones",
  claim_zone: "Claimed Zone",
  claim_failed: "Failed Claim",
  ticket_created: "Opened Ticket",
  ticket_replied: "Ticket Reply",
  ticket_closed: "Closed Ticket",
  password_reset_requested: "Password Reset Requested",
  reset_mfa: "Reset MFA",
  pdns_sync: "DNS Sync",
  notify_secondaries: "Notified Secondaries",
};

const formatAction = (action) => ACTION_LABELS[action] || action;

const getActionTone = (action) => {
  if (action.includes("fail") || action.includes("delete") || action.includes("deny") || action.includes("revoke")) {
    return "rose";
  }
  if (action.includes("create") || action.includes("approve") || action.includes("grant") || action.includes("restore")) {
    return "green";
  }
  return "gray";
};

function parseDetails(details) {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return { raw: details };
  }
}

// One rrset in a change diff, e.g. `A www.stmarys.anglican.site. → 192.0.2.1 (TTL 300)`
function RrsetLine({ entry, prefix }) {
  if (entry.truncated) return <li className="muted">…and more (truncated)</li>;
  return (
    <li>
      <span className={`diff-mark ${prefix === "+" ? "add" : prefix === "−" ? "del" : "mod"}`}>{prefix}</span>
      <code>{entry.type}</code> <code>{entry.name}</code>
      {entry.before ? (
        <>
          {" "}
          <span className="muted">
            {entry.before.records.join(", ") || "—"} (TTL {entry.before.ttl})
          </span>{" "}
          → {entry.after.records.join(", ") || "—"}{" "}
          <span className="muted">(TTL {entry.after.ttl})</span>
        </>
      ) : (
        <>
          {" "}
          {entry.records && entry.records.length > 0 ? entry.records.join(", ") : ""}
          {entry.ttl != null && <span className="muted"> (TTL {entry.ttl})</span>}
        </>
      )}
    </li>
  );
}

function ChangeDetails({ changes }) {
  const added = changes.added || [];
  const removed = changes.removed || [];
  const changed = changes.changed || [];
  return (
    <ul className="diff-list">
      {added.map((c, i) => <RrsetLine key={`a${i}`} entry={c} prefix="+" />)}
      {changed.map((c, i) => <RrsetLine key={`c${i}`} entry={c} prefix="±" />)}
      {removed.map((c, i) => <RrsetLine key={`r${i}`} entry={c} prefix="−" />)}
    </ul>
  );
}

function summarizeChanges(changes) {
  const parts = [];
  const count = (list, word) => {
    const real = (list || []).filter((c) => !c.truncated).length;
    if (real > 0) parts.push(`${real} ${word}`);
  };
  count(changes.added, "added");
  count(changes.changed, "changed");
  count(changes.removed, "removed");
  return parts.join(" · ") || "no record changes";
}

function simpleSummary(parsed) {
  return Object.entries(parsed)
    .filter(([key]) => key !== "changes")
    .map(([key, value]) => (Array.isArray(value) ? `${key}: ${value.join(", ")}` : `${key}: ${value}`))
    .join(", ");
}

function LogEntry({ log }) {
  const [open, setOpen] = useState(false);
  const parsed = parseDetails(log.details);
  const changes = parsed && parsed.changes;
  const hasDiff =
    changes &&
    ((changes.added && changes.added.length) ||
      (changes.removed && changes.removed.length) ||
      (changes.changed && changes.changed.length));

  return (
    <div className="log-item">
      <div
        className={`log-row ${hasDiff ? "expandable" : ""}`}
        onClick={hasDiff ? () => setOpen(!open) : undefined}
        role={hasDiff ? "button" : undefined}
        tabIndex={hasDiff ? 0 : undefined}
        onKeyDown={hasDiff ? (e) => (e.key === "Enter" || e.key === " ") && setOpen(!open) : undefined}
      >
        <div className="log-main">
          <div className="log-line1">
            <Chip tone={getActionTone(log.action)}>{formatAction(log.action)}</Chip>
            {log.target_id && <code className="log-target">{log.target_id}</code>}
            {hasDiff && <span className="chip chip-teal">{summarizeChanges(changes)}</span>}
          </div>
          <div className="log-line2">
            {log.email}
            {log.ip && <> · {log.ip}</>}
            {parsed && !hasDiff && simpleSummary(parsed) && <> · {simpleSummary(parsed)}</>}
          </div>
        </div>
        <div className="log-side">
          <span className="log-date">
            {new Date(log.created_at).toLocaleString("en-GB", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {hasDiff && (
            <Icon name="chevronRight" size={16} className={`log-chev ${open ? "open" : ""}`} />
          )}
        </div>
      </div>
      {open && hasDiff && (
        <div className="log-detail">
          <ChangeDetails changes={changes} />
        </div>
      )}
    </div>
  );
}

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

  const canGoNext = offset + limit < total;
  const canGoPrev = offset > 0;

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="muted">
            {isAdmin
              ? "All system activity and changes."
              : "Activity for your zones."}
          </p>
        </div>
      </div>

      {loading && <Loading label="Loading activity…" />}
      <Alert type="error">{error}</Alert>

      {!loading && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Log</h2>
              <p className="muted">
                {total === 0
                  ? "No entries"
                  : `Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${total}. Entries with record changes expand to show the full diff.`}
              </p>
            </div>
          </div>

          {logs.length === 0 ? (
            <EmptyState icon="history" title="No activity yet">
              Activity will appear here when actions are performed.
            </EmptyState>
          ) : (
            <>
              <div className="log-list">
                {logs.map((log) => (
                  <LogEntry key={log.id} log={log} />
                ))}
              </div>

              {total > limit && (
                <div className="pager">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={!canGoPrev}
                  >
                    <Icon name="chevronLeft" size={15} />
                    Previous
                  </button>
                  <span className="muted">
                    Page {Math.floor(offset / limit) + 1} of {Math.ceil(total / limit)}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setOffset(offset + limit)}
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
      )}
    </div>
  );
}
