// Exit verification: actually send traffic THROUGH a proxy node and see
// which IP comes out the other side. A purity score says what the world
// thinks of an IP; a probe says whether the node even works today.
// Supported transports: plain HTTP forward proxy (with optional Basic auth)
// and SOCKS5 (no-auth / user-pass). Other protocols only get the TCP probe.

import net from "node:net";
import dns from "node:dns/promises";

export const PROBE_TARGET_HOST = "ip-api.com";
export const PROBE_TARGET_URL = `http://${PROBE_TARGET_HOST}/json/?fields=status,query,message`;

const OK_RE = /^HTTP\/1\.[01] 200/;
const BODY_SPLIT = /\r\n\r\n/;

// Defensive: some proxies force chunked encoding even on HTTP/1.0.
function dechunk(body) {
  const out = [];
  let pos = 0;
  while (pos < body.length) {
    const nl = body.indexOf("\r\n", pos);
    if (nl === -1) break;
    const size = parseInt(body.slice(pos, nl).toString("latin1").split(";")[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(body.subarray(nl + 2, nl + 2 + size));
    pos = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

function parseProxyResponse(buf) {
  const text = buf.toString("latin1");
  const m = text.match(BODY_SPLIT);
  if (!m) return null;
  const head = text.slice(0, m.index);
  const statusLine = head.split("\r\n")[0] || "";
  let body = buf.slice(Buffer.byteLength(head, "latin1") + 4);
  if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
  return { statusLine, body };
}

// Talk to an HTTP forward proxy: GET with an absolute URI is the whole trick.
export function probeHttpProxy(node, { target = PROBE_TARGET_URL, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok: false, ms: Math.round(performance.now() - start), ...r });
    };
    socket.setTimeout(timeout);
    socket.once("error", (e) => finish({ err: e.code || e.message }));
    socket.once("timeout", () => finish({ err: "timeout" }));
    const succeed = (r) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok: true, ms: Math.round(performance.now() - start), ...r });
    };
    socket.once("connect", () => {
      const auth = node.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${node.username}:${node.password || ""}`).toString("base64")}\r\n`
        : "";
      socket.write(
        `GET ${target} HTTP/1.0\r\n` +
          `Host: ${PROBE_TARGET_HOST}\r\n` +
          `User-Agent: ipure-probe/0.4\r\n` +
          auth +
          `Connection: close\r\n\r\n`,
      );
    });
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const parsed = parseProxyResponse(buf);
      if (!parsed) return;
      const ms = Math.round(performance.now() - start);
      if (!OK_RE.test(parsed.statusLine)) {
        const code = parsed.statusLine.split(" ")[1] || "?";
        finish({ err: `http ${code}` });
        return;
      }
      try {
        const json = JSON.parse(parsed.body.toString("utf8"));
        if (json.query) succeed({ exitIp: json.query });
        else finish({ err: json.message || "no query field" });
      } catch {
        finish({ err: "bad json" });
      }
    });
    socket.once("close", () => finish({ err: "closed before response" }));
    try {
      socket.connect(node.port, node.host);
    } catch {
      finish({ err: "connect failed" });
    }
  });
}

// Minimal SOCKS5 client: greet → (auth) → CONNECT → plain HTTP over tunnel.
export function probeSocks5(node, { target = PROBE_TARGET_URL, timeout = 8000, targetIp } = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    let done = false;
    let stage = "greet";
    const finish = (r) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok: false, ms: Math.round(performance.now() - start), ...r });
    };
    socket.setTimeout(timeout);
    socket.once("error", (e) => finish({ err: e.code || e.message }));
    socket.once("timeout", () => finish({ err: "timeout" }));
    const succeed = (r) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok: true, ms: Math.round(performance.now() - start), ...r });
    };
    // The greeting has to go out the moment we connect.
    socket.once("connect", () => {
      socket.write(
        node.username
          ? Buffer.from([0x05, 0x02, 0x00, 0x02])
          : Buffer.from([0x05, 0x01, 0x00]),
      );
    });

    const httpGet = () => {
      const targetHost = new URL(target).host;
      socket.write(
        `GET ${target} HTTP/1.0\r\nHost: ${targetHost}\r\n` +
          `User-Agent: ipure-probe/0.4\r\nConnection: close\r\n\r\n`,
      );
    };

    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === "greet") {
        if (buf.length < 2) return;
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === 0x02) {
          stage = "auth";
          const u = Buffer.from(node.username || "", "utf8");
          const p = Buffer.from(node.password || "", "utf8");
          socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        } else if (method === 0x00) {
          stage = "connect";
          sendConnect();
        } else {
          finish({ err: `socks5 method ${method}` });
        }
      } else if (stage === "auth") {
        if (buf.length < 2) return;
        const status = buf[1];
        buf = buf.subarray(2);
        if (status !== 0x00) {
          finish({ err: "socks5 auth failed" });
          return;
        }
        stage = "connect";
        sendConnect();
      } else if (stage === "connect") {
        if (buf.length < 6) return;
        if (buf[1] !== 0x00) {
          finish({ err: `socks5 reply ${buf[1]}` });
          return;
        }
        const addrLen = buf[3] === 0x03 ? 1 + buf[4] : buf[3] === 0x04 ? 16 : 4;
        if (buf.length < 4 + addrLen + 2) return;
        buf = buf.subarray(4 + addrLen + 2);
        stage = "http";
        httpGet();
      } else if (stage === "http") {
        const parsed = parseProxyResponse(buf);
        if (!parsed) return;
        if (!OK_RE.test(parsed.statusLine)) {
          finish({ err: `http ${(parsed.statusLine.split(" ")[1] || "?")}` });
          return;
        }
        try {
          const json = JSON.parse(parsed.body.toString("utf8"));
          if (json.query) succeed({ exitIp: json.query });
          else finish({ err: json.message || "no query field" });
        } catch {
          finish({ err: "bad json" });
        }
      }
    });
    socket.once("close", () => finish({ err: "closed before response" }));

    function sendConnect() {
      // CONNECT by hostname — let the exit resolve it.
      const u = new URL(target);
      const host = Buffer.from(u.hostname, "utf8");
      const port = Number(u.port) || 80;
      socket.write(
        Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
          host,
          Buffer.from([port >> 8, port & 0xff]),
        ]),
      );
    }

    try {
      socket.connect(node.port, node.host);
    } catch {
      finish({ err: "connect failed" });
    }
  });
}

const PROBEABLE = new Set(["http", "https", "socks5"]);

export function probeSupported(node) {
  return PROBEABLE.has(String(node.proto).toLowerCase());
}

export async function probeNode(node, opts = {}) {
  const proto = String(node.proto).toLowerCase();
  if (proto === "socks5") return probeSocks5(node, opts);
  if (proto === "http" || proto === "https") return probeHttpProxy(node, opts);
  return { ok: false, err: `unsupported proto ${node.proto}` };
}
