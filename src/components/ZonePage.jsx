// src/components/ZonePage.jsx
import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import { Icon, Alert, Loading, Chip, EmptyState } from "./ui.jsx";

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

    if (["A", "AAAA", "CNAME", "TXT", "PTR"].includes(rr.type)) {
      rr.records.forEach((r) =>
        records.push({ type: rr.type, host, ttl: rr.ttl, value: r.content })
      );
    } else if (rr.type === "MX") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const priority = parts[0] || "10";
        const target = parts.slice(1).join(" ") || "";
        records.push({ type: "MX", host, ttl: rr.ttl, priority, value: target });
      });
    } else if (rr.type === "SRV") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const priority = parts[0] || "0";
        const weight = parts[1] || "0";
        const port = parts[2] || "0";
        const target = parts.slice(3).join(" ") || "";
        records.push({ type: "SRV", host, ttl: rr.ttl, priority, weight, port, value: target });
      });
    } else if (rr.type === "CAA") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const flags = parts[0] || "0";
        const tag = parts[1] || "issue";
        const caaValue = parts.slice(2).join(" ").replace(/^"(.*)"$/, "$1") || "";
        records.push({ type: "CAA", host, ttl: rr.ttl, flags, tag, value: caaValue });
      });
    } else if (rr.type === "CERT") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const certType = parts[0] || "0";
        const keyTag = parts[1] || "0";
        const algorithm = parts[2] || "0";
        const certificate = parts.slice(3).join(" ") || "";
        records.push({ type: "CERT", host, ttl: rr.ttl, certType, keyTag, algorithm, value: certificate });
      });
    } else if (rr.type === "DNSKEY") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const flags = parts[0] || "256";
        const protocol = parts[1] || "3";
        const algorithm = parts[2] || "8";
        const publicKey = parts.slice(3).join(" ") || "";
        records.push({ type: "DNSKEY", host, ttl: rr.ttl, flags, protocol, algorithm, value: publicKey });
      });
    } else if (rr.type === "DS") {
      rr.records.forEach((r) => {
        const parts = r.content.trim().split(/\s+/);
        const keyTag = parts[0] || "0";
        const algorithm = parts[1] || "8";
        const digestType = parts[2] || "2";
        const digest = parts.slice(3).join(" ") || "";
        records.push({ type: "DS", host, ttl: rr.ttl, keyTag, algorithm, digestType, value: digest });
      });
    } else if (["HTTPS", "SVCB", "LOC", "NAPTR", "OPENPGPKEY", "SMIMEA", "SSHFP", "TLSA", "URI"].includes(rr.type)) {
      rr.records.forEach((r) =>
        records.push({ type: rr.type, host, ttl: rr.ttl, value: r.content })
      );
    } else {
      other.push(rr);
    }
  });

  return { records, other };
}

function simpleToRrsets(simple, zoneName, defaultTtl = 3600) {
  const rrsets = [...simple.other];
  const byTypeAndHost = {};

  simple.records.forEach((record) => {
    if (!record.value) return;

    const key = `${record.type}||${hostToFqdn(record.host, zoneName)}`;
    if (!byTypeAndHost[key]) {
      byTypeAndHost[key] = {
        type: record.type,
        name: hostToFqdn(record.host, zoneName),
        ttl: Number(record.ttl) || defaultTtl,
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
      default:
        content = record.value.trim();
    }

    byTypeAndHost[key].records.push({ content, disabled: false });
  });

  Object.values(byTypeAndHost).forEach(({ type, name, ttl, records }) => {
    rrsets.push({
      name,
      type,
      ttl,
      records,
      comments: [],
    });
  });

  return rrsets;
}

// Compare two rrset arrays (by type+name) for the snapshot diff view.
function diffRrsets(before, after) {
  const keyOf = (rr) => `${rr.type}||${rr.name}`;
  const contentsOf = (rr) => ((rr && rr.records) || []).map((r) => r.content);
  const skip = (rr) => rr.type === "SOA";
  const bBy = {};
  (before || []).filter((rr) => !skip(rr)).forEach((rr) => (bBy[keyOf(rr)] = rr));
  const aBy = {};
  (after || []).filter((rr) => !skip(rr)).forEach((rr) => (aBy[keyOf(rr)] = rr));

  const added = [];
  const removed = [];
  const changed = [];
  Object.keys(aBy).forEach((k) => {
    if (!bBy[k]) {
      added.push(aBy[k]);
    } else {
      const bRec = contentsOf(bBy[k]);
      const aRec = contentsOf(aBy[k]);
      const same =
        bBy[k].ttl === aBy[k].ttl &&
        JSON.stringify(bRec.slice().sort()) === JSON.stringify(aRec.slice().sort());
      if (!same) changed.push({ before: bBy[k], after: aBy[k] });
    }
  });
  Object.keys(bBy).forEach((k) => {
    if (!aBy[k]) removed.push(bBy[k]);
  });
  return { added, removed, changed };
}

const RECORD_TYPES = [
  "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX",
  "NAPTR", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SSHFP", "SVCB", "TLSA", "TXT", "URI",
];

// Per-type extra fields rendered before the main value input.
const TYPE_FIELDS = {
  MX: [{ key: "priority", label: "Priority", input: "number", def: "10" }],
  SRV: [
    { key: "priority", label: "Priority", input: "number", def: "0" },
    { key: "weight", label: "Weight", input: "number", def: "0" },
    { key: "port", label: "Port", input: "number", def: "443" },
  ],
  CAA: [
    { key: "flags", label: "Flags", input: "number", def: "0" },
    { key: "tag", label: "Tag", input: "select", options: ["issue", "issuewild", "iodef"], def: "issue" },
  ],
  CERT: [
    { key: "certType", label: "Type", input: "number", def: "0" },
    { key: "keyTag", label: "Key tag", input: "number", def: "0" },
    { key: "algorithm", label: "Algorithm", input: "number", def: "0" },
  ],
  DNSKEY: [
    { key: "flags", label: "Flags", input: "number", def: "256" },
    { key: "protocol", label: "Protocol", input: "number", def: "3" },
    { key: "algorithm", label: "Algorithm", input: "number", def: "8" },
  ],
  DS: [
    { key: "keyTag", label: "Key tag", input: "number", def: "0" },
    { key: "algorithm", label: "Algorithm", input: "number", def: "8" },
    { key: "digestType", label: "Digest type", input: "number", def: "2" },
  ],
};

const VALUE_META = {
  A: { label: "IPv4 address", placeholder: "192.0.2.1" },
  AAAA: { label: "IPv6 address", placeholder: "2001:db8::1" },
  CNAME: { label: "Target", placeholder: "target.example.com." },
  MX: { label: "Mail server", placeholder: "mail.example.com." },
  TXT: { label: "Content", placeholder: "v=spf1 include:_spf.example.com ~all" },
  PTR: { label: "Hostname", placeholder: "hostname.example.com." },
  SRV: { label: "Target", placeholder: "target.example.com." },
  CAA: { label: "Value", placeholder: "letsencrypt.org" },
  CERT: { label: "Certificate", placeholder: "Certificate data" },
  DNSKEY: { label: "Public key", placeholder: "Public key data" },
  DS: { label: "Digest", placeholder: "Digest (hex)" },
  HTTPS: { label: "Value", placeholder: "1 . alpn=h3,h2" },
  SVCB: { label: "Value", placeholder: "1 target.example.com. alpn=h2" },
  SSHFP: { label: "Value", placeholder: "1 1 123456789abcdef…" },
  TLSA: { label: "Value", placeholder: "3 1 1 123456789abcdef…" },
  LOC: { label: "Value", placeholder: "51 30 12.748 N 0 7 39.611 W 0.00m" },
  NAPTR: { label: "Value", placeholder: '100 10 "U" "E2U+sip" "!^.*$!sip:info@example.com!" .' },
  URI: { label: "Value", placeholder: '10 1 "https://example.com/path"' },
};

function RecordRow({ row, index, onChange, onDelete, disabled, defaultTtl }) {
  const extras = TYPE_FIELDS[row.type] || [];
  const meta = VALUE_META[row.type] || { label: "Value", placeholder: "Record data" };

  return (
    <div className="rec-row">
      <div className="rec-field">
        <label>Type</label>
        <select
          value={row.type}
          onChange={(e) => onChange(index, "type", e.target.value)}
          disabled={disabled}
        >
          {RECORD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="rec-field">
        <label>Host</label>
        <input
          type="text"
          value={row.host || ""}
          onChange={(e) => onChange(index, "host", e.target.value)}
          placeholder="@ (zone root)"
          disabled={disabled}
        />
      </div>

      <div className="rec-sub">
        <div className="rec-field" style={{ maxWidth: 100 }}>
          <label>TTL</label>
          <input
            type="number"
            value={row.ttl ?? ""}
            onChange={(e) => onChange(index, "ttl", e.target.value)}
            placeholder={String(defaultTtl || 3600)}
            min={60}
            disabled={disabled}
            title="Time to live (seconds). Records with the same type and host share one TTL."
          />
        </div>
        {extras.map((f) =>
          f.input === "select" ? (
            <div className="rec-field" key={f.key} style={{ maxWidth: 120 }}>
              <label>{f.label}</label>
              <select
                value={row[f.key] || f.def}
                onChange={(e) => onChange(index, f.key, e.target.value)}
                disabled={disabled}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rec-field" key={f.key} style={{ maxWidth: 110 }}>
              <label>{f.label}</label>
              <input
                type="number"
                value={row[f.key] ?? f.def}
                onChange={(e) => onChange(index, f.key, e.target.value)}
                placeholder={f.def}
                min={0}
                disabled={disabled}
              />
            </div>
          )
        )}
        <div className="rec-field grow">
          <label>{meta.label}</label>
          <input
            type="text"
            value={row.value || ""}
            onChange={(e) => onChange(index, "value", e.target.value)}
            placeholder={meta.placeholder}
            disabled={disabled}
          />
        </div>
      </div>

      <button
        type="button"
        className="icon-btn rec-del"
        onClick={() => onDelete(index)}
        disabled={disabled}
        aria-label="Delete record"
        title="Delete record"
      >
        <Icon name="trash" size={17} />
      </button>
    </div>
  );
}

export default function ZonePage({ token, zoneName, onBack, isAdminEdit = false }) {
  const [tab, setTab] = useState("records"); // records | nameservers | advanced | snapshots
  const [loading, setLoading] = useState(true);

  const [snapshots, setSnapshots] = useState([]);

  const [delegationMode, setDelegationMode] = useState("internal");
  const [externalNsText, setExternalNsText] = useState("");

  const [hasInternalZone, setHasInternalZone] = useState(true);
  const [simple, setSimple] = useState({ records: [], other: [] });
  const [ttl, setTtl] = useState(3600);
  const [rrsetsText, setRrsetsText] = useState("[]");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Sharing (owner-managed access)
  const [access, setAccess] = useState(null);
  const [managerEmail, setManagerEmail] = useState("");

  // Snapshot diff expansion: { [snapId]: {loading, diff} }
  const [snapDiffs, setSnapDiffs] = useState({});
  const [openSnap, setOpenSnap] = useState(null);

  // Note: doesn't clear message/error - callers set their own success or
  // failure feedback right before/after reloading, and clearing here would
  // wipe it in the same render batch.
  const reloadZone = async () => {
    setLoading(true);

    try {
      const endpoint = isAdminEdit ? `/admin/zones/${zoneName}/details` : `/zones/${zoneName}`;
      const data = await apiRequest(endpoint, { token });

      setDelegationMode(data.delegation?.mode || "internal");
      setExternalNsText((data.delegation?.externalNs || []).join("\n"));
      setAccess(data.access || null);

      setHasInternalZone(
        typeof data.hasInternalZone === "boolean" ? data.hasInternalZone : true
      );

      const rrsets = data.rrsets || [];
      const zoneTtl = rrsets[0]?.ttl || 3600;
      setTtl(zoneTtl);

      const simpleParsed = rrsetsToSimple(rrsets, zoneName);
      setSimple(simpleParsed);
      setRrsetsText(JSON.stringify(rrsets, null, 2));

      if (isAdminEdit) {
        const snap = await apiRequest(`/admin/zones/${zoneName}/snapshots`, { token });
        setSnapshots(snap.snapshots || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreSnapshot = async (snap) => {
    if (
      !confirm(
        `Restore "${zoneName}" to its state from ${new Date(snap.created_at).toLocaleString()} (${snap.record_count} record sets)? The current state is snapshotted first, so this can be undone.`
      )
    ) {
      return;
    }
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/zones/${zoneName}/snapshots/${snap.id}/restore`, {
        method: "POST",
        token,
      });
      setMessage("Zone restored from snapshot.");
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleSnapshotDiff = async (snap) => {
    if (openSnap === snap.id) {
      setOpenSnap(null);
      return;
    }
    setOpenSnap(snap.id);
    if (snapDiffs[snap.id]) return; // cached
    setSnapDiffs((prev) => ({ ...prev, [snap.id]: { loading: true } }));
    try {
      const data = await apiRequest(`/admin/zones/${zoneName}/snapshots/${snap.id}`, { token });
      let current = [];
      try {
        current = JSON.parse(rrsetsText) || [];
      } catch {
        /* current state unavailable */
      }
      const diff = diffRrsets(data.rrsets || [], current);
      setSnapDiffs((prev) => ({ ...prev, [snap.id]: { loading: false, diff } }));
    } catch (err) {
      setSnapDiffs((prev) => ({ ...prev, [snap.id]: { loading: false, error: err.message } }));
    }
  };

  useEffect(() => {
    setError("");
    setMessage("");
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
      const data = await apiRequest(endpoint, {
        method: "PUT",
        token,
        body: { mode: delegationMode, externalNs },
      });
      setMessage(
        data.restored > 0
          ? `Nameservers updated. Restored ${data.restored} record set(s) from before the external delegation.`
          : "Nameservers updated successfully."
      );
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddRow = () => {
    setSimple((prev) => ({
      ...prev,
      records: [...prev.records, { type: "A", host: "", ttl: "", value: "" }],
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
        "This zone is currently using an external DNS provider. Switch to Anglican DNS in the Nameservers tab to edit records here."
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
        "This zone is currently using an external DNS provider. Switch to Anglican DNS in the Nameservers tab to edit records here."
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

  const handleAddManager = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await apiRequest(`/zones/${zoneName}/managers`, {
        method: "POST",
        token,
        body: { email: managerEmail.trim() },
      });
      setMessage(`${managerEmail.trim()} can now manage this zone.`);
      setManagerEmail("");
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTransferOwner = async (m) => {
    if (
      !confirm(
        `Make ${m.email} the owner of ${zoneName}? ${access && access.is_owner && !isAdminEdit ? "You will stay on the zone as a manager." : "The previous owner stays on the zone as a manager."}`
      )
    )
      return;
    setError("");
    setMessage("");
    try {
      await apiRequest(`/zones/${zoneName}/transfer-owner`, {
        method: "POST",
        token,
        body: { userId: m.id },
      });
      setMessage(`${m.email} is now the owner of this zone.`);
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveManager = async (m) => {
    if (!confirm(`Remove ${m.email} from this zone?`)) return;
    setError("");
    setMessage("");
    try {
      await apiRequest(`/zones/${zoneName}/managers/${m.id}`, {
        method: "DELETE",
        token,
      });
      setMessage(`${m.email} no longer has access.`);
      await reloadZone();
    } catch (err) {
      setError(err.message);
    }
  };

  const recordsDisabled = delegationMode === "external" || !hasInternalZone;

  return (
    <div className="zone-page">
      <div className="page-header" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0, flexWrap: "wrap" }}>
          <button className="icon-btn" onClick={onBack} aria-label="Back" title="Back">
            <Icon name="back" size={20} />
          </button>
          <h1 style={{ wordBreak: "break-all" }}>{zoneName}</h1>
          {!loading && (
            <Chip tone={delegationMode === "external" ? "amber" : "teal"}>
              {delegationMode === "external" ? "External DNS" : "Anglican DNS"}
            </Chip>
          )}
        </div>
      </div>

      {loading && <Loading label="Loading zone…" />}
      <Alert type="error">{error}</Alert>
      <Alert type="success">{message}</Alert>

      {!loading && (
        <>
          <div className="tabs" role="tablist">
            <button role="tab" className={`tab ${tab === "records" ? "active" : ""}`} onClick={() => setTab("records")}>
              Records
            </button>
            <button role="tab" className={`tab ${tab === "nameservers" ? "active" : ""}`} onClick={() => setTab("nameservers")}>
              Nameservers
            </button>
            <button role="tab" className={`tab ${tab === "advanced" ? "active" : ""}`} onClick={() => setTab("advanced")}>
              Advanced
            </button>
            {access && (
              <button role="tab" className={`tab ${tab === "sharing" ? "active" : ""}`} onClick={() => setTab("sharing")}>
                {isAdminEdit ? "Users" : "Sharing"}
              </button>
            )}
            {isAdminEdit && (
              <button role="tab" className={`tab ${tab === "snapshots" ? "active" : ""}`} onClick={() => setTab("snapshots")}>
                Snapshots
              </button>
            )}
          </div>

          {recordsDisabled && tab !== "nameservers" && tab !== "snapshots" && (
            <Alert type="error">
              This zone uses an external DNS provider or has no internal zone
              configured, so records are read-only. Switch to{" "}
              <strong>Anglican DNS</strong> in the Nameservers tab to manage
              records here.
            </Alert>
          )}

          {tab === "records" && (
            <form onSubmit={handleSaveBasic} className="card">
              <div className="card-header">
                <div>
                  <h2>DNS records</h2>
                  <p className="muted">
                    Use <code>@</code> as the host for the zone root. Leave a
                    record's TTL blank to use the zone default.
                  </p>
                </div>
                <label className="field ttl-field">
                  <span>Default TTL (seconds)</span>
                  <input
                    type="number"
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                    min={60}
                    disabled={recordsDisabled}
                  />
                </label>
              </div>

              {simple.records.length === 0 ? (
                <EmptyState icon="server" title="No records yet">
                  Add your first DNS record — for example an A record pointing
                  your domain at your web host.
                </EmptyState>
              ) : (
                <div className="rec-list">
                  {simple.records.map((row, i) => (
                    <RecordRow
                      key={i}
                      row={row}
                      index={i}
                      onChange={handleUpdateRow}
                      onDelete={handleDeleteRow}
                      disabled={recordsDisabled}
                      defaultTtl={ttl}
                    />
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddRow}
                disabled={recordsDisabled}
              >
                <Icon name="plus" size={16} />
                Add record
              </button>

              <div className="save-bar">
                <button className="btn btn-primary" type="submit" disabled={recordsDisabled}>
                  <Icon name="check" size={16} />
                  Save changes
                </button>
                <span className="muted">Changes go live within minutes.</span>
              </div>
            </form>
          )}

          {tab === "nameservers" && (
            <form onSubmit={handleSaveDelegation} className="card">
              <div className="card-header">
                <div>
                  <h2>Nameservers</h2>
                  <p className="muted">
                    Choose where this domain's DNS is hosted. Changing this
                    updates the <code>NS</code> records in the parent zone.
                  </p>
                </div>
              </div>

              <div className="choice-group">
                <label className={`choice ${delegationMode === "internal" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    value="internal"
                    checked={delegationMode === "internal"}
                    onChange={() => setDelegationMode("internal")}
                  />
                  <span>
                    <span className="choice-title">Anglican DNS (recommended)</span>
                    <span className="choice-sub" style={{ display: "block" }}>
                      Manage records right here — nothing else to set up.
                    </span>
                  </span>
                </label>

                <label className={`choice ${delegationMode === "external" ? "selected" : ""}`}>
                  <input
                    type="radio"
                    value="external"
                    checked={delegationMode === "external"}
                    onChange={() => setDelegationMode("external")}
                  />
                  <span>
                    <span className="choice-title">External DNS provider</span>
                    <span className="choice-sub" style={{ display: "block" }}>
                      Point the domain at nameservers you manage elsewhere.
                    </span>
                  </span>
                </label>
              </div>

              {delegationMode === "external" && (
                <label className="field">
                  <span>External nameservers (one per line)</span>
                  <textarea
                    rows={4}
                    value={externalNsText}
                    onChange={(e) => setExternalNsText(e.target.value)}
                    placeholder={"ns1.example.net.\nns2.example.net."}
                  />
                  <span className="hint">
                    Use fully-qualified names ending with a dot, e.g.{" "}
                    <code>ns1.example.net.</code>
                  </span>
                </label>
              )}

              <div className="save-bar">
                <button className="btn btn-primary" type="submit">
                  <Icon name="check" size={16} />
                  Save nameservers
                </button>
              </div>
            </form>
          )}

          {tab === "advanced" && (
            <form onSubmit={handleSaveAdvanced} className="card">
              <div className="card-header">
                <div>
                  <h2>Advanced JSON editor</h2>
                  <p className="muted">
                    Full RRset JSON for power users. Saving here overwrites
                    changes made in the Records tab.
                  </p>
                </div>
              </div>
              <textarea
                className="code-area"
                rows={20}
                value={rrsetsText}
                onChange={(e) => setRrsetsText(e.target.value)}
                disabled={recordsDisabled}
                spellCheck={false}
              />
              <div className="save-bar">
                <button className="btn btn-secondary" type="submit" disabled={recordsDisabled}>
                  Save JSON
                </button>
              </div>
            </form>
          )}

          {tab === "sharing" && access && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>Who can manage this zone</h2>
                  <p className="muted">
                    {isAdminEdit
                      ? "Everyone linked to this zone. You can add managers, remove them, or transfer ownership."
                      : access.is_owner
                      ? "As the owner you can invite other registered users to manage records with you, or hand ownership to one of them."
                      : "Only the zone owner can change who has access."}
                  </p>
                </div>
              </div>

              <div className="snap-list">
                <div className="snap-item">
                  <div className="snap-info">
                    <div className="snap-when">{access.owner_email || "Unassigned"}</div>
                    <div className="snap-meta">Owner</div>
                  </div>
                  <Chip tone="teal">owner</Chip>
                </div>
                {access.managers.map((m) => (
                  <div key={m.id} className="snap-item">
                    <div className="snap-info">
                      <div className="snap-when">{m.email}</div>
                      <div className="snap-meta">Manager</div>
                    </div>
                    {access.is_owner && (
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => handleTransferOwner(m)} title="Transfer ownership to this user">
                          <Icon name="key" size={14} />
                          Make owner
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleRemoveManager(m)}>
                          <Icon name="x" size={14} />
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {access.managers.length === 0 && (
                  <p className="muted">No additional managers yet.</p>
                )}
              </div>

              {access.is_owner && (
                <form onSubmit={handleAddManager} className="save-bar" style={{ alignItems: "flex-end" }}>
                  <label className="field" style={{ marginBottom: 0, flex: 1, maxWidth: 320 }}>
                    <span>Add a manager by email</span>
                    <input
                      type="email"
                      value={managerEmail}
                      onChange={(e) => setManagerEmail(e.target.value)}
                      placeholder="colleague@parish.org"
                      required
                    />
                  </label>
                  <button className="btn btn-primary" type="submit">
                    <Icon name="plus" size={16} />
                    Add manager
                  </button>
                </form>
              )}
            </div>
          )}

          {tab === "snapshots" && isAdminEdit && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>Snapshots</h2>
                  <p className="muted">
                    A snapshot is taken automatically before every change.
                    Restore one to roll the zone back.
                  </p>
                </div>
              </div>
              {snapshots.length === 0 ? (
                <EmptyState icon="history" title="No snapshots yet">
                  Snapshots will appear here after the first change to this zone.
                </EmptyState>
              ) : (
                <div className="snap-list">
                  {snapshots.map((snap) => {
                    const diffState = snapDiffs[snap.id];
                    const isOpen = openSnap === snap.id;
                    return (
                      <div key={snap.id}>
                        <div className="snap-item" style={isOpen ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined}>
                          <div className="snap-info">
                            <div className="snap-when">
                              {new Date(snap.created_at).toLocaleString("en-GB", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                            <div className="snap-meta">
                              {snap.record_count} record sets
                              {snap.reason ? ` · ${snap.reason}` : ""}
                              {snap.email ? ` · by ${snap.email}` : ""}
                            </div>
                          </div>
                          <div className="row-actions">
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleSnapshotDiff(snap)}>
                              <Icon name="chevronRight" size={15} className={`log-chev ${isOpen ? "open" : ""}`} />
                              What changed
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleRestoreSnapshot(snap)}>
                              <Icon name="history" size={15} />
                              Restore
                            </button>
                          </div>
                        </div>
                        {isOpen && (
                          <div className="log-detail" style={{ margin: "0 0 0.6rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                            {(!diffState || diffState.loading) && <p className="muted">Loading snapshot…</p>}
                            {diffState && diffState.error && <p className="muted">Couldn't load snapshot: {diffState.error}</p>}
                            {diffState && diffState.diff && (
                              diffState.diff.added.length === 0 &&
                              diffState.diff.removed.length === 0 &&
                              diffState.diff.changed.length === 0 ? (
                                <p className="muted">Identical to the current records — restoring changes nothing.</p>
                              ) : (
                                <>
                                  <p className="muted" style={{ marginBottom: "0.5rem" }}>
                                    Differences between this snapshot and the current records
                                    (restoring reverses them):
                                  </p>
                                  <ul className="diff-list">
                                    {diffState.diff.added.map((rr, i) => (
                                      <li key={`a${i}`}>
                                        <span className="diff-mark add">+</span>
                                        <code>{rr.type}</code> <code>{rr.name}</code>{" "}
                                        {(rr.records || []).map((r) => r.content).join(", ")}
                                        <span className="muted"> (TTL {rr.ttl}) — added since</span>
                                      </li>
                                    ))}
                                    {diffState.diff.changed.map((c, i) => (
                                      <li key={`c${i}`}>
                                        <span className="diff-mark mod">±</span>
                                        <code>{c.before.type}</code> <code>{c.before.name}</code>{" "}
                                        <span className="muted">
                                          {(c.before.records || []).map((r) => r.content).join(", ")} (TTL {c.before.ttl})
                                        </span>{" "}
                                        → {(c.after.records || []).map((r) => r.content).join(", ")}{" "}
                                        <span className="muted">(TTL {c.after.ttl})</span>
                                      </li>
                                    ))}
                                    {diffState.diff.removed.map((rr, i) => (
                                      <li key={`r${i}`}>
                                        <span className="diff-mark del">−</span>
                                        <code>{rr.type}</code> <code>{rr.name}</code>{" "}
                                        {(rr.records || []).map((r) => r.content).join(", ")}
                                        <span className="muted"> (TTL {rr.ttl}) — removed since</span>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
