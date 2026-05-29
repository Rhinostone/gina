# Gina

[![npm version](https://badge.fury.io/js/gina.svg)](https://badge.fury.io/js/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![GitHub version](https://badge.fury.io/gh/gina-io%2Fgina.svg)](https://badge.fury.io/gh/gina-io%2Fgina) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket Badge](https://socket.dev/api/badge/npm/package/gina)](https://socket.dev/npm/package/gina)

> **Documentation:** [gina.io/docs](https://gina.io/docs/) · **Issues:** [GitHub](https://github.com/gina-io/gina/issues) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

Node.js MVC framework with built-in HTTP/2, multi-bundle architecture, and scope-based data isolation — no Express dependency.

- **HTTP/2 first.** Built-in `isaac` server with TLS, h2c, ALPN, HTTP/1.1 fallback, and full CVE hardening (Rapid Reset, CONTINUATION flood, RST flood, HPACK bomb) — all on by default.
- **Multi-bundle.** One project hosts multiple independent bundles (API, web, admin, …). Each bundle has its own routing, controllers, models, and config. Share code via the project layer.
- **Scope isolation.** Run `local`, `beta`, and `production` from the same codebase. Scopes propagate through routing, config interpolation, and data (every DB record is stamped with `_scope`).

## Features

| Feature | Detail |
| --- | --- |
| HTTP/2 server | Built-in `isaac` engine — TLS, h2c, ALPN, HTTP/1.1 fallback, 103 Early Hints, CVE-hardened |
| Multi-bundle | One project, N independent bundles with shared config and project layer |
| Scope isolation | `local` / `beta` / `production` — per-request and per-record |
| MVC routing | `routing.json` — declare routes in config, not code; O(m) radix trie lookup |
| Async/await | Controller actions can be `async`; rejections routed to `throwError` automatically |
| ORM / entities | EventEmitter-based entity system; SQL files auto-wired to entity methods |
| Connectors | Couchbase, MongoDB, ScyllaDB / Cassandra, MySQL, PostgreSQL, Redis, SQLite, AI (LLM) — loaded from project `node_modules` |
| AI connector | Any LLM provider via named protocol (`anthropic://`, `openai://`, `ollama://`, …) |
| Template engine | [`@rhinostone/swig`](https://github.com/gina-io/swig) 2.5.1 — maintained fork with CVE-2023-25345 patched; streaming SSE/chunked via `renderStream()`. Nunjucks supported as opt-in via `render.engine = "nunjucks"` |
| Internationalisation | Per-bundle JSON catalogs, `t()` helper, swig + nunjucks `t` filter, CLDR plurals, ICU MessageFormat opt-in via `t.icu()` |
| Observability | Built-in `/_gina/metrics` Prometheus endpoint (opt-in, IP-allowlisted) — Node.js process metrics + HTTP counter / duration histogram with cardinality-safe route labels |
| Hot reload | WatcherService evicts `require.cache` only on file change — zero per-request overhead in dev |
| K8s ready | `gina-container`, `gina-init`, SIGTERM drain, JSON stdout logging |
| Dependency injection | Mockable connectors and config for unit testing |

## Quick start

```bash
npm install -g gina@latest --prefix=~/.npm-global
gina project:add @myproject --path=$(pwd)/myproject
gina bundle:add api @myproject
gina bundle:start api @myproject
open https://localhost:3100
```

## What's in 0.4.0

**Upgrading note — this is a shortVersion bump (0.3 → 0.4):** the framework creates a fresh `~/.gina/0.4/settings.json` from defaults on install, so customizations made under 0.3 (log level, port, culture, timezone, etc.) are not carried forward. Re-apply them with `gina framework:set`, or copy values across from `~/.gina/0.3/settings.json`. See the [migration guide](https://gina.io/docs/migration).

- **Breaking — Couchbase SDK v2 removed** (#CN8) — the v2 ORM connector and session store are gone; only Couchbase Node SDK **v3 and v4** are supported (defaults to v3). Migration is a driver bump, not a config change: `npm install couchbase@^4` (or `^3`). Bundles still resolving to SDK v2 fail fast at connector load with an explicit upgrade message.
- **Async jobs** (#AI6) — run slow work out-of-band: `self.startJob(fn)` returns a job id immediately and runs `fn` on a concurrency-limited worker; `self.inferAsync(messages, opts)` wires the AI connector through a job in one call. Poll the built-in `GET /_gina/jobs/:id` for state, or opt into a signed completion webhook. See the [Async jobs guide](https://gina.io/docs/guides/async-jobs).
- **HTTP/2 response trailers** (#H10) — `self.sendTrailers(fields)` before rendering emits trailing headers after the body (via the `wantTrailers` event) — useful for gRPC-style `grpc-status` or a content-integrity `Digest`. Fully opt-in: a no-op on HTTP/1.1 and when no trailers are registered. See the [native HTTP/2 guide](https://gina.io/docs/guides/http2-native).
- **CSP per-response nonce** (#HDR16) — `gina.plugins.Csp({ useNonce: true })` mints a fresh nonce per response, stamps the framework-injected bootstrap (and dev-Inspector) inline scripts, and exposes it to templates as `{{ page.cspNonce }}` (swig) / `{{ cspNonce }}` (nunjucks) — letting bundles drop `'unsafe-inline'` from `script-src`. Opt-in (default false). See the [CSP guide](https://gina.io/docs/guides/csp).
- **Inspector remote instrumentation** (#INS9b, #INS10) — an opt-in API-key gate on the dev-mode `/_gina/agent` SSE stream streams authenticated server logs outside dev; `POST /_gina/instrument` opens a time-boxed, key-authenticated window that captures query + flow timelines (JSON, XHR, and server-rendered HTML pages) over the authenticated channel without ever modifying the page HTML. See the [Inspector guide](https://gina.io/docs/guides/inspector).
- **`gina secrets:scan` / `secrets:check` CLI** — introspect the `${secret:KEY}` placeholders your bundle configs require; `secrets:check` marks each key SET/UNSET and exits non-zero on any missing key (CI / pre-deploy gating). `--scope=<scope>`, `--env-file=<path>`, and `--format=json` supported. See the [secrets guide](https://gina.io/docs/guides/secrets).
- **Inspector dev-UX + fixes** — template engine version on the View badge; Weight/Load badges and the Flow timeline restored under `Cross-Origin-Opener-Policy` and for nunjucks bundles; SQL column-level index-coverage matching (including live DB introspection). Fixes: `throwError(statusCode, Error)` now honors the explicit code; an HTTP 500 on browser-session (no-expiry) cookies; `npm install -g` hardening for npm setups that don't propagate `npm_config_global`; refreshed stale external references; `@rhinostone/swig` floor → `^2.5.1`.

See the full [Changelog](./CHANGELOG.md) and [Roadmap](./ROADMAP.md).

## Documentation

Full installation guide, tutorials, configuration reference, and API docs at **[gina.io/docs](https://gina.io/docs/)**.

- [Getting started](https://gina.io/docs/getting-started/)
- [Guides](https://gina.io/docs/guides/)
- [CLI reference](https://gina.io/docs/cli/)
- [Configuration reference](https://gina.io/docs/reference/)
- [Security & CVE compliance](https://gina.io/docs/security)

## Ecosystem

| Package | Description |
| --- | --- |
| [@rhinostone/swig](https://github.com/gina-io/swig) | Maintained fork of the Swig template engine (upstream abandoned since 2015). CVE-2023-25345 patched. |
| [gina-starter](https://github.com/gina-io/gina-starter) | Minimal starter project — one bundle, one route, Docker Compose included |

## Governance

Gina is co-authored by **Martin Luther** ([Rhinostone](https://rhinostone.com)) and **Fabrice DELANEAU** ([fdelaneau.com](https://fdelaneau.com)). Final decisions on direction, API design, and releases rest with Martin Luther. Community contributions and RFCs are welcome and taken seriously. See [GOVERNANCE.md](./GOVERNANCE.md) for details.

## License (MIT)

Copyright © 2009-2026 [Rhinostone](https://rhinostone.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
