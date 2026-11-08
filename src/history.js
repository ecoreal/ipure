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
  return path.join(dir, `${key}.jsonl`);
}

function legacyFile(source, dir = defaultHistoryDir()) {
  const key = crypto
    .createHash("sha1")
    .update(String(source))
    .digest("hex")
    .slice(0, 16);
  return path.join(dir, `${key}.json`);
}

// The latest snapshot for a source: last valid line of the JSONL log, with
// legacy pre-1.1 single-object files still readable.
export function loadHistory(source, dir) {
  try {
    const text = fs.readFileSync(historyFile(source, dir), "utf8");
    const lines = text.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* skip torn tail line */
      }
    }
    return null;
  } catch {
    try {
      return JSON.parse(fs.readFileSync(legacyFile(source, dir), "utf8"));
    } catch {
      return null;
    }
  }
}

// Append one snapshot per run — the point of watch is the CURVE, so history
// must accumulate, not overwrite.
export function saveHistory(source, model, dir = defaultHistoryDir()) {
  const f = historyFile(source, dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const snapshot = {
    source,
    generatedAt: model.meta.generatedAt,
    avgScore: model.summary.avgScore,
    ips: Object.fromEntries(
      model.rows.filter((r) => r.ip).map((r) => [r.ip, r.score]),
    ),
  };
  fs.appendFileSync(f, JSON.stringify(snapshot) + "\n");
  // Legacy single-object files are superseded by the log; retire them so
  // listHistory doesn't double-count.
  try {
    fs.rmSync(legacyFile(source, dir), { force: true });
  } catch {
    /* best effort */
  }
  return f;
}

// Every snapshot line in a history dir, sorted by recorded time. Legacy
// pre-1.1 single-object files (and old snapshots without `source`) surface
// gracefully — "(未知源)".
export function listHistory(dir = defaultHistoryDir()) {
  const entries = [];
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return entries;
  }
  const pushSnap = (snap, file) => {
    if (snap && typeof snap === "object" && "avgScore" in snap) {
      entries.push({ file, snapshot: snap });
    }
  };
  for (const file of files) {
    const full = path.join(dir, file);
    if (file.endsWith(".jsonl")) {
      try {
        const text = fs.readFileSync(full, "utf8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            pushSnap(JSON.parse(line), full);
          } catch {
            /* torn line — skip */
          }
        }
      } catch {
        /* unreadable — skip */
      }
    } else if (file.endsWith(".json")) {
      // Legacy single snapshot; ignore if a JSONL log with the same key exists.
      if (files.includes(file.replace(/\.json$/, ".jsonl"))) continue;
      try {
        pushSnap(JSON.parse(fs.readFileSync(full, "utf8")), full);
      } catch {
        /* skip */
      }
    }
  }
  entries.sort((a, b) =>
    String(a.snapshot.generatedAt).localeCompare(String(b.snapshot.generatedAt)),
  );
  return entries;
}

const SPARK = "▁▂▃▄▅▆▇█";

export function sparkline(scores) {
  const list = (scores || []).filter((s) => Number.isFinite(s));
  if (list.length < 2) return list.length ? SPARK[7].repeat(list.length) : "";
  const min = Math.min(...list);
  const max = Math.max(...list);
  const span = max - min || 1;
  return list
    .map((s) => SPARK[Math.round(((s - min) / span) * (SPARK.length - 1))])
    .join("");
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
