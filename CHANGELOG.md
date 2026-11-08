# Changelog

## 1.1.0 — 2026-11-08

- **`ipure history [source]`** — watch snapshots now **append** (JSONL log, one
  record per run) instead of overwriting, so the curve is real. `history`
  renders sparklines per source plus the last 10 records; legacy single-object
  snapshots still load.
- **`--provider ipqs`** — IPQualityScore fraud_score as a real risk signal
  (`IPQS_KEY`, per-IP quota), mapped onto proxy/vpn/tor/hosting/mobile flags.
- **`watch --notify <url>`** — webhook alert when scores drop or fall below
  `--fail-under` (`--notify-always` for every run). Payload carries
  event/source/avgDelta/worse/better/new-gone IPs.
- 13 new tests (97 total), all offline.

## 1.0.0 — 2026-11-08

First stable release. One local pass now answers four independent questions:

1. **How clean is this IP?** — itemised purity score (datacenter/proxy/risk,
   DNSBL hits, mobile/native bonuses)
2. **Does my node actually work right now?** — `--probe` real-traffic exit
   verification for http/socks5, scored on the verified exit
3. **Who am I sharing it with?** — duplicate-exit detection
4. **Is it native or broadcast?** — RIR registration vs usage region

Plus: score history (`watch`), shareable HTML/PNG cards, JSON, CI-friendly
`--fail-under`. Zero dependencies, 84 network-free tests, CI on Node
18/20/22/24, npm release automation on `v*` tags.

## 0.5.0 — 2026-11-08

- **`--blacklist`** — DNSBL hits across 3 permissive zones (−8/zone, cap −24);
  resolver injectable; results honest about resolver dependence.
- **Native/broadcast detection** — RIR registration data via RDAP
  (rdap.org bootstrap, /24 negative cache, ARIN registrant-vcard country
  recovery through `Intl.DisplayNames`): native +5, broadcast −8, failures
  degrade to "unknown" silently.
- **`--fail-under <n>`** — non-zero exit when average purity drops below a
  threshold (CI/timer alerting).
- Native/黑名单 columns in terminal and HTML reports, summary chips.
- Probe/HTTP requests sent as HTTP/1.0 (no chunked surprises).
- 15 new tests (84 total).

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
