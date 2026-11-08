// Load a subscription (URL, file path, or "-") into nodes, then resolve every
// unique server host to an IP so the purity check can run on it.

import dns from "node:dns/promises";
import fs from "node:fs";
import { parseNodes, dedupeByHost } from "./uris.js";
import { pool } from "./latency.js";

export async function loadSubscriptionText(source, { timeout = 15000 } = {}) {
  if (source === "-") {
    return await new Promise((resolve, reject) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf));
      process.stdin.on("error", reject);
    });
  }
  if (/^https?:\/\//i.test(source)) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(source, {
        signal: ac.signal,
        headers: { "User-Agent": "ipure/0.1 (subscription health check)" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    return fs.readFileSync(source, "utf8");
  } catch {
    throw new Error(`无法读取订阅源：${source}（不是 URL，也读不到本地文件）`);
  }
}

export async function resolveHosts(hosts, { conc = 8, timeout = 5000 } = {}) {
  const lookup = async (host) => {
    try {
      const r = await dns.lookup(host, { family: 0 });
      return r?.address || null;
    } catch {
      return null;
    }
  };
  const ips = await pool([...new Set(hosts)], conc, lookup);
  const map = new Map();
  [...new Set(hosts)].forEach((h, i) => map.set(h, ips[i]));
  return map;
}

// Full pipeline: source -> nodes -> hosts resolved -> grouped by host.
export async function loadSubscription(source, opts = {}) {
  const text = await loadSubscriptionText(source, opts);
  const { nodes, stats } = parseNodes(text);
  const hostMap = await resolveHosts(
    nodes.map((n) => n.host),
    { conc: opts.conc ?? 8 },
  );
  const byHost = dedupeByHost(nodes);
  return { nodes, stats, hostMap, byHost };
}
