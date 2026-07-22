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

## What's in 0.5.24

- **Added — upload progress for the staged upload client layer (#R8, slice 1).** The staging POST of a `data-gina-form-upload-*` file input now reports real client-to-server wire progress. A new registered form event `uploadProgress.<uploadFormId>` carries `{ status, progress, loaded, total, lengthComputable, files }` (per-request aggregate — one staging request carries every file of a selection). Opt-in consumer surfaces: `data-gina-form-upload-on-progress="<windowCallback>"` and a declarative indicator resolved from `data-gina-form-upload-progress="<elementId>"` or the default `<fieldId>-progress` — a native `<progress>` element tracks uploaded/total bytes, any other element gets percent text plus `data-gina-upload-progress` / `data-gina-upload-progress-state` styling hooks. No wording is hardcoded. Browser-bundled — re-bake your bundles. (#R8)
- **Added — drag-and-drop for the staged upload client layer (#R8, slice 2).** A file input carrying `data-gina-form-upload-dropzone="<elementId>"` binds the named element as a dropzone; files dropped there route through the exact same staging pipeline as a native picker selection (group tagging, staging POST, previews, hidden metadata fields, reset/delete, and upload progress). Opt-in and explicit-id-only, first-wins per zone, only file drags react (text/link drags fall through untouched), and a multi-file drop on a non-`multiple` input keeps the first file with a console warning. The zone exposes `data-gina-upload-dropzone` (owner input id) and `data-gina-upload-dropzone-state` (`idle`/`over`/`dropped`) as pure CSS styling hooks. Browser-bundled — re-bake your bundles. (#R8)
- **Added — incident ref on error responses (#ERRREF).** Every `throwError` JSON error body now carries a top-level `ref` field — a short voice-relayable correlation code (6 uppercase hex, or a relay-safe caller-supplied value), present in all scopes — and one server-side error-level log line pairs that ref with the full error detail (message, stack, cause) and the request correlation id before the stack-egress gate strips the wire copy, so support can resolve a user-relayed ref to the exact server-side failure even in production. The HTML error surfaces carry the same ref. Also closes two logging gaps: a production API error thrown through the controller previously lost its stack server-side entirely, and message-only server errors logged method/code/url without the message. Always-on, additive and backward-compatible. Server-side — restart your bundles. (#ERRREF)
- **Added — a per-upload-group `simulateWriteError` flag (honoured outside production only) to verify the upload write-error crash-guard.** Setting it on an upload group makes every upload tagging that group deterministically answer the same guarded HTTP 500 a real mid-stream write error produces — so you can confirm the crash-guard on your own upload surface after an upgrade, with no filesystem or global-config change affecting real uploads. A boot warning surfaces the flag if it ever reaches production, where it stays inert. Server-side — restart your bundles. (#B144)
- **Fixed — the staged upload client layer no longer corrupts binary file uploads.** The multipart body was hand-assembled as a JS string and transmitted as a DOMString, which UTF-8-inflated every file byte ≥ 0x80 on the wire — a real image/PDF/archive was stored inflated and unreadable (measured ×1.49 on a cycling-byte fixture; a PNG lost its signature). The body is now assembled as a Blob (raw file bytes, transmitted verbatim) with the multipart framing and the `group=` disposition parameter byte-identical to before — no server or wire-contract change; disposition parameter values additionally percent-encode CR/LF/double-quote per RFC 7578. Files corrupted by this defect are losslessly recoverable (the stored bytes are the UTF-8 encoding of the original: decode utf8, re-encode latin1). NOTE the corruption only surfaced on gina ≥ 0.5.22 — the pre-0.5.22 server's since-removed string-decode layers coincidentally reversed the client inflation. Browser-bundled — re-bake your bundles, paired with a server ≥ 0.5.22. (#B148)
- **Fixed — a misconfigured upload group whose destination directory cannot be created now answers HTTP 500 for that one request instead of crashing the bundle.** Previously the synchronous directory-creation error inside the multipart parser propagated as an uncaught exception and terminated the process on the next upload tagging that group. Server-side — restart your bundles. (#B145)
- **Fixed — a staged file input declaring only its upload action is no longer silently repointed at the reset/delete route.** When a reset- or delete-action attribute was absent and a default route resolved, the fallback wrote the resolved URL onto the staging action attribute regardless of which attribute it was checking, so the staging POST went to the delete route; it now writes the attribute it was actually checking. Browser-bundled — re-bake your bundles. (#B146)
- **Fixed — an upload no longer throws in its success handler when no preview element is present.** The preview-container lookup treated a `getElementById` miss (null) as a real element, stored it, and later dereferenced it; it now requires a resolved element, so an upload configured without a preview target completes cleanly. Browser-bundled — re-bake your bundles. (#B147)

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
