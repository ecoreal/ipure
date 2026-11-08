// DNSBL (DNS blocklist) signal. Opt-in via --blacklist because results depend
// on the local resolver's quality. Three permissive zones — no registration,
// no query caps, and none of them ban public resolvers the way Spamhaus does.

import dns from "node:dns";

export const DNSBL_ZONES = ["bl.blocklist.de", "psbl.surriel.com", "dnsbl.sorbs.net"];

// 127.0.0.x answers mean "listed"; NXDOMAIN/servfail mean "not listed (here)".
export function isListedAnswer(addresses) {
  return (addresses || []).some((a) => /^127\.0\.0\.\d+$/.test(a));
}

export function makeBlacklistChecker({ resolver = dns.promises, zones = DNSBL_ZONES } = {}) {
  return async function checkBlacklists(ip) {
    const rev = ip.split(".").reverse().join(".");
    const hits = [];
    await Promise.all(
      zones.map(async (zone) => {
        try {
          const addrs = await resolver.resolve4(`${rev}.${zone}`);
          if (isListedAnswer(addrs)) hits.push(zone);
        } catch {
          /* NXDOMAIN / ENOTFOUND / servfail = not listed on this zone */
        }
      }),
    );
    return hits;
  };
}

// Small fixed-concurrency run over a list of IPs; returns Map ip -> hits[].
export async function checkBlacklistBatch(ips, opts = {}) {
  const check = makeBlacklistChecker(opts);
  const out = new Map();
  const conc = opts.conc || 8;
  let next = 0;
  const list = [...new Set(ips.filter(Boolean))];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(conc, list.length)) }, async () => {
      while (next < list.length) {
        const ip = list[next++];
        out.set(ip, await check(ip));
      }
    }),
  );
  return out;
}
