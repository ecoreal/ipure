import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isListedAnswer,
  makeBlacklistChecker,
  checkBlacklistBatch,
} from "../src/blacklist.js";

function mockResolver(map) {
  return {
    resolve4: async (host) => {
      for (const [suffix, addrs] of Object.entries(map)) {
        if (host.endsWith(suffix)) {
          if (addrs === null) {
            const err = new Error("NXDOMAIN");
            err.code = "ENOTFOUND";
            throw err;
          }
          return addrs;
        }
      }
      const err = new Error("NXDOMAIN");
      err.code = "ENOTFOUND";
      throw err;
    },
  };
}

test("isListedAnswer recognises 127.0.0.x answers only", () => {
  assert.equal(isListedAnswer(["127.0.0.4"]), true);
  assert.equal(isListedAnswer(["1.2.3.4"]), false);
  assert.equal(isListedAnswer([]), false);
  assert.equal(isListedAnswer(null), false);
});

test("blacklist checker: listed on one zone, clean on others", async () => {
  const check = makeBlacklistChecker({
    resolver: mockResolver({
      "bl.blocklist.de": ["127.0.0.4"],
      "psbl.surriel.com": null,
      "dnsbl.sorbs.net": null,
    }),
  });
  const hits = await check("1.2.3.4");
  assert.deepEqual(hits, ["bl.blocklist.de"]);
});

test("blacklist checker: reversed query order is correct", async () => {
  let queried = "";
  const check = makeBlacklistChecker({
    resolver: { resolve4: async (h) => ((queried = h), []) },
  });
  await check("203.0.113.7");
  assert.ok(queried.startsWith("7.113.0.203."));
});

test("checkBlacklistBatch: concurrency, dedupe, per-IP results", async () => {
  const map = await checkBlacklistBatch(["9.9.9.9", "8.8.8.8", "9.9.9.9"], {
    resolver: {
      resolve4: async (host) => {
        if (host === "9.9.9.9.psbl.surriel.com") return ["127.0.0.10"];
        const err = new Error("NXDOMAIN");
        err.code = "ENOTFOUND";
        throw err;
      },
    },
  });
  assert.equal(map.size, 2);
  assert.deepEqual(map.get("9.9.9.9"), ["psbl.surriel.com"]);
  assert.deepEqual(map.get("8.8.8.8"), []);
});

test("checkBlacklistBatch: resolver blowups degrade to empty hits", async () => {
  const map = await checkBlacklistBatch(["4.4.4.4"], {
    resolver: {
      resolve4: async () => {
        throw new Error("servfail");
      },
    },
  });
  assert.deepEqual(map.get("4.4.4.4"), []);
});
