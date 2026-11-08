// Score history for `ipure watch`: every run snapshots {generatedAt, avgScore,
// ip→score} under a stable key derived from the source, and the next run diffs
// against it. Scheduling stays with your system timer — this module only
// remembers and compares.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultHistoryDir() {
  return path.join(os.homedir(), ".ipure", "history");
}

export function historyFile(source, dir = defaultHistoryDir()) {
  const key = crypto
    .createHash("sha1")
    .update(String(source))
    .digest("hex")
    .slice(0, 16);
  return path.join(dir, `${key}.json`);
}

export function loadHistory(source, dir) {
  try {
    return JSON.parse(fs.readFileSync(historyFile(source, dir), "utf8"));
  } catch {
    return null;
  }
}

export function saveHistory(source, model, dir = defaultHistoryDir()) {
  const f = historyFile(source, dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const snapshot = {
    generatedAt: model.meta.generatedAt,
    avgScore: model.summary.avgScore,
    ips: Object.fromEntries(
      model.rows.filter((r) => r.ip).map((r) => [r.ip, r.score]),
    ),
  };
  fs.writeFileSync(f, JSON.stringify(snapshot, null, 2) + "\n");
  return f;
}

// Compare the previous snapshot against the current model. Scores only —
// latency noise stays out of the story.
export function diffHistory(prev, model) {
  if (!prev) return null;
  const cur = new Map(
    model.rows.filter((r) => r.ip).map((r) => [r.ip, r.score]),
  );
  const prevMap = new Map(Object.entries(prev.ips || {}));

  const changes = [];
  const newIps = [];
  for (const [ip, to] of cur) {
    if (prevMap.has(ip)) {
      const from = prevMap.get(ip);
      if (from !== to) changes.push({ ip, from, to, delta: to - from });
    } else {
      newIps.push(ip);
    }
  }
  const goneIps = [...prevMap.keys()].filter((ip) => !cur.has(ip));
  changes.sort((a, b) => a.delta - b.delta); // worst first

  return {
    prevAt: prev.generatedAt,
    avgDelta: model.summary.avgScore - (prev.avgScore ?? 0),
    better: changes.filter((c) => c.delta > 0),
    worse: changes.filter((c) => c.delta < 0),
    changes: changes.slice(0, 6),
    newIps,
    goneIps,
  };
}
