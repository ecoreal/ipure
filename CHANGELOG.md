# Changelog

## 1.2.0 — 2026-11-09

- **`--drop`** — Spamhaus DROP netblock check: exits sitting inside a hijacked
  or illegitimately announced netblock (Don't Route Or Peer list) take a flat
  −15. Different signal from DNSBL ("behaved badly") — this one asks "is the
  netblock even legitimate". One list fetch per run, cached; unavailable list
  degrades silently.
- `ipure history` gains no changes; `check` and `sub`/`watch` both honour
  `--drop`.
- 7 new tests (104 total). The roadmap from the 1.0 announcement is now clear.

## 1.1.0 — 2026-11-08
