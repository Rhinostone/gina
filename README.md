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
| Object storage | `gina.storage()` — named drivers pairing an adapter with a key strategy behind opaque keys: `sharded` (dated), `cas` (content-addressed, deduplicating, refcounted, GC-swept) and `stream` (large media, resumable out-of-order segment uploads); size tiering, HTTP Range serving (`serveFromStorage()` — 206/416/304, strong key ETags), embedded SQLite or Couchbase metadata store, `storage:stats` / `gc` / `verify` CLI |
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

## What's in 0.6.7

> **Re-bake your bundles, not just restart them.** The browser bundle changed in
> this release. The form-validation, styling and link fixes below live in the
> bundle, so a restart alone will not deliver them. Rebuild each bundle
> (`gina bundle:build`) as well as restarting. The storage layer and the
> instrumentation change are server-side and need only the restart.

> **No settings reset.** `0.6.7` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**One item requires action before you upgrade:** the `is` validation rule now
compiles regex literals as authored, which makes any pattern containing
parentheses *stricter* than it was. Two more may need a look — `req.files[].group`
now reports `untagged` instead of `undefined`, and bound query parameter values
are redacted from dev logs by default. All are called out below and in the
[migration guide](https://gina.io/docs/migration).

- **Added — pluggable object storage.** A new optional `storage` block in `settings.json` declares named drivers — an *adapter* (where bytes live) crossed with a *strategy* (how keys are laid out) — reachable from application code as `gina.storage()`. Objects are published atomically under an opaque key, with their metadata recorded through a pluggable store seam. A driver root that sits inside a web-served directory refuses the boot, since objects there would be publicly fetchable without passing your authorization. With no `storage` block the whole feature is inert. See the [storage guide](https://gina.io/docs/guides/storage).
- **Added — content-addressed storage (`strategy: "cas"`).** Keys derived from the object's digest, so identical bytes stored twice yield the same key and no second copy — the blob gains a reference instead. `release()` drops a reference rather than deleting, and a grace-gated sweep reclaims blobs that have sat at zero. `findByDigest()` answers whether content is already stored without transferring it. cas publishes `fsync` by default, because the strategy exists for immutable content.
- **Added — size tiering.** Objects strictly under a driver's `inlineThreshold` (default `"64KB"`, the measured knee) are stored inline in the metadata store in a single transaction rather than as individual files — 2.7–13× faster than per-file writes at and below the default. Keys, `stat()` and `release()` are identical in both tiers. Two tradeoffs worth knowing: sub-threshold objects are not individually browsable on disk, and the metadata store then carries their bytes. Set `"0B"` per driver to turn it off.
- **Added — storage maintenance CLI.** `gina storage:stats`, `storage:gc` (`--dry-run`) and `storage:verify` (`--fix`) follow whoever owns the store: a running bundle answers through new always-on, admin-gated `/_gina/storage/*` endpoints, a stopped one is opened offline, and an unreachable one is never touched. `verify` separates fixable sweep residue from loss evidence, and never auto-fixes the latter.
- **Added — upload groups can publish into a storage driver.** A `driver` key on an `upload` group routes that group's `self.store()` step through the named driver instead of moving files to the target directory. Entirely opt-in and per-group: groups without a `driver` keep the historical move path byte-for-byte. Routed entries come back with an opaque `key` and no `filename`.
- **Security — bound query parameter values are redacted by default.** Dev-mode console query lines, the Couchbase `bulkInsert` statement, the MongoDB resolved body and the Inspector query log no longer print bound parameter values; they carry count and type markers instead (`3 [string, number, string]`). A bind value is routinely a secret owned by your application — a session or credential token, an API key, a password hash — and a positional bind array has no key names, so the key-based `inspector.redact` matching structurally could not cover it. **Set `inspector.queries.captureValues` to `true`** if your debugging workflow needs the real values back.
- **Fixed — `is` regex literals compile as authored.** A security transform stripped every `(`, `)` and literal `return` from a regex-literal condition *before* compiling it, silently changing what the pattern matched: `/^(a|b)$/` behaved as `/^a|b$/`, accepting any value merely containing a middle alternative, and `(#TAG)?` became a literal `#TA` plus an optional `G`. The transform now applies only to the binary-comparison form, which keeps its grammar-locked protection. **Action required:** review `is` rules whose pattern contains parentheses — they now match as authored, i.e. stricter, so values that were passing only through the mangled pattern will start failing.
- **Fixed — forms with an async `query` rule complete correctly.** A cluster of interacting defects, each of which masked the others: a submit could leave before the query answered (with its error rendering after the POST); the completion carried only the query field's verdict, so other invalid fields were adjudicated but never shown; a re-click on an unchanged value cleared later fields' errors, with the outcome depending on field declaration order; a clean form whose query field was not declared last could never submit at all, stranding its re-entry latch and swallowing every later click until reload; stale listeners could replay a submit; and a submit trigger with no markup `id` was bound twice, running two validation cycles per click. A submit gesture landing while a live-check query is still on the wire now waits for the verdict instead of being silently refused.
- **Changed — framework default looks ship in a CSS cascade layer.** The defaults for `data-gina-loading` and `data-gina-form-submit-gated` now live inside `@layer gina`, so any un-layered project rule beats them regardless of specificity or load order — no `!important` needed. Functional rules (popin structure, scroll lock) deliberately stay un-layered so a generic project reset cannot break them. If your project organises its own CSS in layers, declare `@layer gina, app;` early to order yourself against gina explicitly.
- **Fixed — `getConfig().settings` resolves path placeholders.** A settings value written with `${bundlePath}`, `${publicPath}`, `${gina}`, `${<name>Port}` and friends reached the no-argument `getConfig()` surface as a literal token, because that alias was bound before the substitution pass and the pass returns a new object. It now agrees with `getConfig().content.settings`. `${secret:…}` references were never affected.
- **Fixed — `req.files[].group` carries the resolved upload group.** The parser always resolved each part's group — no tag resolves to `untagged` — but pushed the raw disposition parameter into the record, so the field was `undefined` in exactly the default case. **Code shaped like `if (file.group)` now enters the branch for untagged files** where it previously skipped them.
- **Fixed — the settings template stopped advertising upload keys the framework never read.** The per-group `filePrefix`, `subFolder` and `maxFieldsSize` samples and the block-level `encoding` key were shipped as scaffolding samples and documented as functional, and no code path read any of them. They are retired from the template, the reference page is corrected, and `schema/settings.json` now declares the real key set. Applications declaring their own per-group keys and applying them app-side are unaffected.
- **Fixed — the Inspector shows your data, not the framework's.** The Data tab no longer lists the `__ginaFlow` and `__ginaQueries` transport keys, which the Query and Flow tabs already present first-class; any root key prefixed `__gina` is hidden across every Data surface, while nested keys carrying the prefix stay visible as application data. The Forms tab demotes the bundle's forms catalog into a single collapsed **Bundle catalog** card at the bottom, so the page's real forms keep the prime space.

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
