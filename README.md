# Gina

[![npm version](https://img.shields.io/npm/v/gina)](https://www.npmjs.com/package/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket](https://img.shields.io/badge/Socket-view%20analysis-blue)](https://socket.dev/npm/package/gina) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/gina-io/gina/badge)](https://scorecard.dev/viewer/?uri=github.com/gina-io/gina) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Bun >= 1.2](https://img.shields.io/badge/Bun-%3E%3D%201.2-brightgreen)](https://bun.sh) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Documentation:** [gina.io/docs](https://gina.io/docs/) · **Issues:** [GitHub](https://github.com/gina-io/gina/issues) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md) · **Security:** [SECURITY.md](./SECURITY.md)

MVC framework for Node.js and Bun with built-in HTTP/2, multi-bundle architecture, and scope-based data isolation — no Express dependency.

- **HTTP/2 first.** Built-in `isaac` server with TLS, h2c, ALPN, HTTP/1.1 fallback, and full CVE hardening (Rapid Reset, CONTINUATION flood, RST flood, HPACK bomb) — all on by default.
- **Multi-bundle.** One project hosts multiple independent bundles (API, web, admin, …). Each bundle has its own routing, controllers, models, and config. Share code via the project layer.
- **Scope isolation.** Run `local`, `beta`, and `production` from the same codebase. Scopes propagate through routing, config interpolation, and data (every DB record is stamped with `_scope`).
- **Batteries included.** Forms & validation, sessions, uploads, async jobs, response caching, CSRF, security headers, route authorization, audit trail, i18n, OpenAPI + MCP generation — built in, not bolted on.

## Features

| Feature | Detail |
| --- | --- |
| HTTP/2 server | Built-in `isaac` engine — TLS, h2c, ALPN, HTTP/1.1 fallback, 103 Early Hints, RFC 9218 request priorities, CVE-hardened |
| Multi-bundle | One project, N independent bundles with shared config and project layer |
| Scope isolation | `local` / `beta` / `production` — per-request and per-record |
| MVC routing | `routing.json` — declare routes in config, not code; an index built once per routing table narrows each cold match to the rules the URL could reach, and a hot path is served from the route cache |
| Fast lane | Opt-in JSON routes without a controller — `param.lane` names a handler module under `lanes/` that answers with `ctx.json()` / `ctx.error()`; the request id, CORS, the bundle's session and CSRF middleware, the metrics and the error envelope stay as on any route |
| Async/await | Controller actions can be `async`; rejections routed to `throwError` automatically |
| WebSockets | WS routes in `routing.json` (`"method": "ws"` + channel handlers, `:param` paths); WebSocket-over-HTTP/2 (RFC 8441) |
| ORM / entities | EventEmitter-based entity system; SQL files auto-wired to entity methods |
| Connectors | Couchbase, MongoDB, ScyllaDB / Cassandra, MySQL, PostgreSQL, Redis, SQLite, AI (LLM) — loaded from project `node_modules` |
| AI connector | Any LLM provider via named protocol (`anthropic://`, `openai://`, `ollama://`, …) — unified `.infer()`, token streaming via `.stream()`, inference-as-a-job via `self.inferAsync()` |
| Template engine | [`@rhinostone/swig`](https://github.com/gina-io/swig) — maintained fork with CVE-2023-25345 patched; streaming SSE/chunked via `renderStream()`. Nunjucks supported as opt-in via `render.engine = "nunjucks"` or per-section `"ext": ".njk"` |
| Forms & validation | One rule engine for client and server — live checks, cross-field rules, ARIA states, localised messages; the server enforces the same rules on submit. A form can swap its HTML answer into any element of the page, htmx-style (`data-gina-form-target` / `-swap` / `-select`), and update elements elsewhere out of band (`data-gina-swap-oob`); the server can retarget, reswap or reselect that answer with `X-Gina-Retarget` / `-Reswap` / `-Reselect` response headers. Two answers replacing the same region coordinate on their own — derived from the swap strategy, with no attribute to write — and `data-gina-form-sync` overrides that where it is wrong, while `data-gina-form-disabled-elt` holds controls disabled for the life of a request |
| DTOs | `gina.dto` schema builder — request validation with localised 422s (`param.dto`), response shaping (`param.responseDto`), JSON Schema export |
| Sessions | Hardened session plugin (SameSite / HttpOnly / Secure defaults) — Redis, SQLite, MongoDB, Couchbase, and ScyllaDB stores; session-id rotation on login, per-bundle login and remember-me cookie lifetimes from `security.json`, opt-in absolute timeout, record destroyed on logout |
| File uploads | Multipart via the maintained [`@rhinostone/busboy`](https://github.com/gina-io/busboy) fork — named upload groups with per-group extension allow-lists, size / count limits, and target dirs |
| Object storage | `gina.storage()` — named drivers pairing an adapter (`local` filesystem, or `s3` for any S3-compatible provider with its SDK as a project-side dependency) with a key strategy behind opaque keys: `sharded` (dated), `cas` (content-addressed, deduplicating, refcounted, GC-swept) and `stream` (large media, resumable out-of-order segment uploads); size tiering, HTTP Range serving (`serveFromStorage()` — 206/416/304, strong key ETags), presigned-URL offload (307) on `s3`, embedded SQLite or Couchbase metadata store, `storage:stats` / `gc` / `verify` CLI |
| Async jobs | `self.startJob()` background jobs — durable SQLite / MongoDB / Redis stores, retries with backoff, HMAC-signed completion webhooks, `/_gina/jobs/:id` status endpoint |
| Response caching | Per-route render cache — memory / fs / Redis tiers, cross-replica warm start, event-driven invalidation, RFC 9211 `Cache-Status` |
| Authentication | `lib.authn` primitives — scrypt password hashing as self-describing PHC strings (argon2 / bcrypt verify-only for migration), NIST SP 800-63B policy, enumeration-safe `dummyVerify`, PCI-DSS account lockout, RFC 6238 TOTP |
| Route authorization | `requireAuth` / `roles` / `policy` per route or deny-by-default, login bounce with `resumeRequest()`, `self.hasRole()` |
| Rate limiting | Opt-in identified-caller quotas at the router (#MS6) — fixed-window counters over the KV primitive (per-process, or replica-shared via redis/sqlite), per-route overrides/exemptions, 429 + `Retry-After` + draft `RateLimit` header fields; anonymous flood control stays at your edge by design |
| Maintenance mode | Opt-in `server.maintenance` (#MAINT1) — every request answered 503 + `Retry-After` before statics, cache and routing while `/_gina/*` stays reachable; topology-neutral bypass (`x-gina-maintenance-key` header, or a one-shot query grant minted into a signed cookie) plus a non-proxied IP allowlist; runtime toggle `POST /_gina/maintenance` with a dead-man `ttlSeconds`, `GINA_MAINTENANCE` to boot closed, and replica coherence through a shared KV namespace (`store`) |
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
| Runtime | Node.js 22–26, or **Bun** (`bun add -g gina`) — install + boot validated end-to-end by a CI Bun smoke, and the unit suite runs under `bun test` in CI behind an expected-failures gate |

## Quick start

```bash
npm install -g gina@latest --prefix=~/.npm-global   # or, on the Bun runtime: bun add -g gina
gina project:add @myproject --path=$(pwd)/myproject
gina bundle:add api @myproject
gina bundle:start api @myproject
open https://localhost:3100
```

> **npm 12+** blocks install scripts by default, and gina's post-install bootstraps `~/.gina` and the framework dependencies. Install with `npm install -g gina@latest --allow-scripts=gina`, or allow it once for all global installs with `npm config set allow-scripts=gina --location=user`. (Not needed on npm ≤ 11.)

## What's in 0.7.4

> **Restart your bundles *and* rebuild them.** The form validator, the staged
> upload widget, the popin plugin, the `<select>` live check and the routing
> library's placeholder fill are browser-bundled, so `gina.min.js` changed and
> `gina bundle:restart` alone leaves the old client running: rebuild each
> consuming bundle, then restart it. If your build copies `gina.min.js` into your
> own static files, rebuild that copy before the restart.

> **Read before upgrading — some changes can change an answer.** A page template
> whose path resolves outside the section's template root (`templates.json > html`,
> `templates/html` by default) now answers 500 — a bundle that renders templates
> kept outside it widens that root — and a route placeholder filled from the
> request with a value that would escape as a path component is refused. A route's
> `cache` field sets `Cache-Control` only while `server.cache.enable` is on and the
> request is a GET. `gina bundle:start`, `bundle:restart`, `framework:restart` and
> `gina start --inspect-gina` now exit non-zero when they did not do what they say,
> and a bundle that cannot bind its port exits 1. A `settings.<env>.json` file is
> applied for the first time, and the six render-cache switches in the top-level
> `cache` block of `settings.json` are deprecated there, with a boot warning. The
> [migration notes](https://gina.io/docs/migration) list every behaviour change.

**The request-isolation release.** Nine security fixes, two of them with an
advisory: a template path taken from the request could leave the template root,
through the router's placeholder fill or a controller's `setTemplate()`, and read
any `.html` file the process can read. Under concurrency, a route middleware, the
engine's error responder, the context-bearing template filters and an async job
could answer or render with another request's context. One unauthenticated GET
could stop a bundle through a bracket field nested in a `null` slot — the whole
request-data parse, the multipart listeners included, is now guarded. A request
value could forge a log line, a resolved secret could reach the log unmasked, and
a `__proto__` query field could change `req.delete`'s prototype. Forty-seven fixes
follow: the CLI's exit codes and pid files, `Collection`, the staged upload
widget, the renderers and the validator. Full detail in
[CHANGELOG.md](./CHANGELOG.md).

- **Security — a request-fed template path stays inside the template root (#B833, #B867).** The router refuses a placeholder value that would escape as a path component, and both renderers answer 500 for a page path outside the section's `html` root. Two advisories.
- **Security — no request answers with another request's context (#B807, #B806, #B519, #B811).** The controller methods a route middleware gets, the engine-level error responder and the `getUrl`/`getWebroot`/`t`/`tIcu` filters each read a process-wide slot that the last request overwrote; each is now bound to its own request, and an async job runs with no render context.
- **Security — one request can no longer stop a bundle (#B792, #B793, #B843).** A bracket field nested in a `null` slot threw in the parser and a GET exited the bundle; the parse of every request's data, and the multipart listeners, now answer 500 instead.
- **Security — logs (#B830, #B834, #B838).** A request value can no longer start a log line of its own (CWE-117); a resolved secret is masked whichever writer renders it, quotes and escapes included (CWE-532).
- **Security — `req.delete` keeps its prototype (#B848).** A `__proto__` query field re-pointed it on the default engine. Related: a request field named `hasOwnProperty` reaches the action (#B837), a logged object can no longer make a log call throw (#B832), and `req.delete` is a plain object with Express 4's `simple` query parser (#B847).
- **Changed — `Cache-Control` follows the server cache switch (#B744)**, and the top-level `cache` keys the render cache never read are deprecated with a boot warning. The SQLite driver takes Node.js 26.11's `Database` class name (#B829).
- **Fixed — the CLI says what it did (#B851, #B853, #B854, #B855, #B856, #B850, #B763, #B764, #B780, #B782, #B779).** `bundle:start` exits by outcome and a bundle that cannot bind its port exits 1; `bundle:restart` exits 1 when the bundle did not restart; a second start keeps the running bundle's pid file; a refused start no longer stops the framework; `project:start` leaves the framework's records alone; a worker child no longer takes over its bundle's pid file; `framework:status` and `gina stop` find a framework running on Bun, and `gina stop` signals only the pid it read and keeps other versions' pid files; `--inspect-gina` and `framework:restart` return the real exit code; `image:run` leaves the container name to podman.
- **Fixed — `Collection` (#B517, #B818, #B819, #B820, #B821, #B822, #B826, #B827).** `filter(fn)` filters; a search option matches the value as text, works on every search and in its object form; a dotted key holding a pattern character matches nothing instead of throwing; `update()` writes each row back in its own place; `delete()` and `notIn()` remove the rows they found; `find()` lists a row once.
- **Fixed — the staged upload widget (#B858, #B859, #B860, #B861, #B862, #B791).** After a reset the next selection is posted; a reset or a delete reaches a file shown without an image, every file of a multi-file input, a custom preview container and a custom prefix; a replaced file's preview metadata is no longer re-posted.
- **Fixed — renderers and routing (#B516, #B808, #B825, #B688, #B842, #B783, #B794, #B518, #B812).** `getUrl` degrades with no request; a custom async swig loader renders again and sees `setup.js` registrations; a `:placeholder` in `param.path`, `param.title` or `param.namespace` is written verbatim; an error page whose dispatch fails answers the built-in page instead of overflowing the stack; a `throwError()` fallback answers an XHR request; `redirect()` to a dot-less host works; `throwError(err)` keeps `message` and `ref`; a rejecting async middleware answers 500.
- **Fixed — settings and cache (#B784, #B785).** `settings.<env>.json` is applied, and the `fs` cache reads its entries back from a custom `server.cache.path`.
- **Fixed — client (#B585, #B781, #B876).** `reBind()` no longer stacks the validator's listeners and `destroy()` removes them; a `<select>`'s live check shows the whole-form error; a popin trigger no longer loads the popin twice on a page with several popin instances.

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
