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

function ensureFqdn(value) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.endsWith(".")) return trimmed;
  return trimmed + ".";
}

function rrsetsToSimple(rrsets, zoneName) {
  const records = [];
  const other = [];

  (rrsets || []).forEach((rr) => {
    const host = fqdnToHost(rr.name, zoneName);

    // Simple types (just value)
    if (["A", "AAAA", "CNAME", "TXT", "PTR"].includes(rr.type)) {
      rr.records.forEach((r) =>
        records.push({ type: rr.type, host, value: r.content })
      );
    }
    // MX records (priority + target)
    else if (rr.type === "MX") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const priority = parts[0] || "10";
        const target = parts.slice(1).join(" ") || "";
        records.push({ type: "MX", host, priority, value: target });
      });
    }
    // SRV records (priority, weight, port, target)
    else if (rr.type === "SRV") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const priority = parts[0] || "0";
        const weight = parts[1] || "0";
        const port = parts[2] || "0";
        const target = parts.slice(3).join(" ") || "";
        records.push({ type: "SRV", host, priority, weight, port, value: target });
      });
    }
    // CAA records (flags, tag, value)
    else if (rr.type === "CAA") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const flags = parts[0] || "0";
        const tag = parts[1] || "issue";
        const caaValue = parts.slice(2).join(" ").replace(/^"(.*)"$/, '$1') || "";
        records.push({ type: "CAA", host, flags, tag, value: caaValue });
      });
    }
    // CERT records (type, key-tag, algorithm, certificate)
    else if (rr.type === "CERT") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const certType = parts[0] || "0";
        const keyTag = parts[1] || "0";
        const algorithm = parts[2] || "0";
        const certificate = parts.slice(3).join(" ") || "";
        records.push({ type: "CERT", host, certType, keyTag, algorithm, value: certificate });
      });
    }
    // DNSKEY records (flags, protocol, algorithm, public-key)
    else if (rr.type === "DNSKEY") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const flags = parts[0] || "256";
        const protocol = parts[1] || "3";
        const algorithm = parts[2] || "8";
        const publicKey = parts.slice(3).join(" ") || "";
        records.push({ type: "DNSKEY", host, flags, protocol, algorithm, value: publicKey });
      });
    }
    // DS records (key-tag, algorithm, digest-type, digest)
    else if (rr.type === "DS") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const keyTag = parts[0] || "0";
        const algorithm = parts[1] || "8";
        const digestType = parts[2] || "2";
        const digest = parts.slice(3).join(" ") || "";
        records.push({ type: "DS", host, keyTag, algorithm, digestType, value: digest });
      });
    }
    // Simple raw content types (HTTPS, SVCB, LOC, NAPTR, OPENPGPKEY, SMIMEA, SSHFP, TLSA, URI)
    else if (["HTTPS", "SVCB", "LOC", "NAPTR", "OPENPGPKEY", "SMIMEA", "SSHFP", "TLSA", "URI"].includes(rr.type)) {
      rr.records.forEach((r) =>
        records.push({ type: rr.type, host, value: r.content })
      );
    }
    // Everything else goes to "other" for advanced mode
    else {
      other.push(rr);
    }
  });

  return { records, other };
}

function simpleToRrsets(simple, zoneName, defaultTtl = 3600) {
  const rrsets = [...simple.other];

  // Group records by type and host
  const byTypeAndHost = {};

  simple.records.forEach((record) => {
    if (!record.value) return;

    const key = `${record.type}||${hostToFqdn(record.host, zoneName)}`;
    if (!byTypeAndHost[key]) {
      byTypeAndHost[key] = {
        type: record.type,
        name: hostToFqdn(record.host, zoneName),
        records: [],
      };
    }

    let content;
    switch (record.type) {
      case "A":
      case "AAAA":
      case "TXT":
        content = record.value.trim();
        break;
      case "CNAME":
      case "PTR":
        content = ensureFqdn(record.value);
        break;
      case "MX":
        content = `${String(record.priority || "10").trim()} ${ensureFqdn(record.value)}`;
        break;
      case "SRV":
        content = `${String(record.priority || "0").trim()} ${String(record.weight || "0").trim()} ${String(record.port || "0").trim()} ${ensureFqdn(record.value)}`;
        break;
      case "CAA":
        content = `${String(record.flags || "0").trim()} ${record.tag || "issue"} "${record.value.trim()}"`;
        break;
      case "CERT":
        content = `${String(record.certType || "0").trim()} ${String(record.keyTag || "0").trim()} ${String(record.algorithm || "0").trim()} ${record.value.trim()}`;
        break;
      case "DNSKEY":
        content = `${String(record.flags || "256").trim()} ${String(record.protocol || "3").trim()} ${String(record.algorithm || "8").trim()} ${record.value.trim()}`;
        break;
      case "DS":
        content = `${String(record.keyTag || "0").trim()} ${String(record.algorithm || "8").trim()} ${String(record.digestType || "2").trim()} ${record.value.trim()}`;
        break;
      case "HTTPS":
      case "SVCB":
      case "LOC":
      case "NAPTR":
      case "OPENPGPKEY":
      case "SMIMEA":
      case "SSHFP":
      case "TLSA":
      case "URI":
        content = record.value.trim();
        break;
      default:
        content = record.value.trim();
    }

    byTypeAndHost[key].records.push({ content, disabled: false });
  });

  // Convert to rrsets
  Object.values(byTypeAndHost).forEach(({ type, name, records }) => {
    rrsets.push({
      name,
      type,
      ttl: defaultTtl,
      records,
      comments: [],
    });
  });

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
  const [simple, setSimple] = useState({ records: [], other: [] });
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
  const handleAddRow = () => {
    setSimple((prev) => ({
      ...prev,
      records: [...prev.records, { type: "A", host: "@", value: "" }],
    }));
  };

  const handleUpdateRow = (index, field, value) => {
    setSimple((prev) => {
      const records = [...prev.records];
      records[index] = { ...records[index], [field]: value };
      return { ...prev, records };
    });
  };

  const handleDeleteRow = (index) => {
    setSimple((prev) => ({
      ...prev,
      records: prev.records.filter((_, i) => i !== index),
    }));
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

              <h3>DNS Records</h3>
              <p className="muted">
                Add DNS records for your zone. Select the record type and fill in
                the required fields. Use <code>@</code> for the zone root.
              </p>

              <div style={{ overflowX: "auto" }}>
                <table className="zones-table" style={{ marginBottom: 14 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 100 }}>Type</th>
                      <th style={{ minWidth: 120 }}>Host</th>
                      <th style={{ minWidth: 200 }}>Value</th>
                      <th style={{ width: 70 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {simple.records.map((row, i) => {
                      const renderFields = () => {
                        switch (row.type) {
                          case "A":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="192.0.2.1"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "AAAA":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="2001:db8::1"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "CNAME":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="target.example.com."
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "MX":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.priority || "10"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "priority", e.target.value)
                                  }
                                  placeholder="10"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 70 }}
                                  title="Priority"
                                />
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="mail.example.com."
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                />
                              </div>
                            );
                          case "TXT":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="v=spf1 include:_spf.example.com ~all"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "PTR":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="hostname.example.com."
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "SRV":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.priority || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "priority", e.target.value)
                                  }
                                  placeholder="0"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Priority"
                                />
                                <input
                                  type="number"
                                  value={row.weight || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "weight", e.target.value)
                                  }
                                  placeholder="0"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Weight"
                                />
                                <input
                                  type="number"
                                  value={row.port || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "port", e.target.value)
                                  }
                                  placeholder="443"
                                  min={0}
                                  max={65535}
                                  disabled={recordsDisabled}
                                  style={{ width: 70 }}
                                  title="Port"
                                />
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="target.example.com."
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                  title="Target"
                                />
                              </div>
                            );
                          case "CAA":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.flags || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "flags", e.target.value)
                                  }
                                  placeholder="0"
                                  min={0}
                                  max={255}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Flags"
                                />
                                <select
                                  value={row.tag || "issue"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "tag", e.target.value)
                                  }
                                  disabled={recordsDisabled}
                                  style={{ width: 100 }}
                                  title="Tag"
                                >
                                  <option value="issue">issue</option>
                                  <option value="issuewild">issuewild</option>
                                  <option value="iodef">iodef</option>
                                </select>
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="letsencrypt.org"
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                  title="Value"
                                />
                              </div>
                            );
                          case "CERT":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.certType || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "certType", e.target.value)
                                  }
                                  placeholder="Type"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 70 }}
                                  title="Cert Type"
                                />
                                <input
                                  type="number"
                                  value={row.keyTag || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "keyTag", e.target.value)
                                  }
                                  placeholder="Key Tag"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 80 }}
                                  title="Key Tag"
                                />
                                <input
                                  type="number"
                                  value={row.algorithm || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "algorithm", e.target.value)
                                  }
                                  placeholder="Algo"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 70 }}
                                  title="Algorithm"
                                />
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="Certificate data"
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                  title="Certificate"
                                />
                              </div>
                            );
                          case "DNSKEY":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.flags || "256"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "flags", e.target.value)
                                  }
                                  placeholder="256"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 70 }}
                                  title="Flags"
                                />
                                <input
                                  type="number"
                                  value={row.protocol || "3"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "protocol", e.target.value)
                                  }
                                  placeholder="3"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Protocol"
                                />
                                <input
                                  type="number"
                                  value={row.algorithm || "8"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "algorithm", e.target.value)
                                  }
                                  placeholder="8"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Algorithm"
                                />
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="Public key data"
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                  title="Public Key"
                                />
                              </div>
                            );
                          case "DS":
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  type="number"
                                  value={row.keyTag || "0"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "keyTag", e.target.value)
                                  }
                                  placeholder="Key Tag"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 80 }}
                                  title="Key Tag"
                                />
                                <input
                                  type="number"
                                  value={row.algorithm || "8"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "algorithm", e.target.value)
                                  }
                                  placeholder="8"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Algorithm"
                                />
                                <input
                                  type="number"
                                  value={row.digestType || "2"}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "digestType", e.target.value)
                                  }
                                  placeholder="2"
                                  min={0}
                                  disabled={recordsDisabled}
                                  style={{ width: 60 }}
                                  title="Digest Type"
                                />
                                <input
                                  type="text"
                                  value={row.value || ""}
                                  onChange={(e) =>
                                    handleUpdateRow(i, "value", e.target.value)
                                  }
                                  placeholder="Digest (hex)"
                                  disabled={recordsDisabled}
                                  style={{ flex: 1 }}
                                  title="Digest"
                                />
                              </div>
                            );
                          case "HTTPS":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="1 . alpn=h3,h2"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "SVCB":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="1 target.example.com. alpn=h2"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "SSHFP":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="1 1 123456789abcdef..."
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "TLSA":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="3 1 1 123456789abcdef..."
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "LOC":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="51 30 12.748 N 0 7 39.611 W 0.00m"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "NAPTR":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder='100 10 "U" "E2U+sip" "!^.*$!sip:info@example.com!" .'
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          case "URI":
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder='10 1 "https://example.com/path"'
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                          default:
                            return (
                              <input
                                type="text"
                                value={row.value || ""}
                                onChange={(e) =>
                                  handleUpdateRow(i, "value", e.target.value)
                                }
                                placeholder="Enter record data"
                                disabled={recordsDisabled}
                                style={{ width: "100%" }}
                              />
                            );
                        }
                      };

                      return (
                        <tr key={i}>
                          <td>
                            <select
                              value={row.type}
                              onChange={(e) =>
                                handleUpdateRow(i, "type", e.target.value)
                              }
                              disabled={recordsDisabled}
                            >
                              <option value="A">A</option>
                              <option value="AAAA">AAAA</option>
                              <option value="CAA">CAA</option>
                              <option value="CERT">CERT</option>
                              <option value="CNAME">CNAME</option>
                              <option value="DNSKEY">DNSKEY</option>
                              <option value="DS">DS</option>
                              <option value="HTTPS">HTTPS</option>
                              <option value="LOC">LOC</option>
                              <option value="MX">MX</option>
                              <option value="NAPTR">NAPTR</option>
                              <option value="OPENPGPKEY">OPENPGPKEY</option>
                              <option value="PTR">PTR</option>
                              <option value="SMIMEA">SMIMEA</option>
                              <option value="SRV">SRV</option>
                              <option value="SSHFP">SSHFP</option>
                              <option value="SVCB">SVCB</option>
                              <option value="TLSA">TLSA</option>
                              <option value="TXT">TXT</option>
                              <option value="URI">URI</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.host || ""}
                              onChange={(e) =>
                                handleUpdateRow(i, "host", e.target.value)
                              }
                              placeholder="@"
                              disabled={recordsDisabled}
                            />
                          </td>
                          <td>{renderFields()}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => handleDeleteRow(i)}
                              disabled={recordsDisabled}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {simple.records.length === 0 && (
                      <tr>
                        <td colSpan="4">
                          <span className="muted">No DNS records yet.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddRow}
                style={{ marginBottom: 16 }}
                disabled={recordsDisabled}
              >
                + Add record
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
