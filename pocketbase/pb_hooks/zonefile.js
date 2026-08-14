// Minimal BIND zone file parser for the bulk-import feature.
//
// Handles the constructs found in real-world zone exports: comments,
// $ORIGIN/$TTL, multi-line parentheses (SOA), omitted owner names, relative
// names (in both owner and rdata), quoted TXT strings. SOA records are
// skipped (the app generates its own).

const KNOWN_TYPES = [
  "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR",
  "DNSKEY", "DS", "TLSA", "SSHFP", "NAPTR", "LOC", "SPF", "HTTPS",
  "SVCB", "URI", "CERT", "OPENPGPKEY", "SMIMEA", "SOA",
];
const CLASSES = ["IN", "CH", "HS"];

// strip ;comments (respecting quoted strings), return remaining text
function stripComment(line) {
  let out = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== "\\") inQuotes = !inQuotes;
    if (c === ";" && !inQuotes) break;
    out += c;
  }
  return out;
}

// split into tokens, keeping quoted strings as single tokens (quotes kept)
function tokenize(text) {
  const tokens = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if (!inQuotes && /\s/.test(c)) {
      if (cur) tokens.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function fqdnify(name, origin) {
  if (name === "@") return origin;
  if (name.endsWith(".")) return name;
  return name + "." + origin;
}

// Normalize rdata tokens into PowerDNS "content" strings,
// resolving relative hostnames against the origin.
function normalizeRdata(type, tokens, origin) {
  switch (type) {
    case "NS":
    case "CNAME":
    case "PTR":
      return fqdnify(tokens[0] || "", origin);
    case "MX":
      return `${tokens[0] || "10"} ${fqdnify(tokens[1] || "", origin)}`;
    case "SRV":
      return `${tokens[0] || "0"} ${tokens[1] || "0"} ${tokens[2] || "0"} ${fqdnify(tokens[3] || "", origin)}`;
    case "TXT":
    case "SPF": {
      const joined = tokens.join(" ");
      // PowerDNS requires quoted TXT content
      return joined.startsWith('"') ? joined : `"${joined.replace(/"/g, '\\"')}"`;
    }
    case "CAA": {
      const value = tokens.slice(2).join(" ");
      const quoted = value.startsWith('"') ? value : `"${value}"`;
      return `${tokens[0] || "0"} ${tokens[1] || "issue"} ${quoted}`;
    }
    default:
      return tokens.join(" ");
  }
}

// Parse zone file text. Returns:
//   { records: [{name (fqdn), type, ttl, content}], warnings: [string] }
function parse(text, parentDomain) {
  let origin = parentDomain.endsWith(".") ? parentDomain : parentDomain + ".";
  let defaultTtl = 3600;
  let currentName = origin;
  const records = [];
  const warnings = [];

  // merge multi-line parenthesised entries into single logical lines
  const rawLines = text.split(/\r?\n/);
  const lines = [];
  let buffer = "";
  let bufferIndented = false;
  let parenDepth = 0;
  for (const raw of rawLines) {
    const line = stripComment(raw);
    if (!buffer) {
      // owner-omitted detection uses the FIRST physical line of the entry
      bufferIndented = /^\s/.test(raw);
    }
    for (const c of line) {
      if (c === "(") parenDepth++;
      if (c === ")") parenDepth--;
    }
    buffer += (buffer ? " " : "") + line;
    if (parenDepth <= 0) {
      const merged = buffer.replace(/[()]/g, " ");
      if (merged.trim()) {
        lines.push({ text: merged, indented: bufferIndented && !merged.trim().startsWith("$") });
      }
      buffer = "";
      parenDepth = 0;
    }
  }
  if (buffer.trim()) lines.push({ text: buffer.replace(/[()]/g, " "), indented: bufferIndented });

  for (const { text: lineText, indented } of lines) {
    const trimmed = lineText.trim();
    if (!trimmed) continue;

    // directives
    if (trimmed.startsWith("$ORIGIN")) {
      origin = fqdnify(tokenize(trimmed)[1] || origin, origin);
      continue;
    }
    if (trimmed.startsWith("$TTL")) {
      defaultTtl = parseInt(tokenize(trimmed)[1]) || defaultTtl;
      continue;
    }
    if (trimmed.startsWith("$")) {
      warnings.push(`directive ignored: ${trimmed.split(/\s+/)[0]}`);
      continue;
    }

    let tokens = tokenize(trimmed);
    if (tokens.length < 2) continue;

    // owner name (omitted when the physical line started with whitespace)
    if (!indented) {
      currentName = fqdnify(tokens[0], origin);
      tokens = tokens.slice(1);
    }

    // optional ttl and class, in either order
    let ttl = defaultTtl;
    while (tokens.length) {
      if (/^\d+$/.test(tokens[0])) {
        ttl = parseInt(tokens[0]);
        tokens = tokens.slice(1);
      } else if (CLASSES.includes(tokens[0].toUpperCase())) {
        tokens = tokens.slice(1);
      } else {
        break;
      }
    }

    const type = (tokens[0] || "").toUpperCase();
    tokens = tokens.slice(1);

    if (!KNOWN_TYPES.includes(type)) {
      warnings.push(`unrecognised record skipped: ${currentName} ${type}`);
      continue;
    }
    if (type === "SOA") continue; // the app manages SOA itself

    records.push({
      name: currentName,
      type: type === "SPF" ? "TXT" : type,
      ttl: ttl,
      content: normalizeRdata(type, tokens, origin),
    });
  }

  return { records: records, warnings: warnings };
}

// Group flat records into PowerDNS rrsets ({name, type, ttl, records: [...]}).
function toRrsets(records) {
  const byKey = {};
  const order = [];
  for (const r of records) {
    const key = `${r.type}||${r.name}`;
    if (!byKey[key]) {
      byKey[key] = { name: r.name, type: r.type, ttl: r.ttl, records: [] };
      order.push(key);
    }
    byKey[key].records.push({ content: r.content, disabled: false });
  }
  return order.map((k) => byKey[k]);
}

module.exports = {
  parse: parse,
  toRrsets: toRrsets,
};
