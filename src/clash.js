// Targeted Clash/Mihomo "proxies:" extraction — no YAML dependency.
// We only need four fields per entry (name/type/server/port), so a careful
// line parser covers both real-world styles:
//   - {name: "a", server: b, port: 443, type: ss, ...}   (inline flow map)
//   - name: a \n  server: b \n port: 443 ...             (block style)
// Anything we can't confidently parse is skipped, never guessed.

// Split "a: 1, b: {c: 2}, d: 'x, y'" on commas that are outside quotes/braces.
export function splitFlowItems(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "{" || ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === "}" || ch === "]") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// One "key: value" pair; value keeps inline quotes stripped.
export function parseFlowItem(item) {
  const i = item.indexOf(":");
  if (i === -1) return null;
  const key = item.slice(0, i).trim().replace(/^["']|["']$/g, "");
  let val = item
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (val.endsWith(",")) val = val.slice(0, -1);
  return [key, val];
}

function nodeFromFields(fields) {
  const f = new Map(fields.filter(Boolean));
  const get = (k) => f.get(k);
  const server = get("server");
  const port = Number(get("port"));
  const name = get("name") || "";
  const type = (get("type") || "clash").toLowerCase();
  if (!server || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const node = {
    name: name || `${server}:${port}`,
    proto: type,
    host: String(server).toLowerCase(),
    port,
  };
  // Credentials ride along in memory for exit verification — they are never
  // copied into report rows or JSON output.
  if (get("username") !== undefined) node.username = get("username");
  if (get("password") !== undefined) node.password = get("password");
  return node;
}

export function parseClashProxies(body) {
  const lines = String(body).split(/\r?\n/);
  const start = lines.findIndex((l) => /^proxies\s*:\s*(#.*)?$/.test(l.trimEnd()));
  if (start === -1) return null;

  const nodes = [];
  let skipped = 0;
  let blockFields = null; // current "- key: value" entry being accumulated

  const flushBlock = () => {
    if (blockFields) {
      const node = nodeFromFields(blockFields);
      if (node) nodes.push(node);
      else skipped++;
      blockFields = null;
    }
  };

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // A top-level key (column 0, "word:") ends the proxies section.
    if (/^[A-Za-z_-]+\s*:/.test(line) && !line.startsWith(" ")) {
      break;
    }

    const entryMatch = trimmed.match(/^-\s*(.*)$/);
    if (entryMatch) {
      flushBlock();
      const rest = entryMatch[1].trim();
      if (rest.startsWith("{")) {
        // Inline flow map:  - {name: a, server: b, ...}
        const inner = rest.replace(/^\{/, "").replace(/\}\s*$/, "");
        const fields = splitFlowItems(inner).map(parseFlowItem);
        const node = nodeFromFields(fields);
        if (node) nodes.push(node);
        else skipped++;
      } else if (rest) {
        // Block style entry head:  - name: a
        blockFields = [parseFlowItem(rest)];
      }
      continue;
    }

    // Continuation of a block-style entry: "  server: b" (indented, with a
    // colon). Top-level keys already broke out of the loop above.
    if (blockFields && line.startsWith(" ") && trimmed.includes(":")) {
      blockFields.push(parseFlowItem(trimmed));
    }
  }
  flushBlock();

  return { nodes, skipped };
}

// Decide whether a body looks like Clash YAML at all.
export function looksLikeClash(body) {
  return /^proxies\s*:/m.test(String(body));
}
