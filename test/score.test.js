import { test } from "node:test";
import assert from "node:assert/strict";
import { purityScore, gradeOf, typeOf } from "../src/score.js";

test("clean residential IP is a perfect 100", () => {
  const r = purityScore({ hosting: false, proxy: false, mobile: false });
  assert.equal(r.score, 100);
  assert.equal(r.grade, "S");
  assert.deepEqual(r.reasons, []);
});

test("datacenter IP loses 35", () => {
  const r = purityScore({ hosting: true });
  assert.equal(r.score, 65);
  assert.equal(r.grade, "B");
  assert.ok(r.reasons.some((x) => x.delta === -35));
});

test("datacenter + proxy flag = 45", () => {
  const r = purityScore({ hosting: true, proxy: true });
  assert.equal(r.score, 45);
  assert.equal(r.grade, "C");
});

test("mobile bonus is capped at 100", () => {
  const r = purityScore({ mobile: true });
  assert.equal(r.score, 100);
  assert.ok(r.reasons.some((x) => x.label.includes("移动")));
});

test("blacklist hits: -8 per zone, capped at -24", () => {
  assert.equal(purityScore({}, { blacklistHits: 1 }).score, 92);
  assert.equal(purityScore({}, { blacklistHits: 2 }).score, 84);
  assert.equal(purityScore({}, { blacklistHits: 3 }).score, 76);
  assert.equal(purityScore({}, { blacklistHits: 10 }).score, 76);
  assert.ok(purityScore({}, { blacklistHits: 10 }).reasons.some((x) => x.label.includes("黑名单")));
});

test("native +5, broadcast -8, unknown nothing", () => {
  assert.equal(purityScore({}, { native: true }).score, 100);
  assert.equal(purityScore({}, { native: false }).score, 92);
  assert.equal(purityScore({}, { native: null }).score, 100);
});

test("combined signals stack additively", () => {
  // hosting -35, broadcast -8, blacklist 1 -8, dup(2) -3, mobile +5
  const r = purityScore(
    { hosting: true, mobile: true },
    { native: false, blacklistHits: 1, dupCount: 2 },
  );
  assert.equal(r.score, 51);
});

test("duplicate exit IPs get progressively penalised, capped at -15", () => {
  assert.equal(purityScore({}, { dupCount: 2 }).score, 97);
  assert.equal(purityScore({}, { dupCount: 3 }).score, 94);
  assert.equal(purityScore({}, { dupCount: 10 }).score, 85);
  assert.equal(purityScore({}, { dupCount: 100 }).score, 85);
});

test("risk score bands", () => {
  assert.equal(purityScore({ risk: 80 }).score, 75);
  assert.equal(purityScore({ risk: 55 }).score, 85);
  assert.equal(purityScore({ risk: 30 }).score, 92);
  assert.equal(purityScore({ risk: 10 }).score, 100);
  assert.equal(purityScore({ risk: null }).score, 100);
});

test("fully burned IP lands on the documented floor of 5, grade D", () => {
  // 100 − 35 hosting − 20 proxy − 25 risk − 15 dup cap = 5
  const r = purityScore({ hosting: true, proxy: true, risk: 90 }, { dupCount: 50 });
  assert.equal(r.score, 5);
  assert.equal(r.grade, "D");
  assert.ok(r.reasons.length >= 4);
});

test("grade boundaries", () => {
  assert.equal(gradeOf(90).grade, "S");
  assert.equal(gradeOf(89).grade, "A");
  assert.equal(gradeOf(75).grade, "A");
  assert.equal(gradeOf(74).grade, "B");
  assert.equal(gradeOf(60).grade, "B");
  assert.equal(gradeOf(59).grade, "C");
  assert.equal(gradeOf(40).grade, "C");
  assert.equal(gradeOf(39).grade, "D");
  assert.equal(gradeOf(0).grade, "D");
});

test("typeOf classification", () => {
  assert.equal(typeOf({ mobile: true, hosting: true }), "移动");
  assert.equal(typeOf({ hosting: true }), "机房");
  assert.equal(typeOf({ isp: "Comcast" }), "家宽/企业");
  assert.equal(typeOf({}), "未知");
});
