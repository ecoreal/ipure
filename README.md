<div align="center">

# ⏱ ipure

**Is your IP fresh or burned? Paste a list, get the verdict — locally, in seconds.**

[![CI](https://github.com/ecoreal/ipure/actions/workflows/ci.yml/badge.svg)](https://github.com/ecoreal/ipure/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-3fb96f.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518.17-339933)](package.json)
[![dependencies](https://img.shields.io/badge/dependencies-0-339933)](package.json)
[![tests](https://img.shields.io/badge/tests-104-5ba1f0)](#development)

[中文说明](README.zh-CN.md) · [在线示例报告](https://ecoreal.github.io/ipure/demo-report.html)

**Purity scoring · Exit verification · Duplicate exits · Native/Broadcast · DNSBL · Latency · Share cards**

</div>

```console
$ npx ipure check 8.8.8.8 1.1.1.1

   #    节点        协议   出口 IP    类型    延迟  原生    纯净度
   1    8.8.8.8     -      8.8.8.8   机房     —    原生    50 C
   2    1.1.1.1     -      1.1.1.1   机房     —    原生    70 B
```

IP-quality web tools are great — until an entire forum shares one API quota
and everything rate-limits by noon, and none of them can ever answer the two
questions that matter most about *your own* setup: **does this node actually
work right now**, and **which exit IP does it really use**.

**ipure runs everything on your machine, against your own quota:**

- **Purity score 0–100** — datacenter/proxy/risk penalties, DNSBL hits, mobile & native bonuses. Every point itemised, zero black box
- **Exit verification** (`--probe`) — real traffic through `http`/`socks5` nodes (auth included): is the node alive *today*, and which IP actually exits
- **Duplicate-exit detection** — how many clients secretly share one exit IP
- **Native / Broadcast** — RIR registration region vs usage region, the streaming-unlock people's favourite signal
- **DNSBL blacklists** (`--blacklist`) — 3 permissive zones, opt-in
- **Score history** — `ipure watch` snapshots every run and diffs against the last; wire it to a timer and you have a quality curve
- **Share cards** — standalone HTML, PNG via local Chromium, JSON

![report card](docs/screenshot.png)

## Install

```bash
npm install -g ipure
# or run once, install nothing:
npx ipure check 8.8.8.8 1.1.1.1
```

Requires Node ≥ 18.17. Nothing else — zero npm dependencies.

## Usage

```bash
# Full subscription health check (Clash/Mihomo YAML, URI list, base64, stdin "-")
ipure sub "https://provider.example/subscribe?token=xxx"
ipure sub ./config.yaml --html report.html --png report.png

# Verify nodes actually work and score the real exit IPs (http/socks5)
ipure sub ./isp-proxies.yaml --probe

# Track quality over time — append a snapshot per run, draw the curve
ipure watch ./config.yaml --history-dir ~/.ipure/history
ipure history ./config.yaml

# Check IPs directly
ipure check 8.8.8.8 1.1.1.1 73.0.0.1
cat suspicious-ips.txt | ipure check --blacklist

# CI / timers: exit non-zero when average purity drops below a threshold
ipure watch ./config.yaml --fail-under 60
```

| Option | Meaning |
|---|---|
| `--probe` | real-traffic exit verification for `http`/`https`/`socks5` nodes |
| `--blacklist` | DNSBL queries (3 permissive zones; quality depends on your resolver) |
| `--drop` | Spamhaus DROP hijacked-netblock check |
| `--no-rdap` | skip native/broadcast detection |
| `--fail-under <n>` | exit code 1 when average purity < n |
| `--notify <url>` | `watch`: POST a webhook when scores drop or fall below the floor (`--notify-always` for every run) |
| `--provider <name>` | `ip-api` (default, no key) · `ipinfo` (`IPINFO_TOKEN`) · `ipqs` (`IPQS_KEY`, real fraud score) |
| `--html <file>` / `--png <file>` | shareable card / Chromium screenshot (`IPURE_CHROME` to override) |
| `--json <file\|->` | machine-readable output |
| `--sort score` · `--no-latency` · `--timeout <ms>` · `--conc <n>` · `--no-color` | the usual knobs |

## The score, itemised

| Signal | Delta | Why |
|---|---|---|
| Base | **100** | innocent until measured |
| Datacenter (hosting) | **−35** | VPS/cloud ranges are cheap and shared |
| Flagged as proxy/VPN/Tor | **−20** | already in a risk database |
| Provider risk score ≥75 / ≥50 / ≥25 | **−25 / −15 / −8** | scaled by severity |
| DNSBL hit per zone (opt-in) | **−8, cap −24** | history of abuse reports |
| N clients share one exit IP | **−3 × (N−1), cap −15** | the "burned IP" tax |
| Spamhaus DROP netblock (opt-in `--drop`) | **−15** | hijacked / illegitimately announced space |
| Broadcast (registered ≠ used region) | **−8** | announced somewhere else than registered |
| Mobile carrier exit | **+5** | about as clean as it gets |
| Native (registered = used region) | **+5** | RIR data agrees with geography |

Grades: **S** ≥90 native-grade clean · **A** ≥75 · **B** ≥60 usable · **C** ≥40 already flagged · **D** <40 swap it.

## Why local-first

| | Web IP-quality sites | ipure |
|---|---|---|
| API quota | shared with everyone, dies at noon | yours, local |
| Your node's live availability | impossible | `--probe` |
| The *real* exit of credential-pinned proxies | impossible | scored on the verified exit |
| Subscription parsing | no | Clash YAML / URI / base64 |
| Your data | you pasted it to them | nothing leaves your machine but the checks |
| Reproducible in CI/timers | no | `--json` + `--fail-under` + `watch` |

## Privacy, honestly

- ipure is **local-first**: your subscription token is only ever sent to the provider you pasted it to (plus DNS).
- The default `ip-api` free tier is **plain HTTP** — the list of IPs you check is visible on the wire. For sensitive lists, set `IPINFO_TOKEN` and use `--provider ipinfo` (HTTPS, free 50k/month).
- Probe targets default to `ip-api.com` over HTTP; RDAP goes to `rdap.org`/RIR servers over HTTPS.
- No telemetry, no "anonymous statistics", zero dependencies to trust.

## Development

```bash
git clone https://github.com/ecoreal/ipure && cd ipure
npm test          # 104 tests, node:test, no network needed
```

Releases: push a `v*` tag and CI publishes to npm (needs the `NPM_TOKEN` secret).

## FAQ

**Why do my results differ from website X?** Different databases, different moments. ipure shows every input to the score so you can compare signal by signal — that's the point of itemised scoring.

**Why is `--blacklist` opt-in?** DNSBL correctness depends on your resolver; some networks poison or hijack DNSBL zones. Try it, sanity-check one known-listed IP, then trust it.

**Which protocols can be exit-verified?** `http`, `https`, `socks5` (with optional auth) — a real request travels through the node. Encrypted protocols (ss/vmess/vless/trojan/hysteria2) get the TCP-latency probe; their exit is whatever the server config says, which only the operator can change.

**Windows?** Anything Node 18 runs on. PNG export additionally needs a local Chromium.

## Roadmap

Cleared — everything promised at 1.0 shipped. Ideas live in the issue tracker.

## License

MIT © 2026 [ecoreal](https://github.com/ecoreal)
