// src/components/Support.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, EmptyState, Chip, statusTone } from "./ui.jsx";

export default function Support({ token, user }) {
  const [tickets, setTickets] = useState([]);
  const [selected, setSelected] = useState(null); // ticket detail object
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTickets = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/tickets", { token });
      setTickets(data.tickets || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTicket = async (id) => {
    setError("");
    setMessage("");
    setReply("");
    try {
      const data = await apiRequest(`/tickets/${id}`, { token });
      setSelected(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest("/tickets", {
        method: "POST",
        token,
        body: { subject: subject.trim(), message: body.trim() },
      });
      setSubject("");
      setBody("");
      setShowNew(false);
      setMessage("Ticket submitted — we'll get back to you here.");
      await loadTickets();
      await openTicket(data.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/tickets/${selected.id}/reply`, {
        method: "POST",
        token,
        body: { message: reply.trim() },
      });
      setReply("");
      await openTicket(selected.id);
      await loadTickets();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/tickets/${selected.id}/close`, { method: "POST", token });
      setMessage("Ticket closed.");
      setSelected(null);
      await loadTickets();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (d) =>
    new Date(d).toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // ---------- detail view ----------
  if (selected) {
    return (
      <div className="admin-page">
        <div className="page-header" style={{ alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", minWidth: 0 }}>
            <button
              className="icon-btn"
              onClick={() => {
                setSelected(null);
                loadTickets();
              }}
              aria-label="Back to tickets"
              title="Back to tickets"
            >
              <Icon name="back" size={20} />
            </button>
            <h1 style={{ wordBreak: "break-word" }}>{selected.subject}</h1>
            <Chip tone={statusTone(selected.status)}>{selected.status}</Chip>
          </div>
        </div>

        <Alert type="error">{error}</Alert>

        <div className="card">
          <div className="msg-thread">
            {selected.messages.map((m) => (
              <div key={m.id} className={`msg ${m.email === user.email ? "mine" : ""}`}>
                <div className="msg-meta">
                  <strong>
                    {m.email}
                    {m.is_admin && (
                      <span style={{ marginLeft: 6 }}>
                        <Chip tone="teal">Staff</Chip>
                      </span>
                    )}
                  </strong>
                  <span>{fmtDate(m.created_at)}</span>
                </div>
                <div className="msg-body">{m.message}</div>
              </div>
            ))}
          </div>

          <form onSubmit={handleReply}>
            <label className="field">
              <span>Reply {selected.status === "closed" && "(reopens the ticket)"}</span>
              <textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…"
              />
            </label>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" disabled={busy || !reply.trim()}>
                Send reply
              </button>
              {selected.status === "open" && (
                <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={busy}>
                  Close ticket
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ---------- list view ----------
  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1>Support</h1>
          <p className="muted">
            {user.is_admin
              ? "All support tickets from users."
              : "Need help? Open a ticket and an administrator will respond here."}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(!showNew)}>
          <Icon name="plus" size={16} />
          New ticket
        </button>
      </div>

      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      {showNew && (
        <div className="card">
          <h3 style={{ marginBottom: "1rem" }}>New support ticket</h3>
          <form onSubmit={handleCreate}>
            <label className="field">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of the problem"
                required
              />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the issue — include the zone name if it concerns a specific domain."
                required
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Submit ticket
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <Loading label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <div className="card">
          <EmptyState icon="chat" title="No tickets yet">
            Open a ticket if you need help with your zones.
          </EmptyState>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data responsive">
              <thead>
                <tr>
                  <th>Subject</th>
                  {user.is_admin && <th>From</th>}
                  <th>Status</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => openTicket(t.id)}>
                    <td data-label="Subject"><strong>{t.subject}</strong></td>
                    {user.is_admin && <td data-label="From">{t.email}</td>}
                    <td data-label="Status">
                      <Chip tone={statusTone(t.status)}>{t.status}</Chip>
                    </td>
                    <td data-label="Last activity">{fmtDate(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
