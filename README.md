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

## What's in 0.6.11

> **Restart your bundles AND rebuild them.** The browser bundle changed in this
> release (`Collection.replace()` and the four FormValidator fixes are bundled),
> so a restart alone keeps serving the old client code — run `gina bundle:build`
> for each bundle as well as `gina bundle:restart`.

> **No settings reset.** `0.6.11` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**This is a fixes-only release: seven fixes, two of them reported through GitHub
issues (#63, #64).** It closes a silent lossy write in `Collection.replace()`, a
cross-delivery / hang defect for concurrent `util.promisify(entity.method)`
calls, four FormValidator defects (Safari caret scrambling plus three caret edge
cases, and two submit-time display races on async-`query` forms), and a
development-mode Inspector data-channel staleness. **One behaviour change to
check before you upgrade** — `Collection.replace()` now throws where it
previously failed silently, when neither side of the comparison carries a usable
key. Details are in the [migration guide](https://gina.io/docs/migration).

- **Fixed — `Collection.replace()` no longer silently discards the write (#B393, issue #64).** When the stored entry carried an internal `_uuid` and the caller's `set` object did not, the comparison key was resolved from the stored entry alone, so the comparison became `<storedUuid> == undefined` — never true: nothing matched, nothing was replaced, no error was raised, and the call returned a result that looked successful. A stored `_uuid` is present exactly when you re-load an array a previous chained call returned, which is why the failure looked intermittent. The key is now resolved from **both** sides — the stored entry and the `set` — falling back to `id` when both carry one, and the call now **throws `No comparison key defined !`** when the two sides share no usable key, so the one unmatchable combination is no longer the only one that stays quiet. An explicitly supplied key argument is honoured exactly as before, and the resolved key is scoped per entry, so a fallback taken for one entry can no longer apply to the entries examined after it. Every previously-working call is unaffected. Browser-bundled.
- **Fixed — concurrent `util.promisify(entity.method)` calls no longer cross-deliver results or leave a caller hanging (#B394).** The promisify fast-path kept a single scalar callback slot: a second in-flight call on the same method overwrote the first, so the first result to arrive was delivered to the last caller to register (one caller receiving another's record), and the displaced caller's promise never settled — a request left hanging with nothing logged, and a read-modify-write variant that could persist one key's document under another. The fast-path now uses the same FIFO queue and single persistent dispatcher as the entity-context path: every concurrent caller settles, and when the underlying operations complete in the order they were called, each caller receives its own result. When operations can complete out of call order, results are still paired by arrival order — give such a method true per-call identity by returning a Promise instead of emitting its trigger (see the [Models guide](https://gina.io/docs/guides/models)). Server-side.
- **Fixed — FormValidator: fast typing into a Safari `autocomplete="off"` field no longer scrambles the text (#B389, issue #63), plus three position-0 edge cases in the same interception (#B390, #B391, #B392).** The keydown interception restored the caret two timer hops after each programmatic value rebuild — and a value assignment parks the caret at the end of the field — so a quick second keystroke read a stale position and characters landed at the end instead of at the caret. Every rebuild now commits the caret synchronously and records the intended position; while a deferred restore is in flight the interception trusts that record, and the restore re-asserts the latest committed position instead of a stale capture. In the same switch, Backspace at position 0 no longer deletes the first character (native is a no-op), Delete with a selection starting at position 0 no longer removes one character more than the selection, and ArrowLeft at position 0 no longer teleports the caret to the end of the field. Browser-bundled.
- **Fixed — FormValidator: a refused submit's answer stays visible and focused on async-`query` forms (#B387).** On a form with an async `query` rule and a committed error, a refused submit's answer could render, take focus, and then be hidden again milliseconds later when the click landed while a previous validation round was still settling — the late completion's display refresh read the answered field as "being typed in" (it was the active element, because the answer had just focused it) and re-hid the very message the answer had rendered. The framework now records that the focus was placed by the answer rather than by the user, both display-refresh paths honour that record however late they run, and the first genuine user interaction (typing, clicking, tabbing away) releases it — so the deliberate hide-while-typing behaviour is unchanged. Browser-bundled.
- **Fixed — FormValidator: a stale not-ready submit marker can no longer refuse every click until reload (#B348).** On a form whose async `query` rule rides a field that is not declared last, the display-only validation pass answering a refused submit click could silently never complete — its result matched no completion route — so the stale not-ready marker on the submit trigger was never re-synced and a fully valid form kept refusing every click. That pass now carries its own completion identity and always completes: the refused click renders the current validation state, the trigger state re-syncs from the fresh result, and the next click on a valid form goes through. Field declaration order no longer decides whether a stale marker can heal. Browser-bundled.
- **Fixed — Inspector (development mode): the View tab's page-weight badge and the Flow tab's late timeline bars no longer go missing until the Inspector is refreshed (#B386).** The dev statusbar hands the page payload to the Inspector before the render delegates append their late-bind patch script above `</body>`, and that patch only mutated the in-memory object — so every channel the Inspector can read kept the emit-time payload for the life of the page, with the page weight left null (it is unknown at emit) and the template-compile, execute, response-write and total bars absent. Both of the Inspector's data channels — the localStorage fallback mirror and the per-tab broadcast channel a statusbar-launched Inspector actually binds to — are now refreshed at the end of that patch, after the values are written; the broadcast channel is keyed from per-tab session storage rather than the shared cross-tab advert, so one tab can never publish onto another tab's channel. The nunjucks delegate additionally injects its patch through a function replacer rather than a string one, so a timeline entry containing a dollar sequence can no longer corrupt the emitted script. Server-side; development mode only; no configuration change is required.

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
