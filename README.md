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
| Sessions | Hardened session plugin (SameSite / HttpOnly / Secure defaults) — Redis, SQLite, MongoDB, Couchbase, and ScyllaDB stores |
| File uploads | Multipart via the maintained [`@rhinostone/busboy`](https://github.com/gina-io/busboy) fork — named upload groups with per-group extension allow-lists, size / count limits, and target dirs |
| Async jobs | `self.startJob()` background jobs — durable SQLite / MongoDB / Redis stores, retries with backoff, HMAC-signed completion webhooks, `/_gina/jobs/:id` status endpoint |
| Response caching | Per-route render cache — memory / fs / Redis tiers, cross-replica warm start, event-driven invalidation, RFC 9211 `Cache-Status` |
| Route authorization | `requireAuth` / `roles` / `policy` per route, login bounce with `resumeRequest()`, `self.hasRole()` |
| Audit trail | Opt-in append-only JSONL audit log (`self.audit()`), authorization denials auto-recorded, always-on request ids |
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

## What's in 0.5.25

- **Added — machine-caller authentication for app routes.** A request presenting `Authorization: Bearer <key>` matching a caller named in `settings.json > auth.machine.callers` now passes the route authorization gate without a session: it satisfies `param.requireAuth`, its configured roles match route `roles` exactly like a session user's, and route policies receive it as `{ name, roles, machine: true }`. A session still wins when both are present. Strictly opt-in and fail-closed — `auth.machine.enabled` defaults false and the boot lint refuses every malformed shape rather than silently running open. Keys accept `${secret:KEY}` placeholders and are compared in constant time against sha256 hashes computed at boot, so raw keys are not retained; a presented-but-invalid key gets a clean `401` with `WWW-Authenticate: Bearer` and never the login redirect. Audit records carry the caller name as the actor plus `machine: true`, and `self.hasRole()` answers the caller's roles. An optional `auth.machine.authenticator` hook verifies any other sync-checkable credential (a JWT signature, an HMAC header, an `x-api-key` scheme). Server-side — restart your bundles. (MS3)
- **Added — cross-service request-id propagation.** The always-on request id is now forwarded as `x-request-id` on every outbound `self.query()` call — the file-download proxy path and both the HTTP/1 and HTTP/2 inter-bundle client paths — so one logical request stays correlatable as it fans out across bundles. A caller that sets `x-request-id` explicitly is never overwritten, and only the sanitised resolved id is forwarded (never a raw inbound header). The server also echoes `X-Request-Id` back on every response on both engines, so a caller, load balancer or APM can read the id off the wire. Server-side — restart your bundles. (MS1)
- **Added — `GET /_gina/health/check` on the default (express) engine**, mirroring the isaac engine's existing liveness endpoint. It returns `200` with `{"status":"healthy","timestamp":<ISO>}` and is deliberately ungated — no admin allowlist, no dev gate — so container liveness probes reach it off-loopback. Previously only isaac served it, so express bundles had no ungated liveness target and had to switch engines just to satisfy a Docker or Kubernetes healthcheck. Server-side — restart your bundles. (MS2)
- **Added — the authorization contract in `bundle:openapi`.** Gated routes (`param.requireAuth` / `param.roles` / `param.policy`) now emit a `401` response entry, plus a `403` when roles or a policy add authorization beyond authentication, and a bundle with machine-caller auth configured gains `components.securitySchemes.bearerAuth` (`http`/`bearer`) with a per-operation `security` requirement on gated routes. Role and policy names are never emitted into the spec, and an un-gated, un-configured bundle's spec is byte-unchanged. (MS4)
- **Added — the `controller:` CLI group.** `controller:add` scaffolds a namespace controller with one JSDoc'd action stub per `--controls` entry, auto-detecting the bundle flavor (a view bundle gets `self.render()` stubs plus a template per action; an API bundle gets `self.renderJSON()` stubs), and prints the paste-ready `routing.json` rules rather than editing your routing. `controller:remove` (alias `controller:rm`) deletes one only after a reference-aware scan of `routing.json` and every `requireController()` call — because a routing rule naming a namespace with no controller file silently falls back to the default controller instead of erroring, a bare delete is unsafe, so it refuses and lists the blockers. `controller:rename` renames in place and rewrites the references it can do safely, reporting anything a static rewrite cannot resolve rather than guessing. All three support `--dry-run` and `--format=json`; remove and rename confirm interactively and support `--force`. Offline CLI — no bundle rebuild. (#R9)
- **Added — transient-vs-permanent classification for datastore connector errors.** When a connector query fails, the error reaching your controller now carries `err.isTransient` (true when a retry after backoff can succeed — a datastore timeout, a dropped connection, a node warming up after a restart, rebalance or failover) and `err.transientReason`, a normalized token naming the condition (`socket:econnrefused`, `postgres:serialization-failure`, `mongo:transient-transaction`, `couchbase:timeout`, …). A controller can branch on it to render an honest "temporarily unavailable, please retry" instead of a generic 500 for a condition that clears itself in seconds — without hand-rolling a vendor-error classifier. It normalizes signals every driver already carries (socket errno, driver codes and class names, ANSI SQLSTATE classes, MongoDB error labels, Couchbase N1QL cause codes) across all six datastore connectors, and is deliberately conservative: an unrecognized error, or a genuinely permanent one such as a DNS misconfiguration or a duplicate key, classifies as permanent. Purely additive — it sets only those two fields and never throws. Server-side — restart your bundles. (#CE1)
- **Added — `settings.swig.autoescape`** (boolean, default false) to opt in to HTML-escaping of Swig `{{ variable }}` output as an XSS defense, mirroring the existing `settings.nunjucks.autoescape`. Swig's escaping default is unchanged in this release — set the flag per bundle to enable it. A non-boolean value now refuses bundle startup, so the security toggle can never be silently mis-typed.
- **Added — `server.proxy.requireForwardedHeaders`** (opt-in, declared in the published schema): when true, a request is classified as reverse-proxied only when it carries an `X-Forwarded-Host` header, disabling the port-less-Host heuristic so internal service-DNS calls can never rewrite the worker's proxy-host context. This is the deterministic option for deployments whose front proxy always sends `X-Forwarded-Host`, and the only mechanism that also protects renders with no request of their own (worker- or cron-driven rendering). Defaults to false — the historical heuristic is unchanged.
- **Added — a `processing` state on the staged upload progress indicator.** `data-gina-upload-progress-state` is stamped `processing` the moment the browser finishes sending the bytes — the window during which the server post-processes the upload (rendering a preview, transcoding, scanning) before it responds. On a fast link the bytes finish in milliseconds while that window can run for seconds, during which the bar would otherwise sit frozen at a full `uploading` state; the new state advances the state attribute only, leaving the bar full so a styled bar can show a distinct processing affordance via CSS, and a native indeterminate bar keeps animating. Purely additive and i18n-neutral. Browser-bundled — re-bake your bundles. (#R8)
- **Fixed — absolute URLs poisoned by port-less internal calls.** A request whose `Host` carries no port — a container health probe on an app route, a service-mesh hop, a sibling-bundle call addressed by service or DNS name — was classified as reverse-proxied and rewrote the worker's proxy-host context, so later renders' `getUrl` / `url` filter output and cross-bundle redirect and error-fallback targets could emit the internal host. The template filters (swig and nunjucks) and both URL builders now prefer the emitting request's own per-request classification on both engines, Express included; the worker-global remains the fallback for renders without a request. Server-side — restart your bundles. (#B152)
- **Fixed — the Couchbase connector no longer hangs the request when an N1QL query fails at the socket level** — connection refused or reset, or a node still warming up after a restart or rebalance — with no query-error envelope. The three query error handlers read the vendor `cause` unconditionally, so on such a failure a swallowed `TypeError` left the query callback un-fired and the request never settled: no response, no error page. Each handler now forwards a usable error on both paths and always settles the query. Server-side — restart your bundles. (#B153)
- **Fixed — a file input declaring only its staging upload action no longer emits a spurious warning-and-error pair** — nor writes a visible error into the form's error container — on every bind and re-bind. The delete action deliberately has no framework default because its endpoint is app-specific, so its absence is now a quiet debug at bind time; the requirement is still enforced when a delete is actually triggered. Declaring the delete action explicitly, the previous workaround, is no longer needed. Browser-bundled — re-bake your bundles.
- **Fixed — a staged-upload reset or delete click that matches none of the rendered previews now logs a diagnostic warning instead of silently doing nothing.** Previously a zero-match removal skipped its whole cleanup path — the server-side temp-file delete request, the progress-indicator reset, and the removal callback — with no signal, so orphaned temp files could go unnoticed. A normal removal is unchanged. Browser-bundled — re-bake your bundles. (#B150)

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
