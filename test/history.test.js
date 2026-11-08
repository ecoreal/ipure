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
  assert.ok(a1.endsWith(".json"));
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
