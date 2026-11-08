// Parse proxy share-link URIs into plain {name, proto, host, port} nodes.
// Supported: ss:// vmess:// vless:// trojan:// hysteria2:// hy2:// tuic:// ssr://
// We only extract the server address for measurement — no credentials are used.

const SCHEME_RE = /^([a-z0-9+.-]+):\/\//i;

function b64decode(s) {
  s = String(s).trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// "host:port" where host may be "[::1]" or a hostname.
function splitHostPort(s) {
  s = s.replace(/\/\?.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end === -1) return null;
    const host = s.slice(1, end);
    const rest = s.slice(end + 1);
    const port = rest.startsWith(":") ? rest.slice(1) : "";
    return { host, port: Number(port) || 0 };
  }
  const at = s.lastIndexOf(":");
  if (at === -1) return { host: s, port: 0 };
  const port = Number(s.slice(at + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: s.slice(0, at), port };
}

function makeNode(proto, name, host, port) {
  if (!host || !port) return null;
  return { name: name || `${host}:${port}`, proto, host: host.toLowerCase(), port };
}

function parseVmess(rest, name) {
  let json;
  try {
    json = JSON.parse(b64decode(rest));
  } catch {
    try {
      json = JSON.parse(rest);
    } catch {
      return null;
    }
  }
  if (!json || !json.add) return null;
  const port = Number(json.port);
  return makeNode("vmess", name || json.ps || "", String(json.add), port);
}

function parseSs(rest, name) {
  // Strip fragment already done by caller. Two forms:
  //   SIP002: base64(method:pass)@host:port[/...?plugin=...]
  //   legacy: base64(method:pass@host:port[?plugin=...])
  if (rest.includes("@")) {
    const idx = rest.lastIndexOf("@");
    const hostport = splitHostPort(rest.slice(idx + 1));
    return hostport ? makeNode("ss", name, hostport.host, hostport.port) : null;
  }
  let decoded;
  try {
    decoded = b64decode(rest);
  } catch {
    return null;
  }
  const at = decoded.lastIndexOf("@");
  if (at === -1) return null;
  const hostport = splitHostPort(decoded.slice(at + 1));
  return hostport ? makeNode("ss", name, hostport.host, hostport.port) : null;
}

function parseSsr(rest, name) {
  let decoded;
  try {
    decoded = b64decode(rest);
  } catch {
    return null;
  }
  const main = decoded.split("/?")[0];
  const parts = main.split(":");
  if (parts.length < 6) return null;
  // IPv6 hosts arrive bracketed as "[...]" (single field) in practice; plain
  // coloned IPv6 is ambiguous in SSR, so we only trust the bracketed form.
  const host = parts[0].replace(/^\[|\]$/g, "");
  const port = Number(parts[1]);
  return makeNode("ssr", name, host, port);
}

function parseUrlLike(uri, proto, fallbackName) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  let host = u.hostname.replace(/^\[|\]$/g, "");
  let port = Number(u.port) || 0;
  if (!port) {
    const qp = Number(u.searchParams.get("port"));
    if (qp) port = qp;
  }
  const name = fallbackName || safeDecodeURIComponent(u.hash.replace(/^#/, "")) || "";
  return makeNode(proto, name, host, port);
}

export function parseShareUri(line) {
  const raw = String(line).trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;
  const m = raw.match(SCHEME_RE);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const rest = raw.slice(m[0].length);
  const hashAt = rest.indexOf("#");
  const frag = hashAt >= 0 ? safeDecodeURIComponent(rest.slice(hashAt + 1)) : "";
  const body = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
  try {
    switch (scheme) {
      case "vmess":
        return parseVmess(body, frag);
      case "ss":
        return parseSs(body, frag);
      case "ssr":
        return parseSsr(body, frag);
      case "vless":
        return parseUrlLike(raw, "vless", frag);
      case "trojan":
        return parseUrlLike(raw, "trojan", frag);
      case "hysteria2":
      case "hy2":
        return parseUrlLike(raw, "hysteria2", frag);
      case "tuic":
        return parseUrlLike(raw, "tuic", frag);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Subscription body (plain URI list, whole-body base64, or a mix) -> nodes.
export function parseNodes(body) {
  const lines = String(body)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  let uris = lines;
  const anyUri = lines.some((l) => SCHEME_RE.test(l));
  if (!anyUri && lines.length >= 1) {
    // Whole-body base64 (the classic subscription format).
    try {
      const decoded = b64decode(lines.join(""));
      uris = decoded.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch {
      uris = lines;
    }
  }

  const nodes = [];
  const unknown = [];
  for (const l of uris) {
    const node = SCHEME_RE.test(l) ? parseShareUri(l) : null;
    if (node) nodes.push(node);
    else unknown.push(l);
  }
  return {
    nodes,
    stats: {
      total: uris.length,
      parsed: nodes.length,
      unknown: unknown.length,
      unknownSamples: unknown.slice(0, 3),
    },
  };
}

// Group nodes by exit host to expose "how many nodes share one server".
export function dedupeByHost(nodes) {
  const byHost = new Map();
  for (const n of nodes) {
    const key = `${n.host}:${n.port}`;
    if (!byHost.has(key)) byHost.set(key, []);
    byHost.get(key).push(n);
  }
  return byHost;
}
