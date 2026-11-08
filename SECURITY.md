# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| latest on `main` | ✅ |

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository —
do not open a public issue for anything security-relevant.

Things that would qualify: credential leakage from parsed configs, command
injection via node names or subscription content, SSRF surprises beyond the
documented check/probe/RDAP requests, or path traversal in report writing.

## What is explicitly in scope by design

- ipure sends the IPs you check to the chosen provider (default: `ip-api.com`
  over **plain HTTP**) and, with `--probe`, one HTTP request through each
  proxy node. This is documented behaviour, not a vulnerability.
- Subscription tokens are sent only to the subscription host you provide.
- Report files (`--html/--png/--json`) contain node names and exit IPs by
  design — think before sharing them.

## Data handling

ipure stores nothing except `ipure watch` snapshots under
`~/.ipure/history/` (IPs and scores only, no credentials, no tokens).
Delete the directory to forget everything.
