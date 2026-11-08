import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  historyFile,
  loadHistory,
  saveHistory,
  diffHistory,
  listHistory,
  sparkline,
} from "../src/history.js";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ipure-hist-"));
const model = (rows, avgScore = 70) => ({
  meta: { generatedAt: "2026-11-08 22:00", provider: "ip-api" },
  summary: { avgScore },
  rows,
});
const row = (ip, score) => ({ ip, score });

test("historyFile is stable per source and distinct across sources", () => {
  const a1 = historyFile("https://example.com/sub", "/tmp/h");
  const a2 = historyFile("https://example.com/sub", "/tmp/h");
  const b = historyFile("https://example.com/other", "/tmp/h");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.endsWith(".jsonl"));
});

test("save + load roundtrip", () => {
  const d = dir();
  const m = model([row("1.1.1.1", 65), row("2.2.2.2", 80)], 72);
  const f = saveHistory("src-a", m, d);
  assert.ok(fs.existsSync(f));
  const prev = loadHistory("src-a", d);
  assert.equal(prev.avgScore, 72);
  assert.equal(prev.ips["1.1.1.1"], 65);
  assert.equal(prev.generatedAt, "2026-11-08 22:00");
  // Rows without a resolved IP are excluded from the snapshot.
  saveHistory("src-a", model([row("1.1.1.1", 65), row(null, 50)], 57), d);
  assert.equal(loadHistory("src-a", d).ips[null], undefined);
});

test("loadHistory returns null for unknown sources", () => {
  assert.equal(loadHistory("never-seen", dir()), null);
});

test("diffHistory: improve, worsen, new, gone", () => {
  const prev = {
    generatedAt: "2026-11-08 08:00",
    avgScore: 60,
    ips: { "1.1.1.1": 65, "2.2.2.2": 80, "3.3.3.3": 40 },
  };
  const cur = model(
    [row("1.1.1.1", 65), row("2.2.2.2", 75), row("4.4.4.4", 90)],
    70,
  );
  const d = diffHistory(prev, cur);
  assert.equal(d.prevAt, "2026-11-08 08:00");
  assert.equal(d.avgDelta, 10);
  assert.deepEqual(d.worse, [{ ip: "2.2.2.2", from: 80, to: 75, delta: -5 }]);
  assert.deepEqual(d.better, []);
  assert.deepEqual(d.newIps, ["4.4.4.4"]);
  assert.deepEqual(d.goneIps, ["3.3.3.3"]);
  assert.deepEqual(d.changes, d.worse); // changes sorted worst-first
});

test("diffHistory: multiple changes sorted worst first, capped at 6", () => {
  const prev = { generatedAt: "t", avgScore: 50, ips: Object.fromEntries(
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => [`1.0.0.${i + 1}`, 90 - i * 5]),
  ) };
  const cur = model(["1.0.0.1", "1.0.0.2", "1.0.0.3", "1.0.0.4", "1.0.0.5", "1.0.0.6", "1.0.0.7", "1.0.0.8"].map((ip, i) => row(ip, 20 + i * 2)), 30);
  const d = diffHistory(prev, cur);
  assert.ok(d.changes.length <= 6);
  for (let i = 1; i < d.changes.length; i++) {
    assert.ok(d.changes[i - 1].delta <= d.changes[i].delta);
  }
});

test("diffHistory: no previous snapshot -> null", () => {
  assert.equal(diffHistory(null, model([row("1.1.1.1", 1)])), null);
});

test("saveHistory appends one record per run — the curve accumulates", () => {
  const d = dir();
  const mk = (src, gen, avg) => ({
    meta: { generatedAt: gen },
    summary: { avgScore: avg },
    rows: [row("1.1.1.1", avg)],
  });
  saveHistory("src-b", mk("src-b", "2026-11-08 10:00", 70), d);
  saveHistory("src-a", mk("src-a", "2026-11-08 09:00", 60), d);
  saveHistory("src-b", mk("src-b", "2026-11-08 11:00", 75), d);

  const all = listHistory(d);
  assert.equal(all.length, 3); // every run kept — that's the point
  // sorted oldest first
  assert.equal(all[0].snapshot.source, "src-a");
  assert.equal(all[2].snapshot.source, "src-b");
  assert.equal(all[2].snapshot.avgScore, 75);

  // watch diff still reads the LATEST record of a source
  const latest = loadHistory("src-b", d);
  assert.equal(latest.avgScore, 75);
  assert.equal(latest.generatedAt, "2026-11-08 11:00");
});

test("legacy single-object .json files still load and list", () => {
  const d = dir();
  const f = path.join(d, "abcdef1234567890.json");
  fs.writeFileSync(
    f,
    JSON.stringify({ generatedAt: "t", avgScore: 61, ips: { "1.1.1.1": 65 } }),
  );
  const all = listHistory(d);
  assert.equal(all.length, 1);
  assert.equal(all[0].snapshot.avgScore, 61);
  // ...but if a JSONL log with the same key exists, the legacy file is ignored
  fs.writeFileSync(
    path.join(d, "abcdef1234567890.jsonl"),
    JSON.stringify({ source: "x", generatedAt: "t2", avgScore: 70, ips: {} }) + "\n",
  );
  assert.equal(listHistory(d).length, 1);
});

test("listHistory: empty and corrupt entries are skipped silently", () => {
  const d = dir();
  fs.writeFileSync(path.join(d, "broken.json"), "{not json");
  fs.writeFileSync(path.join(d, "notasnap.json"), JSON.stringify({ foo: 1 }));
  assert.deepEqual(listHistory(d), []);
});

test("sparkline: normalised bars, stable single value", () => {
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([61]), "█");
  assert.equal(sparkline([40, 60, 80, 100]), "▁▃▆█");
  assert.equal(sparkline([100, 40, 70]).length, 3); // shape survives reordering
  assert.equal(sparkline([50, 50]), "▁▁"); // flat series, zero span
});
