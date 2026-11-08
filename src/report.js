// Rendering: a CJK-aware terminal table and a standalone shareable HTML card.
// The HTML file is the social artifact — screenshot it, post it, no assets
// needed, works offline.

const WIDE_RE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/gu;

export function displayWidth(s) {
  s = String(s ?? "");
  const wide = s.match(WIDE_RE)?.length ?? 0;
  return s.length - wide + wide * 2;
}

export function pad(s, n, align = "left") {
  s = String(s ?? "");
  const w = Math.max(0, n - displayWidth(s));
  return align === "right" ? " ".repeat(w) + s : s + " ".repeat(w);
}

// Pad according to the plain text, emit the colored text (ANSI codes must
// never influence width math).
function padColor(plain, colored, n, align = "right") {
  const w = Math.max(0, n - displayWidth(plain));
  return align === "right" ? " ".repeat(w) + colored : colored + " ".repeat(w);
}

export function clip(s, n) {
  s = String(s ?? "");
  const out = [];
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > n) break;
    out.push(ch);
    w += cw;
  }
  return out.join("") + (w < displayWidth(s) ? "…" : "");
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

function scoreColor(score) {
  if (score >= 75) return green;
  if (score >= 60) return yellow;
  return red;
}

function latencyPlain(row) {
  return row.latencyMs == null ? "—" : `${row.latencyMs}ms`;
}

function latencyColor(row) {
  if (row.latencyMs == null) return dim("—");
  if (row.latencyMs < 150) return green(latencyPlain(row));
  if (row.latencyMs < 400) return yellow(latencyPlain(row));
  return red(latencyPlain(row));
}

export function renderTerminal(model, { color = true } = {}) {
  const L = [];
  const { meta, summary, rows } = model;
  const d = color ? dim : (s) => String(s);
  const b = color ? bold : (s) => String(s);

  L.push(b("⏱  ipure · IP 纯净度体检"));
  L.push(
    d(`   ${meta.generatedAt} · provider: ${meta.provider} · 源: ${clip(meta.source, 58)}`),
  );
  L.push("");
  const dupWarn =
    summary.maxDup > 1
      ? color
        ? red(` · ⚠ 最多 ${summary.maxDup} 节点共用 1 个出口`)
        : ` · ⚠ 最多 ${summary.maxDup} 节点共用 1 个出口`
      : "";
  L.push(
    `   节点 ${b(summary.nodes)} · 服务器 ${b(summary.servers)} · 独立出口 IP ${b(summary.uniqueIps)}${dupWarn}`,
  );

  const avg = summary.avgScore ?? 0;
  const barLen = 10;
  const filled = Math.round((avg / 100) * barLen);
  const bar = "▇".repeat(filled) + "░".repeat(barLen - filled);
  const avgCol = color ? scoreColor(avg)(`${bar} ${avg}`) : `${bar} ${avg}`;
  L.push(
    `   纯净度 ${avgCol}/100` +
      d(` · 家宽 ${summary.residential} · 机房 ${summary.hosting} · 移动 ${summary.mobile}`) +
      (summary.failed ? (color ? red(` · 解析失败 ${summary.failed}`) : ` · 解析失败 ${summary.failed}`) : ""),
  );
  if (summary.topClean?.length) L.push(d(`   最干净: ${summary.topClean.join(" · ")}`));
  L.push("");

  const cols = { i: 4, name: 28, proto: 10, ip: 16, type: 10, lat: 7 };
  const head =
    `${pad("#", cols.i)} ${pad("节点", cols.name)} ${pad("协议", cols.proto)} ` +
    `${pad("出口 IP", cols.ip)} ${pad("类型", cols.type)} ${pad("延迟", cols.lat, "right")}  纯净度`;
  L.push(d("   " + head));
  L.push(
    d(
      "   " +
        "─".repeat(
          cols.i + cols.name + cols.proto + cols.ip + cols.type + cols.lat + 11,
        ),
    ),
  );

  rows.forEach((r, i) => {
    const name = clip(r.name, cols.name - 2);
    const ip = r.ip || "解析失败";
    const ipCell = r.ip ? ip : color ? red(ip) : ip;
    const lat = color ? latencyColor(r) : latencyPlain(r);
    const scoreText =
      r.score == null ? "  — —" : `${String(r.score).padStart(3)} ${r.grade}`;
    const scoreCell =
      r.score == null ? d(scoreText) : color ? scoreColor(r.score)(scoreText) : scoreText;
    L.push(
      `   ${d(pad(String(i + 1), cols.i))} ${pad(name, cols.name)} ` +
        `${d(pad(r.proto, cols.proto))} ${padColor(ip, ipCell, cols.ip)} ` +
        `${pad(r.type, cols.type)} ${padColor(latencyPlain(r), lat, cols.lat)}  ${scoreCell}`,
    );
  });

  if (summary.notes?.length) {
    L.push("");
    summary.notes.forEach((n) => L.push(d(`   ℹ ${n}`)));
  }
  L.push("");
  return L.join("\n");
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReportHtml(model) {
  const { meta, summary, rows } = model;
  const avg = summary.avgScore ?? 0;
  const ringColor = avg >= 75 ? "#3fb96f" : avg >= 60 ? "#d9a13c" : "#d95c4a";
  const rowsHtml = rows
    .map(
      (r, i) => `
      <tr>
        <td class="idx">${i + 1}</td>
        <td class="name" title="${esc(r.name)}">${esc(clip(r.name, 30))}</td>
        <td class="proto">${esc(r.proto)}</td>
        <td class="ip">${esc(r.ip || "—")}</td>
        <td>${esc(r.country || "")}</td>
        <td class="isp" title="${esc(r.isp)}">${esc(clip(r.isp || "", 22))}</td>
        <td><span class="tag t-${r.type === "机房" ? "dc" : r.type === "移动" ? "mo" : "rs"}">${esc(r.type)}</span></td>
        <td class="lat">${r.latencyMs == null ? "—" : r.latencyMs + "ms"}</td>
        <td class="sc${r.score == null ? "" : ` s-${esc(r.grade)}`}">${r.score == null ? "—" : `${r.score} <b>${esc(r.grade)}</b>`}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ipure · IP 纯净度检测报告</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.6 -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
         background: #0d1117; color: #e6edf3; padding: 28px; }
  .card { max-width: 920px; margin: 0 auto; background: #11161d; border: 1px solid #1f2733;
          border-radius: 14px; padding: 28px 30px; }
  h1 { font-size: 19px; letter-spacing: .5px; }
  .meta { color: #7d8590; font-size: 12px; margin-top: 4px; }
  .hero { display: flex; align-items: center; gap: 26px; margin: 22px 0; }
  .ring { width: 118px; height: 118px; border-radius: 50%; flex: none;
          background: conic-gradient(${ringColor} ${avg * 3.6}deg, #21262d 0deg);
          display: grid; place-items: center; }
  .ring > div { width: 92px; height: 92px; border-radius: 50%; background: #11161d;
                display: grid; place-items: center; text-align: center; }
  .ring b { font-size: 30px; display: block; } .ring span { color: #7d8590; font-size: 11px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { background: #161d27; border: 1px solid #232c3a; border-radius: 999px;
          padding: 4px 12px; font-size: 12.5px; color: #adbac7; }
  .chip b { color: #e6edf3; }
  .warn { border-color: #d95c4a; color: #f0a197; }
  .warn b { color: #f0a197; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  th { color: #7d8590; font-weight: 500; text-align: left; padding: 7px 10px;
       border-bottom: 1px solid #232c3a; white-space: nowrap; }
  td { padding: 7px 10px; border-bottom: 1px solid #1a212b; white-space: nowrap; }
  tr:hover td { background: #151b24; }
  .idx, .lat, .sc { text-align: right; } .idx { color: #7d8590; }
  .proto { color: #7d8590; }
  .ip { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .isp, .name { max-width: 210px; overflow: hidden; text-overflow: ellipsis; }
  .tag { border-radius: 6px; padding: 1px 8px; font-size: 12px; }
  .t-dc { background: #3a2020; color: #f0a197; }
  .t-rs { background: #1e3327; color: #7ee2a8; }
  .t-mo { background: #1f2b3d; color: #9ec1f0; }
  .sc b { margin-left: 4px; }
  .s-S, .s-A { color: #3fb96f; } .s-B { color: #d9a13c; } .s-C, .s-D { color: #d95c4a; }
  footer { margin-top: 20px; color: #7d8590; font-size: 12px; display: flex;
           justify-content: space-between; }
  a { color: #5ba1f0; text-decoration: none; }
</style></head>
<body><div class="card">
  <h1>⏱ ipure · IP 纯净度检测报告</h1>
  <div class="meta">生成于 ${esc(meta.generatedAt)} · provider: ${esc(meta.provider)} · ${esc(clip(meta.source, 72))}</div>
  <div class="hero">
    <div class="ring"><div><b>${avg}</b><span>平均纯净度</span></div></div>
    <div class="chips">
      <span class="chip">节点 <b>${summary.nodes}</b></span>
      <span class="chip">服务器 <b>${summary.servers}</b></span>
      <span class="chip">独立出口 IP <b>${summary.uniqueIps}</b></span>
      <span class="chip${summary.maxDup > 1 ? " warn" : ""}">最大共用 <b>${summary.maxDup}</b></span>
      <span class="chip">家宽 <b>${summary.residential}</b></span>
      <span class="chip">机房 <b>${summary.hosting}</b></span>
      <span class="chip">移动 <b>${summary.mobile}</b></span>
      ${summary.failed ? `<span class="chip warn">解析失败 <b>${summary.failed}</b></span>` : ""}
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>节点</th><th>协议</th><th>出口 IP</th><th>国家</th><th>ISP</th><th>类型</th><th class="lat">延迟</th><th class="sc">纯净度</th></tr></thead>
    <tbody>${rowsHtml}
    </tbody>
  </table>
  <footer>
    <span>评分算法透明可解释，每一分都能说清来龙去脉</span>
    <a href="https://github.com/ecoreal/ipure">github.com/ecoreal/ipure</a>
  </footer>
</div></body></html>`;
}

// Rough height so headless Chromium can capture the whole card in one shot.
export function estimateHtmlHeight(model) {
  return 430 + model.rows.length * 37;
}
