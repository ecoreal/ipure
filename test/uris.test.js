import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShareUri, parseNodes, dedupeByHost } from "../src/uris.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("ss legacy: whole userinfo+host base64", () => {
  const uri = `ss://${b64("aes-256-gcm:pass@1.2.3.4:8388")}#HK 01`;
  const n = parseShareUri(uri);
  assert.equal(n.proto, "ss");
  assert.equal(n.host, "1.2.3.4");
  assert.equal(n.port, 8388);
  assert.equal(n.name, "HK 01");
});

test("ss SIP002: base64(method:pass)@host:port", () => {
  const uri = `ss://${b64("aes-256-gcm:pass")}@5.6.7.8:443#%E6%97%A5%E6%9C%AC-02`;
  const n = parseShareUri(uri);
  assert.equal(n.host, "5.6.7.8");
  assert.equal(n.port, 443);
  assert.equal(n.name, "日本-02");
});

test("ss with plugin params", () => {
  const uri = `ss://${b64("aes-256-gcm:pass")}@5.6.7.8:443/?plugin=obfs-local%3Bobfs%3Dhttp#p`;
  const n = parseShareUri(uri);
  assert.equal(n.host, "5.6.7.8");
  assert.equal(n.port, 443);
});

test("vmess: base64 JSON", () => {
  const payload = { add: "9.9.9.9", port: "443", ps: "US-01", id: "uuid" };
  const n = parseShareUri(`vmess://${b64(JSON.stringify(payload))}`);
  assert.equal(n.proto, "vmess");
  assert.equal(n.host, "9.9.9.9");
  assert.equal(n.port, 443);
  assert.equal(n.name, "US-01");
});

test("vless with params and encoded name", () => {
  const n = parseShareUri(
    "vless://11111111-2222-3333-4444-555555555555@10.1.1.1:443?encryption=none&security=tls&type=ws#US%2002",
  );
  assert.equal(n.proto, "vless");
  assert.equal(n.host, "10.1.1.1");
  assert.equal(n.port, 443);
  assert.equal(n.name, "US 02");
});

test("trojan and IPv6 host", () => {
  const n = parseShareUri("trojan://secret@[2001:db8::1]:443?sni=example.com#v6-node");
  assert.equal(n.proto, "trojan");
  assert.equal(n.host, "2001:db8::1");
  assert.equal(n.port, 443);
});

test("hysteria2 and hy2 alias, port in query", () => {
  const a = parseShareUri("hysteria2://pw@10.0.0.2:36712?insecure=1#HY2");
  assert.equal(a.proto, "hysteria2");
  assert.equal(a.port, 36712);
  const b = parseShareUri("hy2://pw@10.0.0.3?port=8443#nop");
  assert.equal(b.proto, "hysteria2");
  assert.equal(b.host, "10.0.0.3");
  assert.equal(b.port, 8443);
});

test("tuic", () => {
  const n = parseShareUri("tuic://uuid-here:pass@10.0.0.4:443?congestion_control=bbr#TU");
  assert.equal(n.proto, "tuic");
  assert.equal(n.host, "10.0.0.4");
  assert.equal(n.port, 443);
});

test("ssr with remarks", () => {
  const inner = `1.2.3.5:443:origin:aes-256-cfb:plain:${b64("pass")}/?remarks=${b64("测试节点")}`;
  const n = parseShareUri(`ssr://${Buffer.from(inner, "utf8").toString("base64")}`);
  assert.equal(n.proto, "ssr");
  assert.equal(n.host, "1.2.3.5");
  assert.equal(n.port, 443);
});

test("unknown scheme and garbage return null", () => {
  assert.equal(parseShareUri("snell://whatever"), null);
  assert.equal(parseShareUri("not a uri"), null);
  assert.equal(parseShareUri(""), null);
  assert.equal(parseShareUri("# just a comment"), null);
});

test("parseNodes: plain URI list", () => {
  const body = [
    `ss://${b64("aes-256-gcm:pass@1.2.3.4:8388")}#a`,
    "not a uri",
    `trojan://pw@2.2.2.2:443#b`,
  ].join("\n");
  const { nodes, stats } = parseNodes(body);
  assert.equal(nodes.length, 2);
  assert.equal(stats.total, 3);
  assert.equal(stats.unknown, 1);
});

test("parseNodes: whole-body base64", () => {
  const list = [
    `ss://${b64("aes-256-gcm:pass@1.2.3.4:8388")}#a`,
    `trojan://pw@2.2.2.2:443#b`,
  ].join("\n");
  const body = Buffer.from(list, "utf8").toString("base64");
  const { nodes, stats } = parseNodes(body);
  assert.equal(nodes.length, 2);
  assert.equal(stats.parsed, 2);
});

test("dedupeByHost groups same server", () => {
  const nodes = [
    { name: "a", proto: "trojan", host: "1.1.1.1", port: 443 },
    { name: "b", proto: "trojan", host: "1.1.1.1", port: 443 },
    { name: "c", proto: "ss", host: "1.1.1.1", port: 8388 },
  ];
  const groups = dedupeByHost(nodes);
  assert.equal(groups.size, 2);
  assert.equal(groups.get("1.1.1.1:443").length, 2);
});
