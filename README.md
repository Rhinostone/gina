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
gina start
gina bundle:start api @myproject
open http://localhost:3100
```

> **npm 12+** blocks install scripts by default, and gina's post-install bootstraps `~/.gina` and the framework dependencies. Install with `npm install -g gina@latest --allow-scripts=gina`, or allow it once for all global installs with `npm config set allow-scripts=gina --location=user`. (Not needed on npm ≤ 11.)

## What's in 0.7.5

> **Restart your bundles *and* rebuild them.** The form validator, the routing
> library's `getRoute()`, `Collection` and the request-data parser are
> browser-bundled, so `gina.min.js` changed and `gina bundle:restart` alone leaves
> the old client running: rebuild each consuming bundle, then restart it. If your
> build copies `gina.min.js` into your own static files, rebuild that copy before
> the restart. A framework already running picks up the CLI fixes after
> `gina framework:restart`.

> **Read before upgrading — some changes can change an answer.** A Couchbase entry
> of `connectors.json` without a `scope` now gives its entities the bundle's
> `NODE_SCOPE`, so the documents it inserted with `_scope: "_default"` stop
> matching: stamp them with the environment's scope, or set `"scope": "_default"`
> on the entry. Data stored through a SQLite or DuckDB entry that names neither
> `file` nor `database` is in `undefined.sqlite` or `undefined.duckdb` in the gina
> home: set the entry's `file` to it before upgrading (such a DuckDB entry now stops
> the boot). A bundle that sets `swig.useProject: true` now renders with the
> project's own `@rhinostone/swig`, a `swig.package` frontend the bundle cannot load
> stops it at startup, and a grouped expression renders the value of its group
> (`{{ (1 + 2) * 3 }}` gave 7). On a rule with several URLs, `getRoute()` and the
> `getUrl` filters compose the URL the values complete (`urlIndex` 0 keeps the
> first), and a key both in a `self.query()` path and in its data keeps the path's
> value. Bracket keys that mix indexes and names now give an object, an unticked
> optional boolean checkbox posts `false`, and a required checkbox that carries a
> value must be ticked. The [migration notes](https://gina.io/docs/migration) list
> every behaviour change.

**The forms-and-containers release.** Three security fixes, two of them on the
template-path advisory GHSA-3vmh-634f-vwm3 published with 0.7.4: a query or body
value could replace a URL segment in a route's template path after the segment had
passed the route's `requirements` (the residual the advisory stated), and the router
let an escaping value into `param.path` and `param.namespace` before its
path-traversal check (the renderers still refused it). Gina also requires
`@rhinostone/swig` `^2.8.3`, which escapes a template's filename in the code it
compiles (GHSA-q89c-947c-m7xr). Sixty-one fixes follow: nineteen in the form
validator, `getRoute()`'s URL choice and query string, how `self.query()` and
`forward` send their data, the container launchers and the `~/.gina` files, the
connectors' scope and model directories, and swig's grouped expressions and project
frontends. On native Windows, gina now stops with one message: run it inside WSL2 or
a Docker container. Full detail in [CHANGELOG.md](./CHANGELOG.md).

- **Security — a route's template path keeps its URL value (#B877, #B883).** A placeholder of `param.file` that is a URL segment takes the URL value, and the router refuses a `param.path` or `param.namespace` value holding a `..` segment or starting with a separator. A redirect route that takes `param.path` from a query value starting with `/` is refused, also when the key has a requirement.
- **Security — swig escapes a template's filename (#B942).** Up to 2.8.2, swig wrote the including template's filename into the compiled template without escaping it. Gina requires `^2.8.3` in both manifests; a project copy loaded through `swig.useProject` keeps its own version, so update it there.
- **Changed — `getRoute()` composes the URL the values complete (#B374), and the path's value wins in `self.query()` (#B945).** Without `urlIndex`, a rule with several URLs composes a URL whose placeholders all receive a value, preferring the one that uses the most of them; a forward route's static `param` reaches its target as written.
- **Fixed — the form validator (#B879, #B880, #B802, #B881, #B884, #B885, #B913, #B886, #B914, #B915, #B916, #B918, #B919, #B920, #B921, #B923, #B926, #B929, #B931).** A `_case_` condition is matched against its own driving field, reads a `/pattern/` case and a regular-expression rule key wherever its block sits, stops applying when it no longer holds, refuses a group it makes required from the first submit, and its targets are live-checked. A required checkbox that carries a value must be ticked; an optional boolean one posts `false`. A field follows only the masters whose whole ids its `data-gina-form-element-group` lists, regular-expression characters included. Each bound form holds its own copy of its rule set. `reBind()` keeps the rule set `data-gina-form-rule` names and uses the rules you pass, `unbind()` works with no argument, `tel`, `url`, `search`, `time`, `datetime-local`, `month` and `week` inputs are live-checked, and a `<select>` change re-checks the form with its own rules.
- **Fixed — `query` rules and `self.query()` (#B951, #B950, #B945, #B952).** A browser `query` rule on GET (the default), HEAD or DELETE sends its data in the URL; a rule aimed at its own bundle works under `gina-container` without a `proxy` entry for it; `self.query()` and `forward` send the data of a GET, HEAD or DELETE once, in the query string, and the data of a PATCH as a JSON body.
- **Fixed — `getRoute()` (#B374, #B220, #B943, #B944, #B946).** It composes the URL `urlIndex` names and refuses an index that names none, appends a value bound only to another URL as a query parameter, repeats no value, and keeps a value holding a comma whole.
- **Fixed — request data (#B596, #B936, #B594).** Bracket keys that mix indexes and names nest to one object, whatever their order; a top-level JSON array document is parsed into its elements.
- **Fixed — containers and the `~/.gina` files (#K8s7, #B895, #B892, #B934, #B928, #B891, #B938, #B687, #B857, #B852, #B890, #B906, #B905).** `gina-container` reads `GINA_HOMEDIR`, names a missing `manifest.json`, and accepts a comment or a trailing comma in the files it reads, as every reader of `manifest.json` and `main.json` now does; `gina-init` no longer dials the MQ port; state and pid files are written whole, and a process that creates the run directory is registered; a project or `~/.gina` file that cannot be used is refused in one line instead of stopping the framework; a failed `node_modules` link no longer reads as a successful start.
- **Fixed — connectors (#B893, #B900, #B894, #B901, #B907, #B909, #B911).** A Couchbase entry without `scope` uses `NODE_SCOPE`, as documented, and one named differently from its bucket no longer stops the boot; an entry keyed by its connector type loads without `connector`; model directories follow the entry's `database` or `keyspace`, with no `models/undefined/` and no `undefined.sqlite`; a DuckDB entry that names neither `file` nor `database` stops the boot.
- **Fixed — swig (#B940, #B932, #B925, #B924).** A grouped expression renders the value of its group (swig 2.8.2 and later); `swig.useProject` and `swig.package` take effect in a running bundle, and a frontend that cannot load stops it with `SWIG_PACKAGE_UNAVAILABLE`; the settings schema lists every frontend.
- **Fixed — platform and CLI (#B888, #B889, #B363, #B927, #B902, #B903, #B917, #B823, #B824).** Native Windows stops with one message pointing to WSL2 or Docker; the "not started" hint no longer asks for `sudo`; `project:add` leaves an existing `package.json` as it is; the helpers load in a fixed order under Bun; the `onInitialize` sample that `bundle:add` writes works in a bundle named `event`, `app` or `express`; the https credentials error is spelled correctly; a `requireJSON()` parse error quotes the file around the error; a `Collection` filter on one field of an array of objects finds its rows, and `setSearchOption()` refuses a per-field `skipEval`.

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
| [gina-starter](https://github.com/gina-io/gina-starter) | Minimal starter project — one bundle, one route, a dev container |

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
