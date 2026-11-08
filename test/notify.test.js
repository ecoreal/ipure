import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { shouldNotify, sendWebhook } from "../src/notify.js";

const diff = (over = {}) => ({
  prevAt: "t0",
  avgDelta: 0,
  worse: [],
  better: [],
  newIps: [],
  goneIps: [],
  ...over,
});

test("shouldNotify: silent on stability, loud on drops", () => {
  assert.equal(shouldNotify(diff()), false, "stable run stays quiet");
  assert.equal(shouldNotify(diff({ avgDelta: -3 })), true, "avg drop fires");
  assert.equal(
    shouldNotify(diff({ worse: [{ ip: "1.2.3.4", from: 80, to: 60, delta: -20 }] })),
    true,
    "any downgraded IP fires",
  );
  assert.equal(shouldNotify(diff({ avgDelta: +5 })), false, "improvement stays quiet");
  assert.equal(shouldNotify(null), false, "no diff (first run) stays quiet");
  assert.equal(shouldNotify(null, { always: true }), false, "always needs a diff");
  assert.equal(shouldNotify(diff(), { always: true }), true, "always overrides silence");
});

test("shouldNotify: fail-under floor triggers even on a stable run", () => {
  assert.equal(shouldNotify(diff(), { failUnder: 60, avgScore: 55 }), true);
  assert.equal(shouldNotify(diff(), { failUnder: 60, avgScore: 65 }), false);
  assert.equal(shouldNotify(diff(), { failUnder: 0, avgScore: 10 }), false);
});

test("sendWebhook: POSTs JSON payload with UA to a real local server", async () => {
  let body = "";
  let ua = "";
  const server = http.createServer((req, res) => {
    ua = req.headers["user-agent"] || "";
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const r = await sendWebhook(`http://127.0.0.1:${port}/hook`, {
    event: "score-drop",
    avgScore: 55,
    avgDelta: -5,
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.source, "ipure-watch");
  assert.equal(parsed.event, "score-drop");
  assert.equal(parsed.avgScore, 55);
  assert.ok(ua.includes("ipure-watch"));
  server.close();
});

test("sendWebhook: non-2xx is a failure with the status code", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const r = await sendWebhook(`http://127.0.0.1:${port}/hook`, {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 500);
  server.close();
});
