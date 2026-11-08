// Optional PNG export via a locally installed Chromium/Chrome in headless
// mode. Best effort: if no browser is found we say so and keep the HTML.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CANDIDATES = [
  process.env.IPURE_CHROME,
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
].filter(Boolean);

export function findChrome() {
  for (const bin of CANDIDATES) {
    try {
      execFileSync("which", [bin], { stdio: "pipe" });
      return bin;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export function htmlToPng(htmlPath, pngPath, { width = 980, height = 1400 } = {}) {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      "未找到 Chromium/Chrome，无法导出 PNG（可用 IPURE_CHROME 指定路径，或直接分享 HTML）",
    );
  }
  if (!existsSync(htmlPath)) throw new Error(`HTML 不存在: ${htmlPath}`);
  // Chromium resolves --screenshot relative to its own profile dir, so both
  // paths must be absolute or the file silently vanishes. A missing parent
  // dir fails even more silently (exit 0, no file) — create it first.
  const htmlAbs = path.resolve(htmlPath);
  const pngAbs = path.resolve(pngPath);
  fs.mkdirSync(path.dirname(pngAbs), { recursive: true });
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--screenshot=${pngAbs}`,
    `--window-size=${width},${height}`,
    `file://${htmlAbs}`,
  ];
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");
  execFileSync(chrome, args, { stdio: "pipe", timeout: 30000 });
  return pngAbs;
}
