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

## What's in 0.5.26

> **Three behaviour changes to check before upgrading.** Two can stop a bundle
> that you have not otherwise touched: a route pairing an authorization key with
> `cache` now refuses to boot, and so does a `method: "ws"` route declaring
> `requireAuth` / `roles` / `policy`. The third only adds a boot line — a bundle
> resolving a cleartext scheme outside the `local` scope now warns, and refuses
> only if you opt in with `server.requireHttps`. See the
> [migration guide](https://gina.io/docs/migration) for each.

- **Added — deny-by-default authorization.** `settings.json > auth.requireAuthByDefault: true` inverts a bundle's posture: every route requires an authenticated session unless its `routing.json` `param` block carries `"public": true`. It composes with the existing `requireAuth` / `roles` / `policy` keys rather than replacing them — an explicitly gated route behaves exactly as before, and `public` can never un-gate one. The mode is strictly opt-in and strictly boolean (a truthy string refuses to boot rather than leaving every route silently ungated), and it is keyed per bundle, so one bundle enabling it never changes the posture of a sibling in a merged-mode process. The routes the framework injects for you — the site root, the custom error page, `/_status` and the upload endpoints — ship `"public": true`, so enabling the mode does not take them offline. The boot refuses three configurations the mode would otherwise make dangerous: `"public": true` on a route that also declares an explicit gate key; a login route the mode would gate, which would bounce to itself in an infinite redirect; and a mode-gated route that also declares `cache`, because the render cache is read before authorization runs and its key carries no user identity. `gina bundle:openapi` reflects the mode, so the emitted specification never declares a newly gated route as unauthenticated. Enable it in a non-production environment first and read the boot line, which reports how many routes it just gated. Server-side — restart your bundles. (#COMPLY10)
- **Added — a boot-time production transport posture guard.** A bundle resolving a cleartext scheme outside the `local` scope now warns once at boot, naming the remediation. `server.requireHttps: true` refuses to boot the cleartext bundle instead — pre-listen, so the port is never reachable — and `server.allowInsecure: true` acknowledges that TLS terminates upstream (mesh, ingress, reverse proxy), turning the warn into one info line. Both are strict booleans; a non-boolean, or setting both, refuses to boot. Server-side — restart your bundles. (#COMPLY9)
- **Fixed — Couchbase client-side query timeouts now classify as transient and keep their message.** The connector replaced the driver error with one built from the query `cause` envelope whenever that envelope was present — but the SDK attaches it to every query error, so a client-side timeout (which carries no server text) became an empty-message `Error` and lost the typed timeout class name the transient/permanent classifier matches on. The raw driver error is now forwarded whenever the envelope has no message to surface, so `err.isTransient` reports true and `err.message` keeps the SDK text. Server-side — restart your bundles.
- **Fixed — `gina bundle:mcp-start --transport=http` now actually applies `GINA_MCP_AUTH_TOKEN`.** It is read through the framework environment reader instead of `process.env` directly: the CLI moves every `GINA_*` variable out of `process.env` into the framework environment during startup, so the resolver's direct read always came back empty and the token was silently never applied — a deployment that supplied the bearer token only through that variable ran with no authentication. The `--auth-token` flag and the `mcp.json > server > authToken` manifest field were not affected. If you set the token through the environment variable, restart the server and confirm the startup line now reports `bearer auth: enabled`.
- **Fixed — a Couchbase `.sql` `@options` annotation that silently did nothing now warns.** Two shapes were affected: an annotation the parser cannot read (braces are required — write `@options { … }`), and a parsed annotation whose keys are all dropped because no `consistency` key is present (keys such as `adhoc` or `timeout` apply only alongside `consistency`). Query behaviour is unchanged — the warning lists the ignored keys and shows the exact form to write. Server-side — restart your bundles.
- **Fixed — the JSON schemas now describe the route-authorization vocabulary.** `auth.requireAuthByDefault` was missing from the `settings.json` schema whose `auth` block forbids unknown keys, so an editor flagged a perfectly valid deny-by-default configuration as invalid; and `param.requireAuth`, `param.roles`, `param.policy` and `param.public` were undeclared in the `routing.json` schema, so they were accepted but offered no completion, no type checking and no description on hover. Runtime behaviour is unchanged — the schemas are editor tooling, never enforced at boot.
- **Fixed — `lib/merge`'s documentation contradicted the shipped behaviour.** The two-argument form preserves existing target keys on a conflict (`override` defaults to `false`, not `true` as documented), and the array example now shows the real result — a two-argument array merge combines elements (`merge([1,2],[3,4])` gives `[1,2,3,4]`), while replacing the target array requires `override=true`. Behaviour is unchanged; only the JSDoc (including its copy embedded in the browser bundle) was wrong.
- **Security — the framework control-plane listeners now bind an explicit host that defaults to loopback.** A new `bind_host` setting (env `GINA_BIND_HOST`, flag `gina framework:set --bind-host=`) governs where the command socket and the MQ listener accept connections; it is separate from `host_v4`, which remains the address clients connect to, so a workstation pointing `host_v4` at another machine still starts its own daemon normally. Exposing the control plane beyond the local host is now a deliberate opt-in, the same way a bundle uses `--http-host`. Existing installs inherit the loopback default; set `bind_host` if you relied on reaching these ports from another machine.
- **Security — a command name arriving over the framework socket is constrained to the shipped command namespace** before it is resolved to a handler, so it can only ever resolve inside `lib/cmd/`. Unresolvable names are answered on the connection instead of ending the daemon process, which previously stopped serving every other client; a one-shot offline CLI run still exits non-zero. The MQ listener likewise skips a malformed frame rather than letting the parse failure drop the listener.
- **Security — a route that declares both an authorization key and `cache` now refuses to boot.** The render cache is read before the authorization gate runs and its key carries no user identity, so the first authenticated response was replayed verbatim to every later unauthenticated caller. The boot refusal names the route and the remedy; as a second layer, the render delegates never store a body for a gated route even if the configuration bypassed the lint. `auth.requireAuthByDefault` already refused this pairing for mode-gated routes — it now covers explicitly gated ones too. **Action required:** a bundle pairing `param.requireAuth` / `param.roles` / `param.policy` with `cache` will not start until you drop `cache` or open the route. (#B158)
- **Security — the MCP Streamable HTTP transport refuses to start without a bearer token once an ambient protection has been removed** — that is, when it is bound to a non-loopback address, or when the `Origin` allowlist has been disabled with `allowedOrigins: ["*"]`. Nothing binds in that case, so the port is never reachable unauthenticated. The default posture is unchanged: on a loopback bind with the built-in `Origin` allowlist a token stays optional, because the bind and the allowlist are the protection. A new `allowInsecure` option (CLI `--allow-insecure`, or `mcp.json > server > allowInsecure`, strict boolean) waives the requirement for deployments that restrict access upstream instead — a service mesh, a NetworkPolicy, or an authenticating reverse proxy. Bearer validation now hashes both the presented and the configured token before the constant-time comparison, so neither the comparison nor its timing depends on token length.
- **Security — a `method: "ws"` route that declares `param.requireAuth`, `param.roles` or `param.policy` now refuses to boot.** A WebSocket handshake is answered by the engine's extended-CONNECT handler and never reaches the authorization gate, so those keys could never be enforced — yet the route linted clean, started, and was counted in the "Registered N authorization-gated route(s)" boot line, actively confirming protection that did not exist. Authenticate inside the `wsHandler` instead: it receives the full request and can inspect headers and cookies before accepting the socket. Relatedly, `auth.requireAuthByDefault` no longer counts WebSocket routes among the routes it gates, and names them at boot instead. **Action required:** a bundle declaring an authorization key on a ws route will not start until the key is removed. (#B159)

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
