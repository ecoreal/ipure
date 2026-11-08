import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIpApi,
  normalizeIpinfo,
  normalizeIpqs,
  ipqsBatch,
  availableProviders,
  checkIps,
} from "../src/providers.js";

test("normalizeIpApi: success", () => {
  const info = normalizeIpApi({
    status: "success",
    country: "United States",
    countryCode: "US",
    city: "Dallas",
    isp: "Cogent Communications",
    org: "SomeVPS LLC",
    as: "AS174 COGENT-174",
    mobile: false,
    proxy: true,
    hosting: true,
    query: "23.19.0.1",
  });
  assert.equal(info.ok, true);
  assert.equal(info.ip, "23.19.0.1");
  assert.equal(info.asn, "AS174");
  assert.equal(info.asnName, "COGENT-174");
  assert.equal(info.hosting, true);
  assert.equal(info.proxy, true);
  assert.equal(info.mobile, false);
  assert.equal(info.risk, null);
});

test("normalizeIpApi: failure is surfaced", () => {
  const info = normalizeIpApi({ status: "fail", message: "private range", query: "10.0.0.1" });
  assert.equal(info.ok, false);
  assert.equal(info.error, "private range");
});

test("normalizeIpApi: null input", () => {
  assert.equal(normalizeIpApi(null).ok, false);
});

test("normalizeIpinfo: hosting asn + privacy flags", () => {
  const info = normalizeIpinfo({
    ip: "104.28.0.1",
    city: "Miami",
    region: "Florida",
    country: "US",
    asn: { asn: "AS20473", name: "The Constant Company", type: "hosting" },
    company: { name: "Vultr", type: "hosting" },
    privacy: { vpn: true, proxy: false, tor: false, relay: false },
  });
  assert.equal(info.ok, true);
  assert.equal(info.hosting, true);
  assert.equal(info.proxy, true);
  assert.equal(info.asn, "AS20473");
  assert.equal(info.isp, "Vultr");
});

test("normalizeIpinfo: residential isp", () => {
  const info = normalizeIpinfo({
    ip: "73.0.0.1",
    country: "US",
    asn: { asn: "AS7922", name: "Comcast", type: "isp" },
    company: { name: "Comcast Cable", type: "isp" },
    privacy: {},
  });
  assert.equal(info.hosting, false);
  assert.equal(info.proxy, false);
});

test("availableProviders respects env", () => {
  assert.equal(availableProviders({})["ip-api"], true);
  assert.equal(availableProviders({}).ipinfo, false);
  assert.equal(availableProviders({ IPINFO_TOKEN: "x" }).ipinfo, true);
  assert.equal(availableProviders({}).ipqs, false);
  assert.equal(availableProviders({ IPQS_KEY: "k" }).ipqs, true);
  assert.equal(availableProviders({ IPQS_TOKEN: "k" }).ipqs, true);
});

test("normalizeIpqs: fraud score and vpn flags map onto the purity model", () => {
  const info = normalizeIpqs({
    success: true,
    ip: "23.19.0.1",
    fraud_score: 86,
    proxy: true,
    vpn: true,
    tor: false,
    hosting: true,
    ISP: "SomeVPS LLC",
    organization: "SomeVPS",
    ASN: 20473,
    country_code: "US",
    city: "Dallas",
    connection_type: "Premium required",
  });
  assert.equal(info.ok, true);
  assert.equal(info.risk, 86);
  assert.equal(info.proxy, true);
  assert.equal(info.hosting, true);
  assert.equal(info.mobile, false);
  assert.equal(info.asn, "AS20473");
  assert.equal(info.cc, "US");
});

test("normalizeIpqs: mobile connection type", () => {
  const info = normalizeIpqs({
    success: true,
    ip: "1.2.3.4",
    fraud_score: 10,
    connection_type: "Mobile",
  });
  assert.equal(info.mobile, true);
  assert.equal(info.proxy, false);
  assert.equal(info.risk, 10);
});

test("normalizeIpqs: failure surfaces the message", () => {
  const info = normalizeIpqs({ success: false, message: "invalid key", ip: "1.1.1.1" });
  assert.equal(info.ok, false);
  assert.equal(info.error, "invalid key");
});

test("ipqsBatch: per-IP fetch with injected fetchImpl", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ip = url.split("/").at(-1).split("?")[0];
    return {
      ok: true,
      json: async () => ({ success: true, ip, fraud_score: 55, hosting: true }),
    };
  };
  const map = await ipqsBatch(["9.9.9.9", "8.8.8.8"], "test-key", {
    fetchImpl,
    conc: 2,
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("/api/json/ip/test-key/"));
  assert.equal(map.get("9.9.9.9").risk, 55);
  assert.equal(map.get("8.8.8.8").hosting, true);
});

test("checkIps: ipqs without any key fails with guidance", async () => {
  const saved = process.env.IPQS_KEY;
  delete process.env.IPQS_KEY;
  delete process.env.IPQS_TOKEN;
  await assert.rejects(
    () => checkIps(["1.1.1.1"], { provider: "ipqs" }),
    /IPQS_KEY/,
  );
  if (saved) process.env.IPQS_KEY = saved;
});
