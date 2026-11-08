# Changelog

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
