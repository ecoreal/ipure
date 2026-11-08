# Contributing to ipure

Thanks for helping make ipure better! Small, sharp tool — same rules apply.

## Development setup

```bash
git clone https://github.com/ecoreal/ipure && cd ipure
npm test          # 84+ tests, node:test, no network needed
```

That's it. Node ≥ 18.17, **zero dependencies** — please keep it that way.
Every feature must be implementable with Node stdlib or it belongs in a
separate package.

## Ground rules

- **Zero dependencies.** stdlib only.
- **Tests for everything.** New code paths need `node:test` coverage; network
  interactions must be testable via injected fakes (see `test/probe.test.js`
  for the mock-server pattern).
- **Failures degrade, never crash.** A dead resolver, a blocked RDAP endpoint
  or a rate-limited provider must show up as a missing value, not a stack trace.
- **Credentials never leave memory.** If a parser touches secrets, they must
  not reach reports, JSON output, or logs (see how clash usernames/passwords
  are handled).
- **Explain the score.** Any new scoring signal must add a human-readable
  reason entry with its delta, and a row in the README table.
- **Neutral vocabulary.** This is a network diagnostics tool; keep docs and
  copy free of community slang.

## Commit style

Short, imperative, emoji-prefixed to match the house style:

```
⏱ v-prefixed feature commits    🐛 fixes    📝 docs    🔧 CI/build
```

## Filing issues

Include: the exact command, `--json` output (redact anything private),
Node version, and what you expected vs got. For scoring disputes, state which
signal you think is miscalibrated — the score is negotiable, the transparency
is not.
