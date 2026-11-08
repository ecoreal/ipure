import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import {
  probeHttpProxy,
  probeSocks5,
  probeNode,
  probeSupported,
} from "../src/probe.js";

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("probeHttpProxy: happy path through a real mock forward proxy", async () => {
  const seen = { auth: "" };
  const server = http.createServer((req, res) => {
    seen.auth = req.headers["proxy-authorization"] || "";
    seen.url = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", query: "203.0.113.7" }));
  });
  const port = await listen(server);
  const r = await probeHttpProxy(
    { host: "127.0.0.1", port, username: "user", password: "pw" },
    { timeout: 3000 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.exitIp, "203.0.113.7");
  assert.ok(r.ms >= 0);
  // Absolute-URI form + Basic auth header actually arrived.
  assert.equal(seen.url, "http://ip-api.com/json/?fields=status,query,message");
  assert.equal(seen.auth, `Basic ${Buffer.from("user:pw").toString("base64")}`);
  server.close();
});

test("probeHttpProxy: no credentials means no auth header", async () => {
  const seen = { auth: "present" };
  const server = http.createServer((req, res) => {
    seen.auth = req.headers["proxy-authorization"] || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "success", query: "203.0.113.8" }));
  });
  const port = await listen(server);
  const r = await probeHttpProxy({ host: "127.0.0.1", port }, { timeout: 3000 });
  assert.equal(r.ok, true);
  assert.equal(seen.auth, "");
  server.close();
});

test("probeHttpProxy: 407 surfaces as http 407 error", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(407);
    res.end("auth required");
  });
  const port = await listen(server);
  const r = await probeHttpProxy({ host: "127.0.0.1", port }, { timeout: 3000 });
  assert.equal(r.ok, false);
  assert.equal(r.err, "http 407");
  server.close();
});

test("probeHttpProxy: timeout is a clean err, not a crash", async () => {
  const server = http.createServer(() => {/* never respond */});
  const port = await listen(server);
  const r = await probeHttpProxy({ host: "127.0.0.1", port }, { timeout: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.err, "timeout");
  server.close();
});

// Minimal SOCKS5 server: no-auth only, always "exits" from 198.51.100.9.
function socks5Server() {
  return net.createServer((s) => {
    let stage = 0;
    s.on("data", (d) => {
      if (stage === 0) {
        stage = 1;
        s.write(Buffer.from([0x05, 0x00])); // choose no-auth
      } else if (stage === 1) {
        stage = 2;
        // reply success with a fake IPv4 exit
        s.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 198, 51, 100, 9, 0, 80]));
      } else if (stage === 2) {
        s.end(
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" +
            JSON.stringify({ status: "success", query: "198.51.100.9" }),
        );
      }
    });
  });
}

test("probeSocks5: full handshake over a real socket", async () => {
  const server = socks5Server();
  const port = await listen(server);
  const r = await probeSocks5({ host: "127.0.0.1", port }, { timeout: 3000 });
  assert.equal(r.ok, true);
  assert.equal(r.exitIp, "198.51.100.9");
  server.close();
});

test("probeSocks5: wrong credentials fail cleanly", async () => {
  const server = net.createServer((s) => {
    s.on("data", () => {
      if (!s.wroteMethod) {
        s.wroteMethod = true;
        s.write(Buffer.from([0x05, 0x02])); // demand user/pass
      } else {
        s.write(Buffer.from([0x01, 0x01])); // auth failure
      }
    });
  });
  const port = await listen(server);
  const r = await probeSocks5(
    { host: "127.0.0.1", port, username: "u", password: "bad" },
    { timeout: 3000 },
  );
  assert.equal(r.ok, false);
  assert.equal(r.err, "socks5 auth failed");
  server.close();
});

test("probeNode dispatch: unsupported protocols refuse honestly", () => {
  assert.equal(probeSupported({ proto: "vless" }), false);
  assert.equal(probeSupported({ proto: "http" }), true);
  assert.equal(probeSupported({ proto: "socks5" }), true);
  assert.equal(probeSupported({ proto: "hysteria2" }), false);
});

test("probeNode: unsupported proto returns a clean error", async () => {
  const r = await probeNode({ proto: "trojan", host: "127.0.0.1", port: 1 });
  assert.equal(r.ok, false);
  assert.match(r.err, /unsupported proto/);
});
