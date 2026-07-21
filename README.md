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

## What's in 0.5.22

- **Fixed — multipart binary uploads arrive byte-identical.** Binary file payloads uploaded via native multipart (`FormData`, `curl -F`, hand-built bodies) were string-decoded on their way to disk, so any content that is not valid UTF-8 — images, PDFs, archives — arrived mangled and mis-sized. Pure-ASCII payloads were unaffected, which is what hid the corruption. The request stream now stays raw for multipart bodies and the per-file write pipeline passes chunks through verbatim, so files reach `req.files[].path` byte-identical and `req.files[].size` reports the real on-disk byte count instead of a decoded character count. If you base64-encode binaries over JSON to work around this, you can retire that workaround. Server-side — restart your bundles. (#B103)
- **Fixed — link HTML callbacks (`data-gina-link-event-on-*`) work, and no longer break the link.** Carrying `data-gina-link-event-on-success` or `data-gina-link-event-on-error` on a `data-gina-link` anchor made every click throw before the XHR was even opened: no request left the page, no callback ran, and the link was effectively dead. Three defects were fixed together — the registration helper was trapped inside another function's scope, the call site passed no type, and the internal success/error events were named and targeted inconsistently between registration and dispatch. Name a `window`-level function (bare identifier, no parentheses) and it now receives `(event, result)`. The programmatic `gina.link.on('success'/'error')` channel is unchanged. Browser-bundled — rebuild your bundles. (#B141)
- **Fixed — reopening a popin no longer renders the previous open's content.** The AJAX popin content cache outlived the open it warmed, so every open after the first paid for a network fetch yet rendered the body fetched around the *previous* open — a one-generation lag that showed a stale snapshot whenever the content changed between opens. The cache entry now dies with the open it warmed, and a trigger annotated `data-gina-dialog-preload="false"` additionally skips the cache read at open, making `"false"` a hard always-refetch guarantee. Costs at most one extra idempotent GET per close on default triggers. Browser-bundled — rebuild your bundles. (#B139)
- **Fixed — FormValidator: numbered `is<N>` rules, a hung submit, and the checkbox migration warnings.** Numbered `is` aliases no longer collapse onto the bare `is` error key when validation re-applies rules against the same form (a `_case_` re-evaluation, nested field groups) — each keeps its own distinct key and each message renders once, instead of the last-declared rule's message rendering twice (#B138). A `query` rule's async result path is now blanket-guarded, so a throw while handling a backend result — an unbound form, a malformed body, a boolean checkbox value — warns and releases the pass instead of hanging the submit forever (#B87). And the #49 checkbox migration warnings now name the payload-only remedy (remove the `value` attribute — a boolean-classified checkbox posts its live checked state either way) and can be silenced per form with an explicit `data-gina-form-checkbox-value-as-state` declaration (#B125). Browser-bundled — rebuild your bundles.
- **Fixed — `page.view.locale` carries the real country record.** The per-request country-locale lookup filtered the region data on a key it has never carried, so the object had always been empty when the culture carried a country code — and an arbitrary first record when it did not. Templates now receive the real record (`countryName`, `currency`, `capital`, …) resolved from the request culture's country code, with lowercase country segments normalized and a country-less culture yielding an explicit empty object. Nothing read the broken object before, so no existing template changes behavior. (#B101)
- **Fixed — install no longer dies on a redactor-matched npm prefix.** `npm install -g gina` failed whenever the effective npm prefix contained a path segment npm's redactor masks — a UUID-shaped directory is enough (CI sandboxes, generated workspaces): `npm config get prefix` refuses such a read as protected on every current npm generation (10/11/12), and both install scripts ran that probe unguarded. The probe is now guarded, falling back to the prefix npm itself exports to the install lifecycle. The fix ships inside the tarball, so it applies from this version's install onward. (#B126)
- **Added — the `settings.i18n.cultures` allowlist is honoured.** A non-empty array under `settings.json > i18n` now constrains which cultures the user-signal negotiation steps (URL prefix, cookie, `Accept-Language`) may match, so a staged rollout can ship a `locales/de.json` catalog without `de` becoming reachable until it is listed. `null` or `[]` keep the historical derive-from-loaded-catalogs behavior, and the bundle default (`settings.region.culture`) is never constrained. The whole `i18n` block is now declared in the published settings.json schema. Restart to apply.
- **Changed — runtime pins moved to the standard `engines` manifest key.** The floors (Node `>= 22 <27`, Bun `>= 1.2`) were declared under a non-standard singular `engine` key that npm and Bun tooling ignore entirely, so unsupported runtimes got no install-time warning at all. They now activate npm's standard `EBADENGINE` warning — a hard failure only where `engine-strict` is set. Scaffolded project manifests — the `project:add` template and the install-time fallback `package.json` — carry the standard object-form key too.

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
