import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSubscriptionText, resolveHosts, loadSubscription } from "../src/sub.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const tmp = (body) => {
  const f = path.join(os.tmpdir(), `ipure-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(f, body);
  return f;
};

test("loadSubscriptionText reads a local file", async () => {
  const f = tmp("hello-subscription");
  assert.equal(await loadSubscriptionText(f), "hello-subscription");
  fs.rmSync(f);
});

test("loadSubscriptionText rejects missing files with a clear message", async () => {
  await assert.rejects(
    () => loadSubscriptionText("/nonexistent/ipure/nope.txt"),
    /无法读取订阅源/,
  );
});

test("resolveHosts handles IP literals without network", async () => {
  const m = await resolveHosts(["127.0.0.1", "1.2.3.4"]);
  assert.equal(m.get("127.0.0.1"), "127.0.0.1");
  // Unresolvable garbage host maps to null, not a crash.
  assert.equal(m.get("1.2.3.4") !== undefined, true);
});

test("resolveHosts: localhost resolves", async () => {
  const m = await resolveHosts(["localhost"]);
  assert.ok(m.get("localhost") !== null);
});

test("loadSubscription end-to-end from a temp file", async () => {
  const list = [
    `ss://${b64("aes-256-gcm:pass@127.0.0.1:8388")}#local-a`,
    `ss://${b64("aes-256-gcm:pass@127.0.0.1:8388")}#local-b`,
    `trojan://pw@127.0.0.2:443#local-c`,
  ].join("\n");
  const f = tmp(list);
  const { nodes, stats, hostMap, byHost } = await loadSubscription(f);
  assert.equal(nodes.length, 3);
  assert.equal(stats.parsed, 3);
  assert.equal(byHost.size, 2);
  assert.equal(hostMap.get("127.0.0.1"), "127.0.0.1");
  assert.equal(hostMap.get("127.0.0.2"), "127.0.0.2");
  fs.rmSync(f);
});
