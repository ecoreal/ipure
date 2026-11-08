import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayWidth,
  pad,
  clip,
  renderTerminal,
  buildReportHtml,
  estimateHtmlHeight,
} from "../src/report.js";

test("displayWidth counts CJK as 2", () => {
  assert.equal(displayWidth("香港01"), 6);
  assert.equal(displayWidth("US-01"), 5);
  assert.equal(displayWidth(""), 0);
});

test("pad aligns by display width", () => {
  assert.equal(pad("日本", 8), "日本    ");
  assert.equal(pad("abc", 5), "abc  ");
  assert.equal(pad("abc", 5, "right"), "  abc");
});

test("clip respects CJK width and appends ellipsis", () => {
  assert.equal(clip("香港-01-节点名称很长", 8), "香港-01-…");
  assert.equal(clip("short", 10), "short");
});

const model = {
  meta: { source: "test-sub", generatedAt: "2026-11-08", provider: "ip-api" },
  summary: {
    nodes: 3,
    servers: 2,
    uniqueIps: 2,
    maxDup: 2,
    avgScore: 62,
    residential: 1,
    hosting: 1,
    mobile: 0,
    failed: 1,
    topClean: ["a (80)"],
    notes: ["note"],
  },
  rows: [
    {
      name: "香港 IEPL-01", proto: "trojan", host: "1.2.3.4", ip: "1.2.3.4",
      country: "Hong Kong", cc: "HK", isp: "PCCW", asn: "AS4760",
      type: "机房", proxy: false, mobile: false, latencyMs: 45, loss: 0,
      score: 65, grade: "B", note: "可用", reasons: [], resolved: true,
    },
    {
      name: "美国家宽", proto: "ss", host: "example.com", ip: null,
      country: "", cc: "", isp: "", asn: "",
      type: "未知", proxy: false, mobile: false, latencyMs: null, loss: null,
      score: 0, grade: "D", note: "建议更换", reasons: [], resolved: false,
    },
  ],
};

test("renderTerminal includes key info, with and without color", () => {
  const plain = renderTerminal(model, { color: false });
  assert.ok(plain.includes("香港 IEPL-01"));
  assert.ok(plain.includes("1.2.3.4"));
  assert.ok(plain.includes("解析失败"));
  assert.ok(plain.includes("最多 2 节点共用"));
  const colored = renderTerminal(model, { color: true });
  assert.ok(colored.includes("\x1b["));
  // ANSI codes must not break column alignment: strip them and compare shapes.
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
  assert.equal(strip(colored), plain);
});

test("buildReportHtml escapes malicious node names", () => {
  const evil = {
    ...model,
    rows: [{ ...model.rows[0], name: '<script>alert("x")</script>' }],
  };
  const html = buildReportHtml(evil);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("buildReportHtml embeds summary values", () => {
  const html = buildReportHtml(model);
  assert.ok(html.includes("平均纯净度"));
  assert.ok(html.includes("github.com/ecoreal/ipure"));
  assert.ok(html.includes("62"));
});

test("estimateHtmlHeight grows with rows", () => {
  const one = estimateHtmlHeight({ rows: [1], summary: {} });
  const ten = estimateHtmlHeight({ rows: new Array(10), summary: {} });
  assert.ok(ten > one);
});
