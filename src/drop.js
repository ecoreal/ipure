// Spamhaus DROP (Don't Route Or Peer) — hijacked / illegitimate netblocks.
// A different signal from the DNSBL check: DNSBL asks "did this IP behave
// badly", DROP asks "is this netblock even legitimate". Free text list,
// one CIDR per line with `; comment` tails.
// https://www.spamhaus.org/drop/ — free for low-volume non-commercial use.

let cache = null; // { list: [cidr...], fetchedAt }

export function parseDropList(text) {
  const cidrs = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.split(";")[0].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(trimmed)) cidrs.push(trimmed);
  }
  return cidrs;
}

export function ipToLong(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function ipInCidr(ip, cidr) {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ipLong = ipToLong(ip);
  const baseLong = ipToLong(base);
  if (ipLong == null || baseLong == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

export function inDropList(ip, list) {
  return (list || []).some((cidr) => ipInCidr(ip, cidr));
}

export function makeDropChecker({ fetchImpl = fetch, timeout = 10000, url, cache: useCache = cache } = {}) {
  const DROP_URL = url || "https://www.spamhaus.org/drop/drop.txt";
  return async function checkDrop(ip) {
    if (useCache && useCache.list) return inDropList(ip, useCache.list);
    let text;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const res = await fetchImpl(DROP_URL, {
        signal: ac.signal,
        headers: { "User-Agent": "ipure/1.2 (github.com/ecoreal/ipure)" },
      });
      clearTimeout(timer);
      if (!res.ok) return false; // list unavailable — degrade silently
      text = await res.text();
    } catch {
      return false;
    }
    const list = parseDropList(text);
    if (useCache) {
      useCache.list = list;
      useCache.fetchedAt = Date.now();
    }
    return inDropList(ip, list);
  };
}

export async function checkDropBatch(ips, opts = {}) {
  const { pool } = await import("./latency.js");
  const check = makeDropChecker(opts);
  const unique = [...new Set(ips.filter(Boolean))];
  const hits = new Map();
  if (!unique.length) return hits;
  // one list fetch serves every IP — fetch once via the first check, then
  // reuse the cache for the rest
  const first = await check(unique[0]);
  hits.set(unique[0], first);
  for (const ip of unique.slice(1)) hits.set(ip, await check(ip));
  opts.onProgress?.(hits.size, unique.length);
  return hits;
}
