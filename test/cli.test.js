import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
const run = (args, extra = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...extra,
  });

test("--version prints the package version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("--help exits 0 and mentions both commands", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("ipure sub"));
  assert.ok(r.stdout.includes("ipure check"));
});

test("check with no input fails with a friendly message", () => {
  const r = run(["check"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("check 需要至少一个 IP"));
});

test("unknown command fails", () => {
  const r = run(["frobnicate"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("未知命令"));
});

test("sub with no source fails", () => {
  const r = run(["sub"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("sub 需要一个订阅源"));
});

test("sub with a missing file fails cleanly (no stack trace)", () => {
  const r = run(["sub", "/nonexistent/sub.txt"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("无法读取订阅源"));
  assert.ok(!r.stderr.includes("at "));
});
