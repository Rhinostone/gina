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
| Object storage | `gina.storage()` — named drivers pairing an adapter (`local` filesystem, or `s3` for any S3-compatible provider with its SDK as a project-side dependency) with a key strategy behind opaque keys: `sharded` (dated), `cas` (content-addressed, deduplicating, refcounted, GC-swept) and `stream` (large media, resumable out-of-order segment uploads); size tiering, HTTP Range serving (`serveFromStorage()` — 206/416/304, strong key ETags), presigned-URL offload (307) on `s3`, embedded SQLite or Couchbase metadata store, `storage:stats` / `gc` / `verify` CLI |
| Async jobs | `self.startJob()` background jobs — durable SQLite / MongoDB / Redis stores, retries with backoff, HMAC-signed completion webhooks, `/_gina/jobs/:id` status endpoint |
| Response caching | Per-route render cache — memory / fs / Redis tiers, cross-replica warm start, event-driven invalidation, RFC 9211 `Cache-Status` |
| Authentication | `lib.authn` primitives — scrypt password hashing as self-describing PHC strings (argon2 / bcrypt verify-only for migration), NIST SP 800-63B policy, enumeration-safe `dummyVerify`, PCI-DSS account lockout, RFC 6238 TOTP |
| Route authorization | `requireAuth` / `roles` / `policy` per route or deny-by-default, login bounce with `resumeRequest()`, `self.hasRole()` |
| Rate limiting | Opt-in identified-caller quotas at the router (#MS6) — fixed-window counters over the KV primitive (per-process, or replica-shared via redis/sqlite), per-route overrides/exemptions, 429 + `Retry-After` + draft `RateLimit` header fields; anonymous flood control stays at your edge by design |
| Audit trail | Opt-in append-only JSONL audit log (`self.audit()`), authorization denials auto-recorded, always-on request ids; opt-in HMAC hash chain verified offline by `gina audit:verify` |
| CSRF protection | Signed double-submit token middleware + Origin/Referer pre-filter + hardened session cookie |
| Security headers | CSP with per-response nonces, HSTS, COOP / COEP / CORP, Referrer-Policy and the X-* family — per-header plugins or one `SecurityHeaders` wrapper |
| Secrets | `${secret:KEY}` placeholders in bundle config — fail-closed, env-backed, with opt-in file and exec-bridge tiers beneath the environment; `secrets:scan` / `secrets:check` CLI |
| Internationalisation | Per-bundle JSON catalogs, `t()` helper, swig + nunjucks `t` filter, CLDR plurals, ICU MessageFormat opt-in via `t.icu()` |
| Exact money | `lib.money` / `gina.money` — ISO 4217 minor-unit integer arithmetic (BigInt-safe), strict wire-string parsing, same-currency guards; display via `Intl.NumberFormat` |
| Idempotency keys | Opt-in `Idempotency-Key` dedup at the router band (IETF draft): retried mutations replay the recorded first response — 409 while in flight, 422 on payload reuse, principal-scoped over the kv primitive |
| Message validation | `param.messageValidator` — a route-level seam running the raw request body through an application-supplied validator (XSD sidecar, JSON Schema, anything) before the action: boot-compiled factory, sync or async, fail-closed 400/422/503 refusals with `Retry-After` on checker outage |
| XML in and out | `application/xml`, `text/xml` and `application/*+xml` request bodies reach the action verbatim on `req.body`; `self.renderXML()` sends pre-serialised responses with the right content type and charset. The application brings its own XML library — the framework parses none and builds none |
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

## What's in 0.6.25

> **Restart AND rebuild your bundles.** This release changes the browser bundle:
> the exact-money primitive (`gina.money`), the `isIban`/`isBic` validation
> rules and the routing-helper diagnostic all ride `gina.min.js`. Run
> `gina bundle:build` after upgrading, then `gina bundle:restart`.

> **No settings reset.** `0.6.25` is a patch — the `shortVersion` stays `0.6`,
> so your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**The financial-messaging foundations release** — five additive building blocks
for ISO 20022-class and payments-grade applications, plus one hardening fix and
two bug fixes. Full detail in [CHANGELOG.md](./CHANGELOG.md).

- **Added — verbatim XML request bodies (#FIN1).** A POST, PUT or PATCH whose `Content-Type` is `application/xml`, `text/xml` or any `application/*+xml` type reaches your action verbatim: `req.body` is the exact document as a string, and you parse it with the library of your choice — gina never parses XML itself. Previously such a body was silently destroyed by the form-encoded decode path.
- **Added — `self.renderXML(xmlContent, contentType)` (#FIN2).** First-class XML responses: send a pre-serialised document and the delegate owns the wire concerns — `application/xml` by default with your bundle's charset (RFC 7303), an optional `+xml`-suffix content type (`application/soap+xml`, `atom+xml`, vendor trees), HEAD suppression with byte-accurate `content-length`, the HTTP/2 pseudo-header status, opt-in trailers.
- **Added — message-schema validation seam (#FIN3).** Declare `"messageValidator": "<name>"` in a route's `param` block and ship a factory at `message-validators/<name>.js` — boot-compiled (a broken module refuses the boot instead of silently skipping validation), sync or async, fed the verbatim body string. Refusals are fail-closed: 422 with your `errors` array, 400 for an unparseable document, 503 + `Retry-After` when your checker is down. Gina ships no schema engine — the validator is yours; the hook, the ordering and the refusal shape are the framework's.
- **Added — `isIban` / `isBic` FormValidator rules (#FIN4).** IBAN per ISO 13616 — shape, official per-country length for 87 registered countries, and the ISO 7064 MOD 97-10 checksum — with a tolerant read (case and separators normalized for validation only; the stored value is never mutated), plus BIC per ISO 9362. Client + server, like every built-in rule.
- **Added — exact-money primitive (#FIN5).** `lib.money` server-side and `gina.money` in the browser bundle: ISO 4217 minor-unit integer arithmetic on BigInt, strict wire-string `parse()` that rejects float inputs, `add`/`subtract`/`multiply`/`compare` with same-currency guards, canonical `format()`. Display formatting stays with `Intl.NumberFormat`.
- **Added — idempotency keys (#FIN6).** Opt-in `Idempotency-Key` request deduplication at the router band, per the IETF draft: the recorded first response replays with `Idempotency-Replayed: true`, a duplicate in flight gets 409 + `Retry-After`, key reuse with a different payload gets 422. Principal-scoped, over a kv namespace you declare; dormant unless enabled.
- **Security — Inspector inline-script data can no longer be read as template source.** The shared inline-script helper now escapes `{` and `}` inside JSON string literals as well as `<`, so a stored value like `{{ 7*7 }}` renders literally instead of executing with the page's locals in scope. Values parse back identical; only pages emitting the Inspector block were reachable.
- **Fixed — the `query()` basic-auth option is honoured on HTTP/2 and can no longer leak (#B465).** `options.auth` is minted into `Authorization: Basic` before dispatch on BOTH transports and the option is deleted pre-dispatch. Previously node consumed it on HTTP/1.x only, while the HTTP/2 path forwarded it as a literal `auth:` header with authentication silently unperformed. A caller-supplied authorization header always wins.
- **Fixed — the client-side routing helper no longer swallows its own diagnostic (#B462).** A route missing from the running table now surfaces as a `console.warn` on the first sighting (the `gina.notFound` registry still dedups repeats), and the alternate-route arm records its registry entry so repeat counts accumulate.

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
