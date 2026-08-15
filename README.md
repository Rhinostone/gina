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

## What's in 0.6.8

> **Restart your bundles — no re-bake this time.** The browser bundle is
> byte-identical to `0.6.7`, so `gina bundle:restart` is enough; everything below
> is server-side. (`0.6.7` did need the rebuild — this one does not.)

> **No settings reset.** `0.6.8` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**This release fixes two security flaws, and both were live in every published
version up to and including `0.6.7`.** One of them changes behaviour you may be
relying on: `self.push()` no longer lets the request choose who receives a push,
which stops a pattern some applications use to report background-job progress.
Read that entry before upgrading. Both are covered in the
[migration guide](https://gina.io/docs/migration).

- **Security — `self.push()` decides its own recipient.** The recipient was read from the request body, so a caller could aim a push at any session by sending a session id — and omitting that id broadcast to *every* connected client. The payload defaults to request input too, so on any route reaching `push()` an unprivileged caller could deliver arbitrary content to everyone, or to a chosen victim. The recipient is now decided server-side: an explicit `option.sessionID` wins, otherwise the caller's own session; with neither a resolvable session nor a deliberate `{ broadcast: true }`, `push()` sends nothing and warns, where it previously fell open to everybody. The request body can no longer influence the recipient at all. **Action required if you push at all:** a bare `self.push()` driven over an HTTP hop by a background worker — a job runner reporting progress to the user who queued it, threading that user's session id through the request — now resolves to the caller's own session and stops delivering. That pattern *is* the vulnerability, so it cannot be preserved; but be aware there is no in-process substitute yet, because `push()` is reachable only from a live request-bound controller. Until an explicit out-of-request channel exists, poll `GET /_gina/jobs/:id` or use a transport your application owns. In-request callers are unaffected unless they relied on the implicit fan-out, which now needs `{ broadcast: true }`.
- **Security — forwarded headers can no longer inject script.** `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix` and the request's own `Host` were spliced unescaped into the client bootstrap script gina emits on every rendered page, landing inside JavaScript string literals. A header containing a single quote closed the literal and ran attacker-chosen script in the browser of anyone served that page — no authentication, any route that renders a view. Forwarded values are now validated where they are read: a host must be a hostname with an optional port or a bracketed IPv6 literal, a scheme must be exactly `http` or `https`, and a path prefix must be URL-path characters only. Anything else is refused and the request falls back to the bundle's own configured host and webroot, exactly as if the header had never been sent. Whether you were reachable depended on your proxy — one that sets or strips the `X-Forwarded-*` headers it forwards never passed an injected value through, while a bundle exposed directly, or behind a proxy relaying client headers verbatim, could be driven by any anonymous caller. No action beyond upgrading; a well-formed host, scheme and prefix behave identically.
- **Added — storage metadata on Couchbase, which makes a driver root shareable.** The embedded SQLite store is single-process-per-root, so two bundles — or two replicas of one — could not share a root until now. Point a driver's `store` at a `connectors.json` entry whose connector is `couchbase` and every metadata row, inline payloads included, lives on the cluster. Per-key atomicity comes from Couchbase's own CAS, so `cas` reference counting behaves exactly as on the embedded store, and the GC sweep needs no election layer when several replicas run it at once — the claim step is itself compare-and-set, so each blob is collected exactly once. Rows are namespaced by driver name. The two secondary indexes the maintenance verbs need are created at boot when missing; if the account may not create them the boot still succeeds and the exact `CREATE INDEX` statements are logged. Inline payloads are base64-encoded inside the document, which costs about a third more space and puts a practical ceiling near a 14MB `inlineThreshold`.
- **Added — a `stream` strategy for large sequential media, with resumable uploads.** Keys name an *asset* rather than a file (`assets/<ulid>/original<ext>`), so an object and anything later derived from it live in one directory you can move or delete as a unit. Alongside `put()`, a stream driver carries `createUpload()`, `writeSegment()` (at a byte offset — segments may arrive out of order and in parallel, and re-sending a landed range is harmless), `statUpload()` (which reports what is still *missing*), `finalize()` and `abortUpload()`. Sessions survive a restart. `createUpload()` requires the object's total size deliberately: without it nothing can verify the received ranges actually cover the object. Finalise checks coverage as an interval union and refuses to publish a gap — an unwritten range reads back as zeros rather than failing, so a finalise that merely summed what it received could publish a plausible object with silently wrong bytes. Finalise is idempotent. New optional per-driver keys: `chunkSize` (default `"8MB"`), `sessionTtl` (`"24h"`) and `sessionSweepInterval` (`"1h"`).
- **Added — HTTP Range serving for stored objects.** `self.serveFromStorage(driverName, key[, opts])` is the read-side companion of `store()`'s driver routing, and owns the whole protocol dance on both engines: `stat()`-gated 404s, a strong ETag minted from the immutable storage key, conditional GET answering 304 with no driver read, and single-range `bytes=` evaluation — a satisfiable range answers 206 with an exact `Content-Length`, an unsatisfiable one 416, and multi-range lists, foreign units and syntactic garbage fall back to the full 200 as RFC 9110 sanctions. Every response carries `X-Content-Type-Options: nosniff`, and a stored `contentType` for active-content types (html/xml/svg/javascript) downgrades to `application/octet-stream` unless you pass an explicit `opts.contentType`. `opts.download`/`opts.filename` emit an RFC 6266 attachment disposition.
- **Added — the `s3` storage adapter, completing the pluggable object-storage layer.** `adapter: 's3'` plus a `bucket` stores objects on any S3-compatible provider (AWS S3, Scaleway, MinIO, R2…) under the sharded key grammar. Storeless by design: the provider carries each object's metadata on the object itself, so there is no metadata store, no tiering and no drift class to verify. The SDK stays your project's dependency — install `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` and `@aws-sdk/s3-request-presigner`; a configured s3 driver whose SDK is missing refuses the boot with that hint. `resolve()` answers `{kind: 'url'}` with a presigned GET, and `capabilities.offload` flips true for the first time: `serveFromStorage()` answers GET/HEAD with a 307 to the presigned URL — after the local 304 check, with the content-type downgrade riding the signed `response-content-type` so the stored-XSS guard holds when the provider serves the bytes. `opts.offload: false` keeps the in-process proxy path. Static credentials are optional; omitted, the SDK's default provider chain runs.
- **Added — storage drivers can read a byte range.** `getRange(key, start, end, cb)` ships on every local strategy (`sharded`, `cas`, `stream`), returning a readable stream over the requested slice.
- **Added — machine-readable storage read errors.** Read-verb failures now carry `err.code` — `STORAGE_NO_OBJECT` for an unknown, released or vanished key, and siblings for the other classes — so callers can branch on the cause instead of matching message text.
- **Added — Couchbase soak probes ship in the package.** The soak probes for the Couchbase metadata store live at `script/soak/storage/`, so you can exercise a cluster-backed driver root against your own deployment rather than trusting ours.
- **Changed — `renderStream()` is byte-serving-capable.** On non-SSE content types, `Buffer` chunks now pass through verbatim instead of being UTF-8-decoded — binary payloads previously arrived corrupted, with every invalid-UTF-8 byte replaced by U+FFFD. Valid-UTF-8 buffers re-encode byte-identically, so text consumers are unaffected, and SSE keeps its decode. HEAD requests answer headers-only without consuming the iterable (a destroyable source is destroyed rather than leaking its handle), and the delegate's default headers now yield to values the caller pre-set instead of clobbering them.
- **Fixed — `renderStream()` honours a caller-set status code on both engines.** The HTTP/2 arm built its response headers before the caller's status was read, so a streamed 206 or 404 went out as 200.
- **Fixed — `renderStream()` no longer throws a swallowed `TypeError` at the end of every streamed response.** The post-end `headersSent` bookkeeping ran against a response object that no longer accepted it.
- **Fixed — a redirect no longer treats `HEAD` as a wrong method.** `HEAD` is a safe method — `GET` without a response body — but the redirect path rejected it as if it were a write.
- **Fixed — a redirect keeps the caller's query string under `keep-params: true`.** The declared parameters were carried but the query string was dropped.
- **Fixed — a `sharded` driver reclaims temp files left by a crashed `put()`.** A `put()` whose *process* died left its temp file behind to accumulate forever; an age-gated best-effort sweep now clears them.
- **Fixed — a refused or interrupted `put()` leaves no temp residue.** The stray temp file a rejected write left in a local storage root is now removed on the failure path.
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
