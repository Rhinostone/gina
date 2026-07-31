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

## What's in 0.6.1

> **Three behaviour changes to check before upgrading.** None refuses a boot,
> but each changes how an untouched bundle behaves. A JSON error payload rendered
> on a genuine HTTP/2 stream now carries its real status code instead of always
> being served as HTTP 200 — review any client that keyed off the old 200. A form
> declaring `data-gina-form-live-check-enabled="false"` now genuinely loses
> live-check everywhere, where two gates previously kept running. And an app that
> translated only the error keys it can observe will see those messages switch
> from English to its own language. See the
> [migration guide](https://gina.io/docs/migration) for each.

> **No settings reset.** `0.6.1` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

- **Security — the dev-mode Inspector no longer serves files outside its asset root.** A request to `/_gina/inspector/*` carrying a literal `../` escaped the Inspector's asset directory and read any file the bundle process could reach — application config and credentials included. The path helper the handler used *normalizes* `../` rather than rejecting it, so the traversal resolved rather than failing, and both engines were affected. Only bundles running in **dev mode** were ever exposed: production bundles do not serve this handler, and the URL-encoded `%2e%2e` form was never affected because the handler does not decode. A browser could not trigger it — browsers normalize `../` before the request is sent — but any raw HTTP client could. The resolved path is now confined to the Inspector asset root, and anything resolving outside it falls through to the same 404 as a missing file, matching the existing static-resolver guard. Nothing to do beyond upgrading. Worth reviewing while you are here: this endpoint carries no IP allowlist, unlike `/_gina/info` and `/_gina/cache/*`, and a dev bundle binds all interfaces by default — restricting dev hosts at the network layer is still worthwhile. Server-side — restart your bundles. (#B179)
- **Added — DuckDB connector.** Embedded **analytical** (columnar / OLAP) SQL over the standard entity wiring — the analytics-side sibling of the SQLite connector's embedded OLTP role. A `"connector": "duckdb"` entry opens a file-backed or `":memory:"` database (`file` is optional and defaults to `~/.gina/{version}/{database}.duckdb`), and entity methods load from `models/<database>/sql/` with the same `@param` casting and `@return` shaping as MySQL and PostgreSQL. Row-returning detection covers the analytical dialect — `WITH` CTEs, `FROM`-first, `SUMMARIZE`, `PIVOT`/`UNPIVOT`, `DESCRIBE`, `SHOW` — so CTE-heavy queries return rows instead of being routed to the write path, and Parquet / CSV / JSON files can be queried directly with no ETL hop. Large numeric types (BIGINT / HUGEINT / DECIMAL) and dates arrive as JSON-safe strings; writes report `{ changes }`. `readOnly: true` opens the database read-only so any number of processes can share one file. The `@duckdb/node-api` driver installs in your project, and the `connector:*` CLI group plus the connectors.json schema recognise the new type. Additive — nothing to change. Server-side — restart your bundles. (#CN11)
- **Added — SQLite works under the Bun runtime.** The SQLite ORM connector, the SQLite session store, the async-job store and the framework state store now resolve Bun's built-in `bun:sqlite` behind a `node:sqlite`-shaped adapter whenever `node:sqlite` is absent. Bun does not implement `node:sqlite`, so all four previously failed at boot under Bun — and the state store silently fell back to its JSON path. Nothing to install and no configuration change; transient/permanent connector-error classification reads both drivers identically. On Node.js nothing changes, since `node:sqlite` is still tried first. MongoDB remains unavailable under Bun — its `bson` dependency calls a `node:v8` API Bun does not implement, an upstream limitation with no framework-side fix.
- **Fixed — Bun: a bundle declaring any connector boots again.** Two Bun-only crashes stopped model loading outright. `new require(mod)(args)` parses as `(new require(mod))(args)`, and Bun's `require` has no constructor slot, so loading aborted with `function is not a constructor`; and the entity loader reassigned `arguments`, which Bun's parser rejects with `Invalid assignment target`. Both repairs are no-ops on Node by construction — the plain call is exactly what Node was already doing — so only Bun behaviour changes. The release smoke now boots a SQLite-backed bundle and round-trips a real query on every Node leg and on the Bun CI leg, so connector support is gated rather than assumed.
- **Fixed — reserved-name query files now warn instead of vanishing silently.** A query file whose name collides with an inherited prototype member — most commonly `count.sql`, shadowed by the framework's global `count()` helper — was silently skipped by the MySQL, PostgreSQL, SQLite, DuckDB, ScyllaDB and MongoDB connectors, and calls fell through to the inherited member, returning a plausible but unrelated value. The skip is now reported at startup with the file path and a rename hint (for example `countRows.sql`). Behaviour is unchanged — the file is still skipped — and a file matching a method your entity class itself defines still skips silently, by design: your code wins. A warning appearing on upgrade points at a query file that has never worked. Server-side — restart your bundles. (#B173)
- **Fixed — Couchbase warns when a query file overwrites or shadows an entity member.** The Couchbase connector attaches every N1QL query file unconditionally, so a file named after an existing member — a stamped entity property like `getCluster`, a previously attached query method, or an inherited member such as EventEmitter's `on` — silently overwrote or shadowed it. The clobber is now reported at startup with the file path and a rename hint (for example `onRows.sql`); shadowing the framework's global `count()`/`functionCount()` helpers stays silent, by design, since there the query file winning is the point. Attachment behaviour is unchanged — the warning never skips the file. Server-side — restart your bundles. (#B174)
- **Fixed — `renderJSON()`'s `status` key reaches the wire over HTTP/2.** The body path built its header frame with a hardcoded `:status: 200`, so every JSON error rendered on a genuine HTTP/2 stream was served as HTTP 200 with the error payload in the body; HTTP/1.1 was unaffected, and the HEAD branch and the HTML delegates already honoured the resolved code. The `errno` half of the status branch is also guarded like its swig and v1 siblings: an `errno`-only payload with no usable `status` used to poison the status code — the response was silently never sent on HTTP/1.1 and turned into a 500 on HTTP/2 — and is now served as a normal 200 with the payload in the body. **Review any HTTP/2 client that keyed off the old 200.** Server-side — restart your bundles. (#B172)
- **Fixed — a form submit no longer strands a sibling form's submit button.** FormValidator reused one shared `XMLHttpRequest` for every submit, and re-opening it replayed the previous submit's completion handler — visibly, submitting form B after form A had completed re-disabled A's submit button and re-stamped its `data-gina-form-loading`, with nothing ever releasing them (the lock was armed in four places and released in one). Every send now builds its own XHR, and a `loadend` listener releases the submit trigger and the loading flag on success, error, timeout and abort alike. Along the way `$form.isSending` now genuinely spans the request, where it used to be cleared almost immediately at the first readyState transition, and a timed-out form has its `data-gina-form-loading` removed instead of being left holding the truthy string `"false"`. Browser-bundled — re-bake your bundles. (#B175)
- **Fixed — the live-check opt-out is honored consistently.** A form declaring `data-gina-form-live-check-enabled="false"` with resolvable rules was only partly opted out: two validation gates evaluated the rules-count boolean inside the regex test, so the truthy string `"false"` short-circuited to that boolean and matched — leaving bind-time silent validation and select-change validation running. Text as-you-type was never affected, since the listener-registration gates already tested the attribute alone, so the pre-fix behaviour was an inconsistent middle rather than the attribute being ignored outright. The two gates now test the attribute alone and check the rules count separately, so an explicit `"false"` is honored everywhere — which is what the framework's own warnings have been advising all along. **An opted-out form genuinely loses those two checks now**; drop the attribute if you were relying on them. Browser-bundled — re-bake your bundles. (#B176)
- **Fixed — validator error labels: translating the key an app can observe now works.** Four rule families consult a different label key internally than the one an app sees in a field's `errors` object, so translating the observable key had no effect: the float coercion's NaN branch (`toFloat` fills `toFloatNAN`) and the number, integer and string length families (the generic `is<X>Length` fills the `Min`/`Max` variants). An app-supplied specific key still wins. Numbered `is` aliases (`is1`, `is2`, …) with no rule-supplied text now fall back to the shared `is` label instead of rendering an empty message, and catalog or `setErrorLabels()` translations for user-defined validator keys are no longer clobbered by the English default at setup. **An app that translated only observable keys will see those messages switch from English to its own language at pickup.** Browser-bundled — re-bake your bundles. (#B178)
- **Fixed — duplicate error messages and run-on screen-reader announcements.** Screen-reader announcements now join multiple rule messages with a sentence separator instead of running them together as one string — the visible stacked layout is unchanged — and two rules carrying byte-identical resolved message text render once instead of twice, so a coercion paired with its validator no longer shows the same sentence duplicated. The dev inspector still records every error key. Browser-bundled — re-bake your bundles. (#B178)

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
