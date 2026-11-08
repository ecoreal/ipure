import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDropList,
  ipToLong,
  ipInCidr,
  inDropList,
  makeDropChecker,
  checkDropBatch,
} from "../src/drop.js";

const SAMPLE = `# Spamhaus DROP sample
; comments and blanks are skipped
1.2.3.0/24 ; SBL123456
203.0.113.0/22 ; SBL234567
198.51.100.7/32 ;
not-a-cidr
10.0.0.0/8
`;

test("parseDropList: keeps CIDRs, drops comments and noise", () => {
  assert.deepEqual(parseDropList(SAMPLE), [
    "1.2.3.0/24",
    "203.0.113.0/22",
    "198.51.100.7/32",
    "10.0.0.0/8",
  ]);
});

test("ipToLong: round-trips and rejects garbage", () => {
  assert.equal(ipToLong("1.2.3.4"), 16909060);
  assert.equal(ipToLong("255.255.255.255"), 4294967295);
  assert.equal(ipToLong("1.2.3"), null);
  assert.equal(ipToLong("1.2.3.999"), null);
});

test("ipInCidr: boundary math", () => {
  assert.equal(ipInCidr("1.2.3.4", "1.2.3.0/24"), true);
  assert.equal(ipInCidr("1.2.4.4", "1.2.3.0/24"), false);
  assert.equal(ipInCidr("1.2.3.255", "1.2.3.0/24"), true);
  assert.equal(ipInCidr("0.0.0.0", "0.0.0.0/0"), true);
  assert.equal(ipInCidr("255.255.255.255", "0.0.0.0/0"), true);
  assert.equal(ipInCidr("198.51.100.7", "198.51.100.7/32"), true);
  assert.equal(ipInCidr("198.51.100.8", "198.51.100.7/32"), false);
  assert.equal(ipInCidr("10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(ipInCidr("11.0.0.1", "10.0.0.0/8"), false);
  assert.equal(ipInCidr("garbage", "1.2.3.0/24"), false);
});

test("inDropList: first matching CIDR wins", () => {
  const list = parseDropList(SAMPLE);
  assert.equal(inDropList("1.2.3.99", list), true);
  assert.equal(inDropList("5.6.7.8", list), false);
  assert.equal(inDropList("1.2.3.99", null), false);
});

test("makeDropChecker: fetches once, caches, degrades silently", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, text: async () => SAMPLE };
  };
  const cache = {};
  const check = makeDropChecker({ fetchImpl, cache });
  assert.equal(await check("1.2.3.4"), true);
  assert.equal(await check("5.6.7.8"), false);
  assert.equal(await check("203.0.113.99"), true);
  assert.equal(calls, 1); // one fetch serves all

  const failing = makeDropChecker({
    fetchImpl: async () => {
      throw new Error("boom");
    },
    cache: {},
  });
  assert.equal(await failing("9.9.9.9"), false); // unavailable → not listed
});

test("checkDropBatch: unique ips, one list fetch total", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, text: async () => SAMPLE };
  };
  const hits = await checkDropBatch(["1.2.3.4", "1.2.3.5", "8.8.8.8"], {
    fetchImpl,
    cache: {},
  });
  assert.equal(calls, 1);
  assert.equal(hits.get("1.2.3.4"), true);
  assert.equal(hits.get("1.2.3.5"), true);
  assert.equal(hits.get("8.8.8.8"), false);
});
