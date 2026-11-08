// IP intelligence providers. Free-first: ip-api.com needs no key (batch
// endpoint, 100 IPs per request) and is the default. ipinfo.io unlocks HTTPS
// + a risk/privacy signal if you set IPINFO_TOKEN (free tier: 50k/month).
// The pure normalisers are exported separately so tests need no network.

const IP_API_FIELDS =
  "status,message,country,countryCode,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query";

export function normalizeIpApi(raw) {
  if (!raw || raw.status !== "success") {
    return { ok: false, ip: raw?.query, error: raw?.message || "query failed" };
  }
  const asnMatch = String(raw.as || "").match(/^(AS\d+)\s*(.*)$/i);
  return {
    ok: true,
    ip: raw.query,
    country: raw.country || "",
    cc: raw.countryCode || "",
    city: raw.city || "",
    isp: raw.isp || "",
    org: raw.org || "",
    asn: asnMatch ? asnMatch[1] : "",
    asnName: asnMatch ? asnMatch[2] || raw.asname || "" : raw.asname || "",
    hosting: !!raw.hosting,
    proxy: !!raw.proxy,
    mobile: !!raw.mobile,
    risk: null,
  };
}

export function normalizeIpinfo(raw) {
  const privacy = raw?.privacy || {};
  const proxyFlag = !!(
    privacy.vpn ||
    privacy.proxy ||
    privacy.tor ||
    privacy.relay
  );
  const hosting = raw?.asn?.type === "hosting" || raw?.company?.type === "hosting";
  const asnId = String(raw?.asn?.asn || "").replace(/^AS/i, "");
  return {
    ok: true,
    ip: raw?.ip,
    country: raw?.country || "",
    cc: raw?.country || "",
    city: (raw?.city || "") + (raw?.region ? `, ${raw.region}` : ""),
    isp: raw?.company?.name || "",
    org: raw?.org || "",
    asn: asnId ? `AS${asnId}` : "",
    asnName: raw?.asn?.name || "",
    hosting: !!hosting,
    proxy: proxyFlag,
    mobile: false,
    risk: null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ip-api.com batch endpoint. 100 IPs per request, 15 requests/min on the
// free tier — we chunk at 100 and pace at 4.5s between chunks.
export async function ipApiBatch(ips, { sleepMs = 4500, chunkSize = 100, onProgress } = {}) {
  const out = new Map();
  for (let i = 0; i < ips.length; i += chunkSize) {
    if (i > 0) await sleep(sleepMs);
    const chunk = ips.slice(i, i + chunkSize);
    const res = await fetch(
      `http://ip-api.com/batch?fields=${IP_API_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      },
    );
    if (!res.ok) throw new Error(`ip-api HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("ip-api: unexpected response");
    data.forEach((raw, j) => out.set(chunk[j], normalizeIpApi(raw)));
    onProgress?.(out.size, ips.length);
  }
  return out;
}

export async function ipinfoBatch(ips, token, { onProgress } = {}) {
  const out = new Map();
  const res = await fetch("https://ipinfo.io/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(ips),
  });
  if (!res.ok) throw new Error(`ipinfo HTTP ${res.status}`);
  const data = await res.json();
  for (const ip of ips) {
    out.set(ip, data[ip] ? normalizeIpinfo(data[ip]) : { ok: false, ip, error: "no data" });
  }
  onProgress?.(out.size, ips.length);
  return out;
}

export function availableProviders(env = process.env) {
  return {
    "ip-api": true,
    ipinfo: !!env.IPINFO_TOKEN,
  };
}

export async function checkIps(ips, { provider = "ip-api", token, onProgress } = {}) {
  const unique = [...new Set(ips.filter(Boolean))];
  if (!unique.length) return new Map();
  if (provider === "ipinfo") {
    if (!token) throw new Error("ipinfo 需要设置 IPINFO_TOKEN 环境变量（免费 50k/月）");
    return ipinfoBatch(unique, token, { onProgress });
  }
  return ipApiBatch(unique, { onProgress });
}
