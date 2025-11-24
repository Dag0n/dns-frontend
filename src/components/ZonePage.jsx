// src/components/ZonePage.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";

function fqdnToHost(rrsetName, zoneName) {
  const zoneFqdn = zoneName + ".";
  if (rrsetName === zoneFqdn) return "@";
  if (rrsetName.endsWith("." + zoneFqdn)) {
    return rrsetName.slice(0, -(zoneFqdn.length + 1));
  }
  return rrsetName;
}

function hostToFqdn(host, zoneName) {
  const trimmed = host.trim();
  if (trimmed === "@" || trimmed === "") return zoneName + ".";
  if (trimmed.endsWith(".")) return trimmed;
  return `${trimmed}.${zoneName}.`;
}

function rrsetsToSimple(rrsets, zoneName) {
  const A = [];
  const CNAME = [];
  const MX = [];
  const other = [];

  (rrsets || []).forEach((rr) => {
    const host = fqdnToHost(rr.name, zoneName);
    if (rr.type === "A") {
      rr.records.forEach((r) => A.push({ host, value: r.content }));
    } else if (rr.type === "CNAME") {
      rr.records.forEach((r) => CNAME.push({ host, value: r.content }));
    } else if (rr.type === "MX") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const priority = parts[0] || "10";
        const target = parts.slice(1).join(" ") || "";
        MX.push({ host, priority, value: target });
      });
    } else {
      other.push(rr);
    }
  });

  return { A, CNAME, MX, other };
}

function simpleToRrsets(simple, zoneName, defaultTtl = 3600) {
  const rrsets = [...simple.other];

  if (simple.A.length > 0) {
    const byHost = {};
    simple.A.forEach(({ host, value }) => {
      if (!value) return;
      const key = hostToFqdn(host, zoneName);
      if (!byHost[key]) byHost[key] = [];
      byHost[key].push({ content: value.trim(), disabled: false });
    });
    Object.entries(byHost).forEach(([name, records]) => {
      rrsets.push({
        name,
        type: "A",
        ttl: defaultTtl,
        records,
        comments: [],
      });
    });
  }

  if (simple.CNAME.length > 0) {
    const byHost = {};
    simple.CNAME.forEach(({ host, value }) => {
      if (!value) return;
      const key = hostToFqdn(host, zoneName);
      byHost[key] = { content: value.trim(), disabled: false };
    });
    Object.entries(byHost).forEach(([name, record]) => {
      rrsets.push({
        name,
        type: "CNAME",
        ttl: defaultTtl,
        records: [record],
        comments: [],
      });
    });
  }

  if (simple.MX.length > 0) {
    const byHost = {};
    simple.MX.forEach(({ host, priority, value }) => {
      if (!value) return;
      const key = hostToFqdn(host, zoneName);
      if (!byHost[key]) byHost[key] = [];
      const prio = String(priority || "10").trim();
      const tgt = value.trim();
      byHost[key].push({ content: `${prio} ${tgt}`, disabled: false });
    });
    Object.entries(byHost).forEach(([name, records]) => {
      rrsets.push({
        name,
        type: "MX",
        ttl: defaultTtl,
        records,
        comments: [],
      });
    });
  }

  return rrsets;
}

export default function ZonePage({ token, zoneName, onBack, isAdminEdit = false }) {
  const [tab, setTab] = useState("basic"); // "basic" | "advanced"
  const [loading, setLoading] = useState(true);

  // Delegation
  const [delegationMode, setDelegationMode] = useState("internal");
  const [externalNsText, setExternalNsText] = useState("");

  // Records
  const [hasInternalZone, setHasInternalZone] = useState(true);
  const [simple, setSimple] = useState({ A: [], CNAME: [], MX: [], other: [] });
  const [ttl, setTtl] = useState(3600);
  const [rrsetsText, setRrsetsText] = useState("[]");

  // Messages
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reloadZone = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const endpoint = isAdminEdit ? `/admin/zones/${zoneName}/details` : `/zones/${zoneName}`;
      const data = await apiRequest(endpoint, { token });

      // delegation
      setDelegationMode(data.delegation?.mode || "internal");
      setExternalNsText((data.delegation?.externalNs || []).join("\n"));

      // internal zone presence
      setHasInternalZone(
        typeof data.hasInternalZone === "boolean" ? data.hasInternalZone : true
      );

      const rrsets = data.rrsets || [];
      const zoneTtl = rrsets[0]?.ttl || 3600;
      setTtl(zoneTtl);

      const simpleParsed = rrsetsToSimple(rrsets, zoneName);
      setSimple(simpleParsed);
      setRrsetsText(JSON.stringify(rrsets, null, 2));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadZone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneName]);

  const handleSaveDelegation = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    let externalNs = [];
    if (delegationMode === "external") {
      externalNs = externalNsText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (externalNs.length === 0) {
        setError("Please provide at least one external nameserver.");
        return;
      }
    }

    try {
      const endpoint = isAdminEdit
        ? `/admin/zones/${zoneName}/delegation`
        : `/zones/${zoneName}/delegation`;
      await apiRequest(endpoint, {
        method: "PUT",
        token,
        body: { mode: delegationMode, externalNs },
      });
      setMessage("Delegation (nameservers) updated successfully.");
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  // Basic editor handlers
  const handleAddRow = (type) => {
    if (type === "A") {
      setSimple((prev) => ({
        ...prev,
        A: [...prev.A, { host: "@", value: "" }],
      }));
    } else if (type === "CNAME") {
      setSimple((prev) => ({
        ...prev,
        CNAME: [...prev.CNAME, { host: "www", value: "" }],
      }));
    } else if (type === "MX") {
      setSimple((prev) => ({
        ...prev,
        MX: [...prev.MX, { host: "@", priority: "10", value: "" }],
      }));
    }
  };

  const handleUpdateRow = (type, index, field, value) => {
    setSimple((prev) => {
      const copy = { ...prev };
      const arr = [...copy[type]];
      arr[index] = { ...arr[index], [field]: value };
      copy[type] = arr;
      return copy;
    });
  };

  const handleDeleteRow = (type, index) => {
    setSimple((prev) => {
      const copy = { ...prev };
      copy[type] = copy[type].filter((_, i) => i !== index);
      return copy;
    });
  };

  const handleSaveBasic = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (delegationMode === "external") {
      setError(
        "This zone is currently using an external DNS provider. Switch to Anglican DNS above to edit records here."
      );
      return;
    }

    try {
      const rrsets = simpleToRrsets(simple, zoneName, Number(ttl) || 3600);
      const endpoint = isAdminEdit
        ? `/admin/zones/${zoneName}/records`
        : `/zones/${zoneName}/records`;
      await apiRequest(endpoint, {
        method: "PUT",
        token,
        body: { rrsets },
      });
      setMessage("DNS records updated successfully.");
      setRrsetsText(JSON.stringify(rrsets, null, 2));
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveAdvanced = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (delegationMode === "external") {
      setError(
        "This zone is currently using an external DNS provider. Switch to Anglican DNS above to edit records here."
      );
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rrsetsText);
      if (!Array.isArray(parsed)) {
        throw new Error("RRsets must be an array");
      }
    } catch (err) {
      setError("Invalid JSON: " + err.message);
      return;
    }

    try {
      const endpoint = isAdminEdit
        ? `/admin/zones/${zoneName}/records`
        : `/zones/${zoneName}/records`;
      await apiRequest(endpoint, {
        method: "PUT",
        token,
        body: { rrsets: parsed },
      });
      setMessage("Records updated successfully.");
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const recordsDisabled =
    delegationMode === "external" || !hasInternalZone;

  return (
    <div className="zone-page">
      <div className="zone-header">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <h2>{zoneName}</h2>
      </div>

      {loading && <p>Loading zone…</p>}
      {error && <p className="error">{error}</p>}
      {message && <p className="message">{message}</p>}

      {!loading && (
        <>
          {/* Delegation card */}
          <section className="card" style={{ marginBottom: 16 }}>
            <h3>Delegation (Nameservers)</h3>
            <p className="muted">
              Choose whether this subdomain uses the Anglican DNS platform or
              an external DNS provider. Changing this updates the{" "}
              <code>NS</code> records in the parent zone.
            </p>

            <form onSubmit={handleSaveDelegation}>
              <label className="radio">
                <input
                  type="radio"
                  value="internal"
                  checked={delegationMode === "internal"}
                  onChange={() => setDelegationMode("internal")}
                />
                <span>Use Anglican DNS (default nameservers)</span>
              </label>

              <label className="radio">
                <input
                  type="radio"
                  value="external"
                  checked={delegationMode === "external"}
                  onChange={() => setDelegationMode("external")}
                />
                <span>Use external DNS provider</span>
              </label>

              <label className="field">
                <span>
                  External nameservers (one per line, e.g.{" "}
                  <code>ns1.example.net.</code>)
                </span>
                <textarea
                  rows={4}
                  value={externalNsText}
                  onChange={(e) => setExternalNsText(e.target.value)}
                  disabled={delegationMode !== "external"}
                />
              </label>

              <button className="btn btn-primary" type="submit">
                Save Delegation
              </button>
            </form>
          </section>

          {/* Records editor (Basic / Advanced) */}
          <div style={{ marginBottom: 10 }}>
            <button
              className={`nav-link ${tab === "basic" ? "active" : ""}`}
              onClick={() => setTab("basic")}
            >
              Basic DNS editor
            </button>
            <button
              className={`nav-link ${tab === "advanced" ? "active" : ""}`}
              onClick={() => setTab("advanced")}
              style={{ marginLeft: 6 }}
            >
              Advanced JSON
            </button>
          </div>

          {recordsDisabled && (
            <p className="muted" style={{ marginBottom: 8 }}>
              This zone is currently using an external DNS provider or has no
              internal zone configured. Records below are read-only. Switch to{" "}
              <strong>Use Anglican DNS</strong> above to manage records here.
            </p>
          )}

          {tab === "basic" && (
            <form onSubmit={handleSaveBasic} className="card">
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div className="field" style={{ maxWidth: 160 }}>
                  <span>Default TTL (seconds)</span>
                  <input
                    type="number"
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                    min={60}
                    disabled={recordsDisabled}
                  />
                </div>
                <p className="muted">
                  TTL applies to records edited here. Other record types are
                  preserved.
                </p>
              </div>

              {/* A records */}
              <h3>A records</h3>
              <p className="muted">
                Use <code>@</code> for the root of the zone, or{" "}
                <code>www</code>, <code>mail</code> etc. IP addresses must be
                IPv4.
              </p>
              <table className="zones-table" style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>IPv4 address</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {simple.A.map((row, i) => (
                    <tr key={`A-${i}`}>
                      <td>
                        <input
                          type="text"
                          value={row.host}
                          onChange={(e) =>
                            handleUpdateRow("A", i, "host", e.target.value)
                          }
                          placeholder="@"
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            handleUpdateRow("A", i, "value", e.target.value)
                          }
                          placeholder="157.231.244.198"
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDeleteRow("A", i)}
                          disabled={recordsDisabled}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {simple.A.length === 0 && (
                    <tr>
                      <td colSpan="3">
                        <span className="muted">No A records yet.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleAddRow("A")}
                style={{ marginBottom: 16 }}
                disabled={recordsDisabled}
              >
                + Add A record
              </button>

              {/* CNAME */}
              <h3>CNAME records</h3>
              <p className="muted">
                Alias one host to another (e.g. <code>www</code> →{" "}
                <code>parish.example.net.</code>).
              </p>
              <table className="zones-table" style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>Target (hostname)</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {simple.CNAME.map((row, i) => (
                    <tr key={`CNAME-${i}`}>
                      <td>
                        <input
                          type="text"
                          value={row.host}
                          onChange={(e) =>
                            handleUpdateRow("CNAME", i, "host", e.target.value)
                          }
                          placeholder="www"
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            handleUpdateRow("CNAME", i, "value", e.target.value)
                          }
                          placeholder="example.net."
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDeleteRow("CNAME", i)}
                          disabled={recordsDisabled}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {simple.CNAME.length === 0 && (
                    <tr>
                      <td colSpan="3">
                        <span className="muted">No CNAME records yet.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleAddRow("CNAME")}
                style={{ marginBottom: 16 }}
                disabled={recordsDisabled}
              >
                + Add CNAME record
              </button>

              {/* MX */}
              <h3>MX records</h3>
              <p className="muted">
                Mail exchangers for this zone. Lower priority number = higher
                preference (e.g. 10 then 20).
              </p>
              <table className="zones-table" style={{ marginBottom: 14 }}>
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>Priority</th>
                    <th>Mail server host</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {simple.MX.map((row, i) => (
                    <tr key={`MX-${i}`}>
                      <td>
                        <input
                          type="text"
                          value={row.host}
                          onChange={(e) =>
                            handleUpdateRow("MX", i, "host", e.target.value)
                          }
                          placeholder="@"
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={row.priority}
                          onChange={(e) =>
                            handleUpdateRow("MX", i, "priority", e.target.value)
                          }
                          min={0}
                          style={{ maxWidth: 80 }}
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            handleUpdateRow("MX", i, "value", e.target.value)
                          }
                          placeholder="mail.example.net."
                          disabled={recordsDisabled}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleDeleteRow("MX", i)}
                          disabled={recordsDisabled}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {simple.MX.length === 0 && (
                    <tr>
                      <td colSpan="4">
                        <span className="muted">No MX records yet.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => handleAddRow("MX")}
                style={{ marginBottom: 16 }}
                disabled={recordsDisabled}
              >
                + Add MX record
              </button>

              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={recordsDisabled}
                >
                  Save DNS changes
                </button>
              </div>
            </form>
          )}

          {tab === "advanced" && (
            <form onSubmit={handleSaveAdvanced} className="card">
              <h3>Advanced JSON editor</h3>
              <p className="muted">
                Full PowerDNS RRset JSON. Only use this if you know what you’re
                doing. Changes here will overwrite A / CNAME / MX edits.
              </p>
              <textarea
                className="code-area"
                rows={20}
                value={rrsetsText}
                onChange={(e) => setRrsetsText(e.target.value)}
                disabled={recordsDisabled}
              />
              <button
                className="btn btn-secondary"
                type="submit"
                disabled={recordsDisabled}
              >
                Save (advanced)
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
