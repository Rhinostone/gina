# Gina

[![npm version](https://img.shields.io/npm/v/gina)](https://www.npmjs.com/package/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket](https://img.shields.io/badge/Socket-view%20analysis-blue)](https://socket.dev/npm/package/gina) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Bun >= 1.2](https://img.shields.io/badge/Bun-%3E%3D%201.2-brightgreen)](https://bun.sh) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Documentation:** [gina.io/docs](https://gina.io/docs/) · **Issues:** [GitHub](https://github.com/gina-io/gina/issues) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

MVC framework for Node.js and Bun with built-in HTTP/2, multi-bundle architecture, and scope-based data isolation — no Express dependency.

- **HTTP/2 first.** Built-in `isaac` server with TLS, h2c, ALPN, HTTP/1.1 fallback, and full CVE hardening (Rapid Reset, CONTINUATION flood, RST flood, HPACK bomb) — all on by default.
- **Multi-bundle.** One project hosts multiple independent bundles (API, web, admin, …). Each bundle has its own routing, controllers, models, and config. Share code via the project layer.
- **Scope isolation.** Run `local`, `beta`, and `production` from the same codebase. Scopes propagate through routing, config interpolation, and data (every DB record is stamped with `_scope`).
- **Batteries included.** Forms & validation, sessions, uploads, async jobs, response caching, CSRF, security headers, route authorization, audit trail, i18n, OpenAPI + MCP generation — built in, not bolted on.

## Features

| Feature | Detail |
| --- | --- |
| HTTP/2 server | Built-in `isaac` engine — TLS, h2c, ALPN, HTTP/1.1 fallback, 103 Early Hints, CVE-hardened |
| Multi-bundle | One project, N independent bundles with shared config and project layer |
| Scope isolation | `local` / `beta` / `production` — per-request and per-record |
| MVC routing | `routing.json` — declare routes in config, not code; O(m) radix trie lookup |
| Async/await | Controller actions can be `async`; rejections routed to `throwError` automatically |
| WebSockets | WS routes in `routing.json` (`"method": "ws"` + channel handlers, `:param` paths); WebSocket-over-HTTP/2 (RFC 8441) |
| ORM / entities | EventEmitter-based entity system; SQL files auto-wired to entity methods |
| Connectors | Couchbase, MongoDB, ScyllaDB / Cassandra, MySQL, PostgreSQL, Redis, SQLite, AI (LLM) — loaded from project `node_modules` |
| AI connector | Any LLM provider via named protocol (`anthropic://`, `openai://`, `ollama://`, …) — unified `.infer()`, token streaming via `.stream()`, inference-as-a-job via `self.inferAsync()` |
| Template engine | [`@rhinostone/swig`](https://github.com/gina-io/swig) — maintained fork with CVE-2023-25345 patched; streaming SSE/chunked via `renderStream()`. Nunjucks supported as opt-in via `render.engine = "nunjucks"` or per-section `"ext": ".njk"` |
| Forms & validation | One rule engine for client and server — live checks, cross-field rules, ARIA states, localised messages; the server enforces the same rules on submit |
| DTOs | `gina.dto` schema builder — request validation with localised 422s (`param.dto`), response shaping (`param.responseDto`), JSON Schema export |
| Sessions | Hardened session plugin (SameSite / HttpOnly / Secure defaults) — Redis, SQLite, MongoDB, Couchbase, and ScyllaDB stores; session-id rotation on login, opt-in absolute timeout, record destroyed on logout |
| File uploads | Multipart via the maintained [`@rhinostone/busboy`](https://github.com/gina-io/busboy) fork — named upload groups with per-group extension allow-lists, size / count limits, and target dirs |
| Async jobs | `self.startJob()` background jobs — durable SQLite / MongoDB / Redis stores, retries with backoff, HMAC-signed completion webhooks, `/_gina/jobs/:id` status endpoint |
| Response caching | Per-route render cache — memory / fs / Redis tiers, cross-replica warm start, event-driven invalidation, RFC 9211 `Cache-Status` |
| Authentication | `lib.authn` primitives — scrypt password hashing as self-describing PHC strings (argon2 / bcrypt verify-only for migration), NIST SP 800-63B policy, enumeration-safe `dummyVerify`, PCI-DSS account lockout, RFC 6238 TOTP |
| Route authorization | `requireAuth` / `roles` / `policy` per route or deny-by-default, login bounce with `resumeRequest()`, `self.hasRole()` |
| Audit trail | Opt-in append-only JSONL audit log (`self.audit()`), authorization denials auto-recorded, always-on request ids; opt-in HMAC hash chain verified offline by `gina audit:verify` |
| CSRF protection | Signed double-submit token middleware + Origin/Referer pre-filter + hardened session cookie |
| Security headers | CSP with per-response nonces, HSTS, COOP / COEP / CORP, Referrer-Policy and the X-* family — per-header plugins or one `SecurityHeaders` wrapper |
| Secrets | `${secret:KEY}` placeholders in bundle config — fail-closed, env-backed; `secrets:scan` / `secrets:check` CLI |
| Internationalisation | Per-bundle JSON catalogs, `t()` helper, swig + nunjucks `t` filter, CLDR plurals, ICU MessageFormat opt-in via `t.icu()` |
| Observability | Built-in `/_gina/metrics` Prometheus endpoint (opt-in, IP-allowlisted) — process metrics + HTTP counter / duration histogram with cardinality-safe route labels; structured JSON logs with request ids (`GINA_LOG_FORMAT=json`) |
| Dev Inspector | Embedded dev SPA at `/_gina/inspector` — request data, live logs, SQL with index-coverage badges, flow timings, app events, AI token stream |
| OpenAPI & MCP | `bundle:openapi` emits OpenAPI 3.1 from `routing.json`; `bundle:mcp` emits an MCP tool manifest; built-in MCP runtime server (stdio + Streamable HTTP) |
| TypeScript & ESM | Typed public surface (shipped `.d.ts`), `bundle:types` generates entity types from DTOs, dual CJS / ESM exports |
| Hot reload | WatcherService evicts `require.cache` only on file change — zero per-request overhead in dev |
| K8s ready | `gina-container`, `gina-init`, SIGTERM drain, JSON stdout logging |
| Container tooling | `image:build` synthesizes an OCI image (buildah), `image:run` / `container:ps` / `container:stop` (podman) — local or over SSH |
| Dependency injection | Mockable connectors and config for unit testing |
| Runtime | Node.js 22–26, or **Bun** (`bun add -g gina`) — install + boot validated end-to-end by a CI Bun smoke |

## Quick start

```bash
npm install -g gina@latest --prefix=~/.npm-global   # or, on the Bun runtime: bun add -g gina
gina project:add @myproject --path=$(pwd)/myproject
gina bundle:add api @myproject
gina bundle:start api @myproject
open https://localhost:3100
```

> **npm 12+** blocks install scripts by default, and gina's post-install bootstraps `~/.gina` and the framework dependencies. Install with `npm install -g gina@latest --allow-scripts=gina`, or allow it once for all global installs with `npm config set allow-scripts=gina --location=user`. (Not needed on npm ≤ 11.)

## What's in 0.6.2

> **Re-bake your bundles, not just restart them.** The browser bundle changed in
> this release, so a restart alone picks up only the server-side half of the
> render optimisation. Rebuild each bundle (`gina bundle:build`) to pick up the
> client-side half as well. Nothing breaks if you only restart — you just leave
> part of the speedup on the table.

> **No settings reset.** `0.6.2` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

- **Changed — render and request-path CPU overhead is sharply reduced: 4.4× render throughput.** Every render was deep-copying the request options twice — once for the template-filter configuration and once for the render envelope — and re-resolving the request locale from scratch. The copies are now passed by reference, after each one's write surface was measured empty; the locale lookups are memoized per culture with the request-local copy materialized lazily on first read; and the id generator sizes its entropy batch to the length actually requested, so a 16-character id costs one webcrypto call instead of three. Measured on the profiling harness introduced in this release: **10.7 ms → 2.4 ms per render** on the baseline workload, deep-clone CPU share **50.31% → 1.81%**, and GC time down roughly **18×** — the stated ~2× ceiling was beaten because the GC and locality knock-on fell along with the allocations. No API change. Server-side gains land on restart; the id-generator half is browser-bundled, so **re-bake your bundles** for the rest. (#P39)
- **Added — opt-in 503 + `Retry-After` for transient datastore failures.** Set `server.transientErrors.enabled: true` in a bundle's `settings.json` and a connector error stamped `isTransient` that would have rendered as HTTP 500 through `throwError` renders as **503** with a `Retry-After` header instead — so a caller or proxy can back off and retry rather than treating a momentary datastore blip as a permanent server fault. `retryAfter` sets the header's value (integer seconds, 1–86400, default 30) and `message` replaces the user-facing `error` field (default: the standard 503 status text). Applies on both engines, across JSON and HTML error surfaces, over HTTP/1.1 and HTTP/2 alike. Explicit non-500 statuses and permanent errors are never upgraded. **Nothing to do** — the feature is off by default and the default behaviour is byte-identical to 0.6.1. A malformed `server.transientErrors` block warns at boot and leaves the feature off; it never refuses a boot. Server-side — restart your bundles. (#CE1)
- **Fixed — an `env.json` block that omits `host` no longer breaks HTTPS and HTTP/2 bundles.** `host` was the only value the per-bundle configuration reads that had no framework-side default — it was written solely by the CLI into the project `env.json`, so a hand-written or partial block never received one. The `${host}` token was then left unsubstituted inside the TLS credentials paths, and the bundle refused to start with an ENOENT naming a literal `${host}` path segment, under an error message pointing at the server settings rather than at the missing key. The framework env template now carries the same `localhost` default the CLI already writes, so a block setting only a subset of keys resolves correctly, and a bundle whose `env.json` omits `host` logs a warning naming the bundle and env instead of defaulting silently. Projects that declare `host` are unaffected. Server-side — restart your bundles. (#B181)
- **Fixed — a bundle whose `env.json` has no block for the environment it starts in now says so.** It previously died with an opaque `Cannot read properties of undefined` crash that named neither the bundle, the environment, nor the file. The boot now refuses with all of them, plus the resolved `env.json` path and whether the file was found at all. All three shapes that produced the same failure are covered: an `env.json` that is absent entirely, one that is empty, and one that declares only bundles the project manifest does not list. The refusal exits **1** through the same path as the missing `routing.json` refusal, so an external supervisor can retry while a release tree settles. A configuration that boots today is unaffected — the check can only fire where the boot already crashed. Server-side — restart your bundles. (#B181)
- **Fixed — starting a bundle in an environment its `env.json` block does not cover refuses cleanly.** This previously surfaced as `TypeError: Cannot set properties of undefined (setting 'bundlesPath')` at **exit 143**, naming neither the file nor the bundle; it now exits **1** naming the bundle, the environment and the resolved `env.json` path. Separately, a bundle that *is* declared for other environments but not the one being started is now reported as skipped and the project boots on — where previously it took every sibling bundle down with it. If a supervisor or orchestrator keys off the old 143, note the code change. Server-side — restart your bundles. (#B183)
- **Fixed — dead process records are removed from the `~/.gina/procs.json` registry under the right key.** `removeRunningProc()` located the entry to drop by pid but deleted under the constructing bundle's key: self-removal worked by accident, while a non-coinciding dismissal rewrote the dead `gina-*` record straight back to disk — accumulating stale entries, a documented cause of daemon and boot confusion — and could destroy a live record instead, degrading `gina stop`, whose graceful-kill path locates the daemon through this registry. Pre-existing stale entries are not cleaned retroactively; with the daemon stopped, clearing the file once is safe. Server-side — restart your bundles. (#B180)
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

Gina is co-authored by **Martin Luther ETOUMAN NDAMBWE** ([Rhinostone](https://rhinostone.com)) and **Fabrice DELANEAU** ([fdelaneau.com](https://fdelaneau.com)). Final decisions on direction, API design, and releases rest with Martin Luther. Community contributions and RFCs are welcome and taken seriously. See [GOVERNANCE.md](./GOVERNANCE.md) for details.

## Supply-chain scanners

Gina is an MVC framework with a process-management CLI, so it uses Node's
`child_process` by design — to start and supervise application bundle processes
and the framework daemon, run local/SSH commands (`lib/shell`), launch the
inspector, and perform setup in the npm install scripts. Supply-chain scanners
therefore report a **Shell access** capability for `child_process`. This is
expected and intrinsic to a CLI framework, not a vulnerability: the install-time
commands are built only from local values (npm prefix, install path) and take no
network input.

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
