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

## What's in 0.6.15

> **Restart your bundles AND rebuild them.** This release changes the browser
> bundle: both `gina.min.js` and `gina.min.css` differ from `0.6.14`. A restart
> alone updates the server half only — each bundle bakes its own copy of the
> client assets, so `gina bundle:build` is required for the client-boot,
> link and popin fixes below to reach a browser at all.

> **No settings reset.** `0.6.15` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**A correctness pass over client boot, and two connector defects that could hang
a request.** The headline is a race that only a real deployment can lose: the
client routing table arrives by async fetch, but handlers were released before it
landed — so anything resolving a route during initialisation ran against an empty
table, deterministically, on every page load away from loopback. Alongside it,
the couchbase connector no longer hangs a request on an unparsed `COUNT`, and two
client plugins stop leaking their behaviour onto pages that never asked for it.
**Several behaviour changes are worth checking before you upgrade** — each is
called out in its bullet below, with the details in the
[migration guide](https://gina.io/docs/migration).

- **Fixed — client handlers now wait for the routing table (#B414, consumer-reported).** The client routing table arrives only by async fetch — the page deliberately whispers an empty stub rather than inlining it — yet `gina.ready` handlers and the auto-boot validator released at `DOMContentLoaded`. Anything calling `getRoute()`/`toUrl()` during handler or form-bind initialisation therefore ran against an empty table. Loopback wins that race by single-digit milliseconds, which is why development and local suites never see it; a real deployment loses it by 150ms or more on *every* load. A validator form rule naming a route then threw inside the init listener, the event dispatch swallowed the throw, and the instance's `ready` never fired — silently, with one uncorrelated console error as the only artefact. All three release paths now gate on the dependency *settling*: the ready-list scheduler, the validator auto-boot poll, and the late-registration path (a handler registered after `DOMContentLoaded` previously bypassed the scheduler and fired immediately). Settled deliberately means loaded **or** failed, so a broken endpoint still releases handlers rather than hanging the page, and a parse-time 5-second fallback force-settles with a console error in degenerate shapes where no fetch is ever issued. **Behaviour change:** on deployed tiers `gina.ready` handlers now fire when routing is actually available — typically 150ms–1.3s later than before; on loopback and in development the difference is single-digit milliseconds. Pages that do not use client routing are unaffected but for the timing.
- **Fixed — `getRoute()` reports a missing routing table instead of crashing (#B415).** The client `getRouting()` returns `null` by design when nothing matches — an empty table before the fetch lands, or a bundle with no rules — and the bare dereference of that `null` sat one line *above* the very diagnostic built for the degraded-table case, so the case it existed for was exactly the one it could never report. A named guard now throws `bundle X has no routing table for rule Y (client: routing config not loaded yet, or empty)`, on both the client and the server.
- **Fixed — a failed routing fetch now leaves console evidence (#B416).** The dependency bus fires on fetch failure as well as success — that is what keeps the page booting — but the listener discarded the error it carried. A genuinely failed fetch booted the framework permanently degraded, with an empty routing table and *zero* console output. The listener now reports the carried error and names the consequence: client `getRoute()`/`toUrl()` degraded until reload.
- **Fixed — a couchbase `COUNT` query can no longer hang the request (#B412, consumer-reported).** The `@return {number}` branch parsed the COUNT alias out of the query text and dereferenced the match unguarded, so `SELECT COUNT(DISTINCT a.b) AS n` — the pattern cannot span the space inside the parentheses — and an unaliased `SELECT COUNT(*)` both produced a null match and threw. The severity was not the throw but where it landed: inside the connector's own result callback, so no 5xx was ever produced, a promisified caller never settled, and the request hung until the client or proxy timed out — leaving one uncorrelated log line, and behind an HTTP/2 inter-bundle client the stall was then retried. It was dev-invisible too: the dev path strips only the first comment block, so a commented-out parsable COUNT elsewhere in the file kept the regex satisfied locally while production, which strips every comment, threw on the identical file. The branch now derives the count from the first projected column with no regex at all, guarded against empty result sets, empty rows and null payloads — exactly as mysql, postgresql, scylladb and sqlite already did, and as the documented contract already stated. **Behaviour change:** for a multi-column projection whose COUNT is not the first column, the returned value is now the first column rather than the aliased one — consistent with every other connector.
- **Fixed — couchbase annotation types are normalised and bounded (#B413).** Both the `@return` type and each `@param` type feed exact-match comparisons whose arms are all lowercase, so a capitalised or space-padded type such as `{Number}` or `{ number }` matched nothing and was silently skipped — handing the caller the raw row array instead of the declared shape, and leaving the parameter uncast. Both are now trimmed and lowercased at extraction, as the sibling connectors already did. Both captures were also greedy, so a second brace pair on the same line bled into the extracted type (`@param {a} and {b}` yielded `a} and {b`), matching no cast arm either; both are bounded to the first brace pair. **Behaviour change:** annotations that previously fell through silently now reach their branch, so a query declaring `@return {Number}` begins returning the declared shape rather than the raw row array. `@options` deliberately keeps its greedy capture — it holds a nestable object literal, not a single type token.
- **Fixed — the public link API names its error instead of throwing a bare TypeError (#B328).** Calling `gina.link.request(url)` — or a registered link's `.request(url)` with a foreign url — for a url no link is registered for dereferenced the null resolution. It now throws a named error identifying the url and the likely cause: never bound, or bound by a later construction the published instance cannot see. The miss is also detected *before* the supersede step, so a mistyped url no longer aborts a legitimate request still in flight. Click-driven links are unaffected — both click paths always resolve a real registration.
- **Fixed — the popin stylesheet no longer restyles every dialog on the page (#B329).** Its `::backdrop` rule (dark overlay + blur) shipped unscoped on the bare `dialog` element, so gina painted its backdrop on any `<dialog>` a page opened. It is now scoped to `dialog.gina-popin-container::backdrop`, matching the reduced-motion rules that were already scoped. **Consumer-visible:** a page that relied on the unscoped rule to style its own dialogs must style them itself now, and a popin dialog element supplied by the page's own markup needs the `gina-popin-container` class to keep gina's backdrop.
- **Changed — a changelog fragment must cite the tracker id its filename names (#B410).** Only the body is rendered into `CHANGELOG.md` and the published tarball, so an id carried by the filename and the commit message but missing from the body ships an unnumbered changelog entry — and anyone triaging by id gets a false zero. Measured across all 937 historical fragments, roughly 60 shipped entries are unnumbered this way; the guard stops the next one at commit time rather than at cut time. Recognised id families are an explicit allowlist rather than a generic letters-then-digits pattern, because the generic form false-positives on real filenames (`express5`, `npm12`, `s3`) and a false positive would block a commit; a filename encoding no recognised id is skipped, never failed.

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
