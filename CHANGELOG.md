# Changelog

## 0.4.0 — 2026-11-08

- **`--probe` exit verification** — sends real traffic through `http`/`https`/
  `socks5` nodes (raw-socket HTTP forward proxy and a minimal SOCKS5 client,
  both with optional auth) and reports whether each node actually works today,
  with the **actual exit IP**. Purity is then scored against the verified exit —
  credential-pinned ISP proxies are judged by the pinned exit, not the gateway.
  Web-based checkers can't do this at all; this closes the "purity ≠
  availability" gap (a node can be spotless and still be rate-limited right now).
- Probes are keyed by `host:port:username` — same server with different
  credentials is a different exit. Credentials live in memory only and never
  reach reports or JSON.
- 8 new tests with real local mock servers (69 total).

## 0.3.0 — 2026-11-08

- **`ipure watch`** — same pipeline as `sub`, plus a persistent snapshot per
  source (`~/.ipure/history/`, `--history-dir` to override): every run prints a
  score diff against the previous one (improved / worsened / new / gone IPs).
  Pair it with a cron or systemd timer and you have an IP quality curve.
- Release automation: `.github/workflows/release.yml` publishes to npm on
  `v*` tags once the `NPM_TOKEN` secret is configured.
- 7 new tests (61 total).

## 0.2.0 — 2026-11-08

- **Clash/Mihomo YAML subscriptions** are now parsed — targeted zero-dependency
  extraction of the `proxies:` section, both inline-flow (`{name: a, ...}`) and
  block styles, quoted ports, and bare-dash indentation. Unparseable entries are
  skipped and counted, never guessed.
- 8 new tests (54 total).

## 0.1.0 — 2026-11-08

- Initial release: URI / whole-body-base64 subscription parsing
  (ss/vmess/vless/trojan/hysteria2/hy2/tuic/ssr), batch exit-IP purity scoring
  (fully itemised), duplicate-exit-IP detection, TCP latency (median of 3),
  standalone HTML share card + optional Chromium PNG export, JSON output.
- Zero npm dependencies; 46 tests; CI on Node 18/20/22/24.
