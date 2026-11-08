// Transparent purity scoring: every point lost or gained is itemised, so the
// number can be defended in a thread. Same spirit as the "self-developed
// composite score" that made IP-quality tools popular — but explainable.

const PENALTY = {
  hosting: 35, // datacenter IP
  proxy: 20, // flagged as proxy/VPN/Tor/relay by a risk database
  risk: 25, // provider risk score >= 75 (scaled below)
  dup: 15, // many nodes share this exit IP (capped, -3 per extra node)
  blacklist: 24, // DNSBL hits, -8 per zone (capped)
  broadcast: 8, // registered region ≠ used region
};

const BONUS = {
  mobile: 5, // carrier-grade mobile exit — about as clean as it gets
  native: 5, // registered region == used region ("原生")
};

export function purityScore(info, extras = {}) {
  const reasons = [];
  let score = 100;

  if (info?.hosting) {
    score -= PENALTY.hosting;
    reasons.push({ label: "机房 IP (hosting)", delta: -PENALTY.hosting });
  }
  if (info?.proxy) {
    score -= PENALTY.proxy;
    reasons.push({ label: "被风险库标记为代理/VPN", delta: -PENALTY.proxy });
  }
  const risk = Number(info?.risk);
  if (Number.isFinite(risk) && risk >= 25) {
    const delta = risk >= 75 ? -PENALTY.risk : risk >= 50 ? -15 : -8;
    score += delta;
    reasons.push({ label: `风险分 ${risk}`, delta });
  }
  const bl = Number(extras.blacklistHits);
  if (Number.isFinite(bl) && bl > 0) {
    const delta = -Math.min(PENALTY.blacklist, bl * 8);
    score += delta;
    reasons.push({ label: `DNSBL 黑名单命中 ${bl} 项`, delta });
  }
  // Accept both boolean and the rendered "原生"/"广播" forms.
  const native =
    extras.native === true || extras.native === "原生"
      ? true
      : extras.native === false || extras.native === "广播"
        ? false
        : null;
  if (native === true) {
    score += BONUS.native;
    reasons.push({ label: "原生 IP（注册地与使用地一致）", delta: +BONUS.native });
  } else if (native === false) {
    score -= PENALTY.broadcast;
    reasons.push({ label: "广播 IP（注册地与使用地不一致）", delta: -PENALTY.broadcast });
  }
  const dup = Number(extras.dupCount);
  if (Number.isFinite(dup) && dup > 1) {
    const delta = -Math.min(PENALTY.dup, (dup - 1) * 3);
    score += delta;
    reasons.push({ label: `${dup} 个节点共用此出口 IP`, delta });
  }
  if (info?.mobile) {
    score += BONUS.mobile;
    reasons.push({ label: "移动网络出口", delta: +BONUS.mobile });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, ...gradeOf(score), reasons };
}

export function gradeOf(score) {
  if (score >= 90) return { grade: "S", note: "原生级纯净" };
  if (score >= 75) return { grade: "A", note: "相当干净" };
  if (score >= 60) return { grade: "B", note: "可用" };
  if (score >= 40) return { grade: "C", note: "已被标记" };
  return { grade: "D", note: "建议更换" };
}

export function typeOf(info) {
  if (info?.mobile) return "移动";
  if (info?.hosting) return "机房";
  if (info?.isp) return "家宽/企业";
  return "未知";
}
