// Native vs broadcast ("原生 / 广播") detection via RIR registration data.
// The community definition: an IP whose registration region matches the region
// it is used from is native; a mismatch means the space was announced/used
// somewhere else than it was registered (broadcast). RDAP is free, keyless,
// and generous — we cache per /24 because neighbouring addresses usually
// share the allocation.

const rdapCache = new Map(); // /24 -> {country, name, net} | null

// ARIN hides the country inside the registrant's vcard address as an English
// name ("United States"), not an ISO code. Build the reverse map once from
// Intl.DisplayNames — zero data files needed.
let ccByName = null;
function countryNameToCc(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase();
  if (!ccByName) {
    ccByName = new Map();
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      for (let i = 65; i <= 90; i++) {
        for (let j = 65; j <= 90; j++) {
          const cc = String.fromCharCode(i) + String.fromCharCode(j);
          try {
            const display = dn.of(cc);
            if (display && display !== cc) ccByName.set(display.toLowerCase(), cc);
          } catch {
            /* non-country code */
          }
        }
      }
    } catch {
      return null;
    }
  }
  return ccByName.get(n) || null;
}

function countryFromEntities(data) {
  for (const e of data.entities || []) {
    if (!(e.roles || []).some((r) => /registrant/i.test(r))) continue;
    const vcard = (e.vcardArray || [])[1] || [];
    for (const item of vcard) {
      if (item[0] !== "adr") continue;
      const label = item[1]?.label || "";
      const lines = label.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const cc = countryNameToCc(lines[lines.length - 1]);
      if (cc) return cc;
    }
  }
  return null;
}

export function subnetKey(ip) {
  const parts = String(ip).split(".");
  return parts.length === 4 ? parts.slice(0, 3).join(".") : ip;
}

export function parseRdap(data) {
  if (!data || typeof data !== "object") return null;
  let country = String(data.country || "").toUpperCase() || null;
  if (!country) country = countryFromEntities(data);
  const name = String(data.name || "").slice(0, 60) || null;
  if (!country && !name) return null;
  return { country, name, net: data.handle || null };
}

export function nativenessOf(rirCountry, geoCc) {
  if (!rirCountry || !geoCc) return null;
  return rirCountry === String(geoCc).toUpperCase() ? "原生" : "广播";
}

// fetchImpl injectable for tests. Failures degrade to null — never crash a run.
export function makeRdapLookup({ fetchImpl = fetch, timeout = 6000, cache = rdapCache } = {}) {
  return async function lookupRdap(ip) {
    const key = subnetKey(ip);
    if (cache.has(key)) return cache.get(key);
    let result = null;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const res = await fetchImpl(`https://rdap.org/ip/${ip}`, {
        signal: ac.signal,
        // ARIN (and friends) 403 requests without a User-Agent.
        headers: {
          "User-Agent": "ipure/1.0 (github.com/ecoreal/ipure)",
          Accept: "application/rdap+json, application/json",
        },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (res.ok) result = parseRdap(await res.json());
    } catch {
      result = null;
    }
    cache.set(key, result);
    return result;
  };
}

export async function lookupRdapBatch(ips, opts = {}) {
  const lookup = makeRdapLookup(opts);
  const out = new Map();
  const conc = opts.conc || 4;
  let next = 0;
  const list = [...new Set(ips.filter(Boolean))];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(conc, list.length)) }, async () => {
      while (next < list.length) {
        const ip = list[next++];
        out.set(ip, await lookup(ip));
      }
    }),
  );
  return out;
}
