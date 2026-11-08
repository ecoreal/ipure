import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIpApi,
  normalizeIpinfo,
  availableProviders,
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
});
