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

## What's in 0.6.27

> **Restart your bundles *and* rebuild them.** Two of the fixes are
> browser-bundled (the FormValidator autofill pair), so `gina.min.js` and
> `gina.min.css` both changed — `gina bundle:restart` alone leaves the old
> client running. Rebuild each consuming bundle, then restart.

> **No settings reset.** `0.6.27` is a patch — the `shortVersion` stays `0.6`,
> so your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**The completion-handle release** — most of it is one shape found in three
places: a completion handle that settled on a process-wide or instance-wide
event, so two calls in flight at once delivered each other's results, or
nothing at all. `lib.archiver` and the controller's fluent `.onComplete()`
both now settle per call. Alongside them, FormValidator learns to see a
browser autofill, and the Inspector stops serving one request's data to
every later one. Full detail in [CHANGELOG.md](./CHANGELOG.md).

- **Security — Inspector payloads no longer leak across requests through the compiled-template cache (#B464).** With `server.cache.enable` true and the Inspector block injected (automatic in dev; in production only when a controller calls `self.render(data, true)`), the `window.__ginaData` script was baked into the layout *before* swig compiled it, so the per-view compiled template and the persisted `.gina-layout-cache` file carried the **first** request's page data — the controller's data, the session card, the environment — and served it to every later request of that view, to other views compiled after it, and to every later process until the file was removed. The popin hidden inputs were a second pre-compile carrier, and `/_gina/reveal` plus the Inspector stream froze with them. The compiled layout now carries only an HTML-comment marker: both cache paths build the payload *after* the template executes and splice this request's script, so a cache hit refreshes the Inspector sinks too. A stale layout-cache file written by an earlier release is healed in place on the next compile — deleting `.gina-layout-cache` is optional, never required.
- **Changed — two controller events fire less often (#B475).** Now that the fluent `{onComplete}` handles deliver per call, `query#complete` is emitted on the controller only when nothing consumed the outcome — no callback and no `.onComplete()` — one tick after settlement; a fluent query that registers a callback no longer emits it. `'uploaded'` is no longer emitted for the fluent `store(target).onComplete(cb)` form. Neither had a documented listener. Also `query()` in callback form now returns `undefined` on every path instead of an unusable per-transport handle, and an explicit `null` callback selects the fluent form instead of throwing at delivery time.
- **Fixed — `lib.archiver` calls no longer interfere with each other (#B473).** Every `compress()` and `decompress()` completion used to be signalled by emitting one fixed event name on the process-wide singleton, so two overlapping calls — two queue consumers, or a request handler beside a worker — both received whichever run finished first: the second caller was released early with the first run's archive path, and its own archive was left at 0 bytes. The array form also kept its output stream in an implicit global, so finishing one run closed another's. Each call now settles exactly once for its own listeners, and a listener attached after the run settled is still delivered. Errors on the streams the library opens itself now reach the caller too: an unreadable input used to either crash the process or hang the run forever, leaving a corrupt partial archive on disk, depending on timing.
- **Fixed — the directory form of `compress()` no longer drops the first entry (#B474).** Its top-level walk seeded the work list from index 1 — the author evidently expected `.` to come first, which node's `readdir` never returns — so a directory holding a single file archived to an empty zip, and every directory-form archive silently lacked one file. The in-tree `project:backup` command uses the array form and was never affected; only direct callers of the directory form are.
- **Fixed — the single-file form of `compress()` writes a real zip, and `decompress()` reads every form back (#B476).** It used to pipe the file through a gzip codec and write the result under the `.zip` name, which `unzip` and `decompress()` both rejected, and `method: 'br'` or `'deflate'` were accepted by the option validator and silently produced that same gzip. The archive keeps its path and holds one entry named by the basename; **the bytes change from a gzip member to a DEFLATE zip, so anything that gunzipped the output directly must now read it as a zip.** `method` is validated against `gzip` alone again, so `br` and `deflate` throw synchronously as they did before a refactor silenced them. The same branch also skipped any input whose path carried a dot-prefixed segment — a `.env`, or a file under `~/.config/` — reporting success with the *input* path as the archive, leaving an empty zip on disk and leaking the descriptors it had opened.
- **Fixed — fluent `.onComplete()` handles deliver to their own call (#B475).** `self.query()` and `self.store()` both registered the application callback on the controller instance's shared EventEmitter. `store(target).onComplete(cb)` used `self.on('uploaded', cb)` and never removed it, so a second `store()` on the same controller re-invoked every earlier callback with the later result; `query(options, data).onComplete(cb)` cleared every `query#complete` listener before registering its own, so a concurrent fluent query evicted the first — its callback never fired, the survivor could receive the other call's payload, and the evicted response was emitted to nobody, on both transports, with no log line. The synchronous failure paths of `query()` also returned `emit()`'s boolean instead of the handle, so chaining `.onComplete` threw `TypeError` and the error was lost. `query()` now mints one delivery channel per call and returns the handle on every path; the delivered shapes are unchanged.
- **Fixed — a `query()` issued while rendering from another required controller now settles (#B479).** The guard that refuses `self.query()` once a second render has been entered on the request — the state `requireController` produces, because the required controller shares the caller's options object — returned the literal `false` and delivered nothing: the callback form never fired and the fluent chain threw `TypeError` on the boolean. The refusal now settles like every other synchronous failure, with an `Error` whose `code` is `NESTED_RENDER`, and the upstream is still never contacted.
- **Fixed — FormValidator reacts to a browser or password-manager autofill (#B478).** A fill lands without any keystroke, and on Chrome without an `input` or `change` event until a later gesture, so the live check never re-ran: the submit control kept the gated look it was given at bind time on a form the user could see was complete, and an autofilled invalid value showed no error. The default stylesheet now gives every autofilled control a 1 ms keyframe, and the validator routes the resulting `animationstart` into the field's own live check. A value the browser still withholds from script no longer counts against the gate and renders no false required error; the submit-time check is unchanged, so a value still withheld at click time is refused and never posted empty.
- **Fixed — FormValidator tells the truth about an autofilled field it refuses at submit time (#B341).** Such a field is visibly filled yet reads empty to script, so the submit-time check correctly refuses to post it — but the message it rendered was the plain required label, naming a problem the user could not see. A new built-in label key `isRequiredAutofill` covers that one case, with the verdict, the `errors` key and the submit gate all unchanged, and the control is marked `data-gina-form-autofill-withheld="true"` as a styling hook. The key is alias-filled from an app-supplied `isRequired` label, so a localized catalog keeps its own wording until it translates the new key itself.

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
