// Webhook alerts for `ipure watch --notify`. Policy: fire when things get
// WORSE (avg drop, any IP downgraded) or below a fail-under floor — not on
// every run, unless --notify-always says otherwise. A webhook that cries
// wolf gets muted; silence is a feature.

export function shouldNotify(diff, { always = false, failUnder, avgScore } = {}) {
  if (!diff) return false;
  if (always) return true;
  if (diff.avgDelta < 0 || diff.worse.length > 0) return true;
  if (Number.isFinite(failUnder) && failUnder > 0 && avgScore < failUnder) return true;
  return false;
}

export async function sendWebhook(url, payload, { timeout = 8000, fetchImpl = fetch } = {}) {
  const started = performance.now();
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ipure-watch/1.0 (github.com/ecoreal/ipure)",
      },
      body: JSON.stringify({ source: "ipure-watch", ...payload }),
      signal: AbortSignal.timeout(timeout),
    });
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - started) };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      error: e?.cause?.code || e?.name || e?.message || "request failed",
    };
  }
}
