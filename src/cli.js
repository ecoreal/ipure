#!/usr/bin/env node
// ipure — local-first IP purity & subscription health check.
//   ipure sub <url|file|->   full check of a subscription
//   ipure check <ip...>      check IPs directly

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSubscription, resolveHosts } from "./sub.js";
import { checkIps, availableProviders } from "./providers.js";
import { purityScore, gradeOf, typeOf } from "./score.js";
import { tcpPing, pool } from "./latency.js";
import { renderTerminal, buildReportHtml, estimateHtmlHeight } from "./report.js";
import { htmlToPng } from "./png.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALUE_FLAGS = new Set([
  "--html",
  "--png",
  "--json",
  "--provider",
  "--token",
  "--timeout",
  "--conc",
  "--sort",
  "--tries",
]);

function usage(code = 0) {
  console.log(`⏱  ipure v${pkg.version} — 本地优先的 IP 纯净度检测工具

用法:
  ipure sub <订阅源>               体检一整个订阅源（URI 列表 / base64 / Clash YAML）
                                   → 出口 IP 纯净度 → 延迟 → 重复出口
  ipure check <ip或域名...>        直接检测一批 IP（也可从 stdin 管道输入）

选项:
  --provider <name>    ip-api (默认, 免key) | ipinfo (需 IPINFO_TOKEN)
  --html <file>        输出可分享的 HTML 报告卡片
  --png <file>         额外用本机 Chromium 截成 PNG（需已安装）
  --json <file|->      JSON 输出到文件或 stdout
  --sort <key>         score | order (默认 order, 按订阅原序)
  --no-latency         跳过 TCP 延迟测量
  --timeout <ms>       单项超时 (默认 3000)
  --conc <n>           并发数 (默认 8)
  --no-color           关闭颜色
  -h, --help           帮助
  -v, --version        版本

示例:
  ipure sub "https://example.com/api/v1/client/subscribe?token=xxx" --html report.html
  cat nodes.txt | ipure check
  ipure check 8.8.8.8 1.1.1.1 --json -`);
  process.exit(code);
}

function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    if (a === "-v" || a === "--version") {
      console.log(pkg.version);
      process.exit(0);
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq > 0 ? a.slice(0, eq) : a;
      let val = eq > 0 ? a.slice(eq + 1) : undefined;
      if (val === undefined && VALUE_FLAGS.has(key)) {
        val = argv[++i];
        if (val === undefined) fail(`选项 ${key} 需要一个值`);
      }
      flags[key.slice(2)] = val ?? true;
    } else if (a === "-") {
      pos.push("-");
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  console.error("  运行 ipure --help 查看用法");
  process.exit(1);
}

const step = (msg) => process.stderr.write(`▸ ${msg}\n`);
const now = () =>
  new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });

function safeFileName(s) {
  return s.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(0, 50);
}

// ---------------------------------------------------------------- sub command

async function cmdSub(source, flags) {
  if (!source) fail("sub 需要一个订阅源：URL、本地文件路径或 - (stdin)");

  step("拉取订阅…");
  const { nodes, stats, hostMap, byHost } = await loadSubscription(source, {
    conc: Number(flags.conc) || 8,
  });
  if (!nodes.length) {
    fail(
      `没有解析出任何节点 (共 ${stats.total} 行，无法识别 ${stats.unknown} 行)` +
        (stats.unknownSamples.length
          ? `\n  未知行样例: ${stats.unknownSamples[0].slice(0, 60)}`
          : ""),
    );
  }
  step(
    `解析出 ${nodes.length} 个节点 (${stats.unknown} 行未识别) · 服务器 ${byHost.size} 台`,
  );

  // Resolve exit IPs and batch-check them.
  const unresolved = [...hostMap.entries()].filter(([, ip]) => !ip).map(([h]) => h);
  const ips = [...new Set([...hostMap.values()].filter(Boolean))];

  const provider = flags.provider || "ip-api";
  const providers = availableProviders();
  if (!providers[provider]) {
    fail(`provider "${provider}" 不可用${provider === "ipinfo" ? "：需要设置 IPINFO_TOKEN" : ""}`);
  }
  step(`检测 ${ips.length} 个出口 IP 的纯净度 (${provider})…`);
  const results = await checkIps(ips, {
    provider,
    token: flags.token,
    onProgress: (done, total) =>
      process.stderr.write(`\r▸ 检测进度 ${done}/${total}`),
  });
  process.stderr.write("\n");

  // Latency per unique server (host:port), shared across nodes.
  const latencyMap = new Map();
  if (!flags["no-latency"]) {
    step("测量 TCP 延迟…");
    const targets = [...byHost.keys()];
    await pool(targets, Number(flags.conc) || 8, async (key) => {
      const cut = key.lastIndexOf(":");
      latencyMap.set(
        key,
        await tcpPing(key.slice(0, cut), Number(key.slice(cut + 1)), {
          timeout: Number(flags.timeout) || 3000,
          tries: Number(flags.tries) || 3,
        }),
      );
    });
    step("延迟测量完成");
  }

  // dupCount: nodes sharing the same exit IP (the "burned IP" signal).
  const ipDup = new Map();
  for (const n of nodes) {
    const ip = hostMap.get(n.host);
    if (ip) ipDup.set(ip, (ipDup.get(ip) || 0) + 1);
  }

  let rows = nodes.map((n, idx) => {
    const ip = hostMap.get(n.host);
    const info = ip ? results.get(ip) : null;
    const dupCount = ip ? ipDup.get(ip) || 1 : 1;
    const { score, grade, reasons } = purityScore(info, { dupCount });
    const lat = latencyMap.get(`${n.host}:${n.port}`);
    return {
      idx,
      name: n.name,
      proto: n.proto,
      host: n.host,
      port: n.port,
      ip,
      country: info?.ok ? info.country : "",
      cc: info?.ok ? info.cc : "",
      isp: info?.ok ? info.isp : "",
      asn: info?.ok ? info.asn : "",
      type: info?.ok ? typeOf(info) : "未知",
      proxy: !!info?.proxy,
      mobile: !!info?.mobile,
      latencyMs: lat ? lat.ms : null,
      loss: lat ? lat.loss : null,
      score,
      grade,
      note: gradeOf(score).note,
      reasons,
      resolved: !!ip,
    };
  });

  const sortKey = flags.sort || "order";
  if (sortKey === "score") rows = [...rows].sort((a, b) => b.score - a.score);

  const scored = rows.filter((r) => r.resolved);
  const summary = {
    nodes: rows.length,
    servers: byHost.size,
    uniqueIps: ips.length,
    maxDup: Math.max(1, ...ipDup.values()),
    avgScore: scored.length
      ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
      : 0,
    residential: scored.filter((r) => r.type === "家宽/企业").length,
    hosting: scored.filter((r) => r.type === "机房").length,
    mobile: scored.filter((r) => r.type === "移动").length,
    failed: unresolved.length,
    topClean: [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => `${clipName(r.name)} (${r.score})`),
    notes: [
      "纯净度评分透明可解释：机房 -35 · 被标记为代理 -20 · 同出口节点每多一个 -3 (封顶 -15) · 移动 +5",
      ...(unresolved.length
        ? [`${unresolved.length} 个服务器域名解析失败，未参与纯净度评分`]
        : []),
    ],
  };

  const model = {
    meta: { source, generatedAt: now(), provider },
    summary,
    rows,
  };
  emit(model, flags, `ipure-report-${safeFileName(source)}`);
}

function clipName(s) {
  return s.length > 18 ? s.slice(0, 17) + "…" : s;
}

// -------------------------------------------------------------- check command

async function cmdCheck(targets, flags) {
  let list = targets;
  if (!list.length || (list.length === 1 && list[0] === "-")) {
    if (list.length === 0 && process.stdin.isTTY) {
      fail("check 需要至少一个 IP 或域名（或用管道 cat list.txt | ipure check）");
    }
    list = fs.readFileSync(0, "utf8").split(/\s+/).filter(Boolean);
  }
  if (!list.length) fail("check 需要至少一个 IP 或域名");

  // Hostnames are allowed; resolve them first.
  const needResolve = list.filter((t) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(t));
  const resolved = needResolve.length
    ? await resolveHosts(needResolve, { conc: Number(flags.conc) || 8 })
    : new Map();

  const entries = list.map((t) => {
    const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(t) ? t : resolved.get(t);
    return { target: t, ip };
  });
  const ips = [...new Set(entries.map((e) => e.ip).filter(Boolean))];

  const provider = flags.provider || "ip-api";
  const providers = availableProviders();
  if (!providers[provider]) {
    fail(`provider "${provider}" 不可用${provider === "ipinfo" ? "：需要设置 IPINFO_TOKEN" : ""}`);
  }
  step(`检测 ${ips.length} 个 IP (${provider})…`);
  const results = await checkIps(ips, { provider, token: flags.token });

  const dup = new Map();
  for (const e of entries) if (e.ip) dup.set(e.ip, (dup.get(e.ip) || 0) + 1);

  const rows = entries.map((e, idx) => {
    const info = e.ip ? results.get(e.ip) : null;
    const { score, grade, reasons } = purityScore(info, { dupCount: e.ip ? dup.get(e.ip) : 1 });
    return {
      idx,
      name: e.target,
      proto: "-",
      host: e.target,
      ip: e.ip,
      country: info?.ok ? info.country : "",
      cc: info?.ok ? info.cc : "",
      isp: info?.ok ? info.isp : "",
      asn: info?.ok ? info.asn : "",
      type: info?.ok ? typeOf(info) : "未知",
      proxy: !!info?.proxy,
      mobile: !!info?.mobile,
      latencyMs: null,
      loss: null,
      score,
      grade,
      note: gradeOf(score).note,
      reasons,
      resolved: !!e.ip,
    };
  });

  const scored = rows.filter((r) => r.resolved);
  const model = {
    meta: { source: "check", generatedAt: now(), provider },
    summary: {
      nodes: rows.length,
      servers: rows.length,
      uniqueIps: ips.length,
      maxDup: Math.max(1, ...dup.values()),
      avgScore: scored.length
        ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
        : 0,
      residential: scored.filter((r) => r.type === "家宽/企业").length,
      hosting: scored.filter((r) => r.type === "机房").length,
      mobile: scored.filter((r) => r.type === "移动").length,
      failed: rows.filter((r) => !r.resolved).length,
      topClean: [],
      notes: [],
    },
    rows,
  };
  emit(model, flags, "ipure-check");
}

// ------------------------------------------------------------------- emit

function emit(model, flags, baseName) {
  const color = !flags["no-color"] && process.stdout.isTTY;
  const jsonToStdout = flags.json === "-" || flags.json === "stdout";
  const wantsJsonFile =
    typeof flags.json === "string" && !jsonToStdout;

  if (jsonToStdout) {
    console.log(JSON.stringify(model, null, 2));
  }
  if (wantsJsonFile) {
    fs.writeFileSync(flags.json, JSON.stringify(model, null, 2) + "\n");
    process.stderr.write(`▸ JSON 已写入 ${flags.json}\n`);
  }
  if (typeof flags.html === "string") {
    fs.writeFileSync(flags.html, buildReportHtml(model) + "\n");
    process.stderr.write(`▸ HTML 报告已写入 ${flags.html}\n`);
  }
  if (typeof flags.png === "string") {
    const tmpHtml = path.join(
      path.dirname(path.resolve(flags.png)),
      `.${baseName}.tmp.html`,
    );
    fs.writeFileSync(tmpHtml, buildReportHtml(model));
    try {
      htmlToPng(tmpHtml, path.resolve(flags.png), {
        width: 980,
        height: Math.max(800, estimateHtmlHeight(model)),
      });
      process.stderr.write(`▸ PNG 已导出 ${flags.png}\n`);
    } catch (e) {
      process.stderr.write(`⚠ PNG 导出失败: ${e.message}\n`);
    } finally {
      fs.rmSync(tmpHtml, { force: true });
    }
  }
  if (!jsonToStdout) {
    console.log(renderTerminal(model, { color }));
  }
}

// -------------------------------------------------------------------- main

const { pos, flags } = parseArgv(process.argv.slice(2));
const cmd = pos[0];

try {
  if (cmd === "sub") await cmdSub(pos[1], flags);
  else if (cmd === "check") await cmdCheck(pos.slice(1), flags);
  else if (!cmd) usage(1);
  else fail(`未知命令: ${cmd}`);
} catch (e) {
  fail(e?.cause?.name === "AbortError" || e?.name === "AbortError"
    ? "请求超时，试试 --timeout 15000"
    : e.message);
}
