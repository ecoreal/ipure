import { test } from "node:test";
import assert from "node:assert/strict";
import {
  subnetKey,
  parseRdap,
  nativenessOf,
  makeRdapLookup,
  lookupRdapBatch,
} from "../src/rdap.js";

test("subnetKey groups addresses by /24 and tolerates garbage", () => {
  assert.equal(subnetKey("1.2.3.4"), "1.2.3");
  assert.equal(subnetKey("1.2.3.99"), "1.2.3");
  assert.equal(subnetKey("not-an-ip"), "not-an-ip");
});

test("parseRdap extracts country/name and rejects empties", () => {
  assert.deepEqual(parseRdap({ country: "us", name: "ACME hosting", handle: "NET-1" }), {
    country: "US",
    name: "ACME hosting",
    net: "NET-1",
  });
  assert.equal(parseRdap({}), null);
  assert.equal(parseRdap(null), null);
});

test("parseRdap: ARIN-style registrant vcard country is recovered", () => {
  const arin = {
    name: "GOOGLE",
    entities: [
      {
        roles: ["registrant"],
        vcardArray: [
          "vcard",
          [
            ["version", {}, "text", "4.0"],
            ["fn", {}, "text", "Google LLC"],
            [
              "adr",
              { label: "1600 Amphitheatre Parkway\nMountain View\nCA\n94043\nUnited States" },
              "text",
              undefined,
            ],
          ],
        ],
      },
    ],
  };
  const r = parseRdap(arin);
  assert.equal(r.country, "US");
  assert.equal(r.name, "GOOGLE");
});

test("nativenessOf: match means native, mismatch broadcast, unknown stays null", () => {
  assert.equal(nativenessOf("US", "US"), "原生");
  assert.equal(nativenessOf("DE", "us"), "广播");
  assert.equal(nativenessOf(null, "US"), null);
  assert.equal(nativenessOf("US", null), null);
});

test("rdap lookup caches per /24 — one fetch for two neighbours", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ country: "JP", name: "TOKYO-NET", handle: "NET-1" }),
    };
  };
  const cache = new Map();
  const lookup = makeRdapLookup({ fetchImpl, cache });
  const a = await lookup("126.72.1.5");
  const b = await lookup("126.72.1.99");
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.country, "JP");
});

test("rdap lookup: failures degrade to null and are cached", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("boom");
  };
  const cache = new Map();
  const lookup = makeRdapLookup({ fetchImpl, cache, timeout: 100 });
  assert.equal(await lookup("8.8.8.8"), null);
  assert.equal(await lookup("8.8.8.9"), null);
  assert.equal(calls, 1); // negative caching keeps RDAP polite
});

test("lookupRdapBatch maps every unique ip", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ country: "DE" }),
  });
  const map = await lookupRdapBatch(["10.0.0.1", "10.0.0.1", "10.0.1.1"], {
    fetchImpl,
    cache: new Map(),
  });
  assert.equal(map.size, 2);
  assert.equal(map.get("10.0.0.1").country, "DE");
});
