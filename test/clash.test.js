import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitFlowItems,
  parseClashProxies,
  looksLikeClash,
} from "../src/clash.js";
import { parseNodes } from "../src/uris.js";

const YAML = `mixed-port: 7890
# a comment
proxies:
  - {name: "HK-01", type: ss, server: 1.2.3.4, port: 8388, cipher: aes-256-gcm, udp: true}
  - name: "JP-02"
    type: trojan
    server: jp.example.com
    port: "443"
    password: "p@ss,with:colon"
- name: bare-dash
  type: vmess
  server: 5.6.7.8
  port: 10086
  - {name: broken, type: ss, port: 1234}
proxy-groups:
  - name: auto
    type: url-test
    proxies: [HK-01, JP-02]
rules:
  - MATCH,DIRECT
`;

test("splitFlowItems respects quotes and nesting", () => {
  const items = splitFlowItems(`name: "a, b", ws-opts: {path: "/x", headers: {h: "1"}}, tls: true`);
  assert.equal(items.length, 3);
  assert.equal(items[0], 'name: "a, b"');
  assert.equal(items[2], "tls: true");
});

test("parseClashProxies: inline flow + block style + bare dashes", () => {
  const { nodes, skipped } = parseClashProxies(YAML);
  assert.equal(skipped, 1); // the entry without server
  assert.equal(nodes.length, 3);
  assert.deepEqual(
    nodes[0],
    { name: "HK-01", proto: "ss", host: "1.2.3.4", port: 8388 },
  );
  assert.equal(nodes[1].name, "JP-02");
  assert.equal(nodes[1].host, "jp.example.com");
  assert.equal(nodes[1].port, 443); // quoted port is coerced
  assert.equal(nodes[1].proto, "trojan");
  assert.equal(nodes[2].name, "bare-dash");
  assert.equal(nodes[2].port, 10086);
});

test("parseClashProxies stops at the next top-level key", () => {
  const { nodes } = parseClashProxies(YAML);
  // proxy-groups entries must not leak in as nodes
  assert.ok(!nodes.some((n) => n.name === "auto"));
});

test("parseClashProxies: null when no proxies section", () => {
  assert.equal(parseClashProxies("mode: rule\nrules: []"), null);
  assert.equal(parseClashProxies(""), null);
});

test("looksLikeClash", () => {
  assert.equal(looksLikeClash("proxies:\n  - {}"), true);
  assert.equal(looksLikeClash("myproxies: []"), false);
});

test("parseNodes routes Clash YAML through the clash parser", () => {
  const { nodes, stats } = parseNodes(YAML);
  assert.equal(nodes.length, 3);
  assert.equal(stats.parsed, 3);
  assert.equal(stats.unknown, 1);
});

test("parseNodes: URI list still wins when no proxies: section", () => {
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const { nodes } = parseNodes(`trojan://pw@2.2.2.2:443#x\nss://${b64("m:p@3.3.3.3:1")}#y`);
  assert.equal(nodes.length, 2);
});

test("parseNodes: mihomo-style header still detected", () => {
  const body = "port: 7890\nproxies:   # inline comment\n  - {name: a, type: ss, server: 9.9.9.9, port: 1}\n";
  const { nodes } = parseNodes(body);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].host, "9.9.9.9");
});
