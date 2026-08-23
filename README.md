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

## What's in 0.6.14

> **Restart your bundles — no rebuild needed.** Every change in this release is
> server-side. The browser bundle's executable content is byte-identical to
> `0.6.13` (the only `dist/` delta is a documentation comment, which
> minification strips), so `gina bundle:restart` is enough and you do not need
> to re-run `gina bundle:build`.

> **No settings reset.** `0.6.14` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**One new opt-in capability, and a correctness pass over how `self.query()` hands
results back to your code.** The headline is a secrets bridge that reads from a
network-backed store without a vendor SDK and without risking a hung boot.
Alongside it, six fixes close the seams where a query's outcome could be lost:
a rejected `async` callback that hung the request, a throw that killed the whole
bundle process, an HTTP/2 failure answered twice, a handle-mode listener that
never fired, and non-5xx statuses that never reached the callback at all.
**Several behaviour changes are worth checking before you upgrade** — each is
called out in its bullet below, with the details in the
[migration guide](https://gina.io/docs/migration).

- **New — network-backed secrets without a vendor SDK or a hung boot (#SECRETS3).** A bundle may declare one operator-supplied fetch command under `settings.secrets.exec` — argv form, no shell (`{"command": ["sops", "decrypt", "--output-type", "json", "${project}/secrets.enc.json"], "timeout": 10000}`) — whose stdout must be a single flat JSON object of string values. It runs once per bundle per config-load cycle, at boot only, and is layered *underneath* the environment exactly like the existing `file` tier: a non-empty environment value still wins. The two declared tiers are mutually exclusive, and a bundle inheriting a project-wide `file` chain opts out with `"file": null` beside its own `exec` block. **A failing fetch is always a fast, named per-bundle boot refusal, never a hang** — the child is bounded by `timeout` (default 10000ms) and killed with `SIGKILL` on expiry, so a wedged secrets endpoint costs you a failed boot rather than a process that never comes up. The fetched output is never echoed into any error, log or report, and `gina secrets:check` validates *and runs* the same command through the same code, so the CI gate's verdict matches the boot's by construction. Recipes for `vault`, `kubectl` and `sops` are in the guide. Decrypting at the container entrypoint remains the better pattern wherever you control the entrypoint; this tier exists for the environments where you do not. **Also stricter, deliberately:** `settings.secrets` now refuses unknown keys and non-object values at boot instead of silently ignoring them — a typo'd tier name used to degrade to environment-only resolution without a word.
- **Fixed — an exception in an `async` query callback can no longer vanish (#B399).** Every app-callback delivery in a controller's `self.query()` — the Node-style callback form and the `{onComplete}` facade, on both HTTP/1.1 and HTTP/2 — invoked your callback bare. A synchronous throw was caught by the success-delivery guards, but an asynchronous *rejection* was unowned: the request hung to client or proxy timeout and the only trace floated up to the process-level rejection handler. Every delivery now routes a rejected callback promise to the same `throwError` shape the synchronous guards build. **Behaviour change:** an `async` query callback whose promise rejects now answers 500 (with the `#ERRREF` correlation ref) where it previously hung. A callback that already responded before rejecting is absorbed by the released-response guard — logged server-side, never a double response. Synchronous behaviour at every delivery site is byte-unchanged, and plain callbacks mint no promises.
- **Fixed — a throw inside a query callback on a transport-error delivery no longer kills the bundle (#B402).** All 14 formerly-bare error-path deliveries — host-missing, circuit refusal, the query-scope outer catch, both certificate-read catches, HTTP/1.1 ALPN and request-error, the HTTP/2 typed terminals and both pre-flight PING failures — now wrap the callback. Previously, on the event- and timer-frame sites a throw escaped to the process handler as an emergency-level exit, **killing the whole bundle on both engines**; on the caller-frame sites the query-scope catch re-invoked your callback a second time, passing its own exception as the error argument. **Behaviour change:** a throwing callback on an error-path delivery now answers a flat 500 instead of killing the bundle or double-invoking. Your callback still receives the original transport error first, and callbacks that do not throw are untouched.
- **Fixed — an HTTP/2 transport failure is now answered exactly once (#B403).** The app callback received the typed error from the stream-level delivery while the *session* error handler independently answered the same request through `throwError` — racing graceful degraded-mode handling, so the framework's 500 could reach the wire before your own response. On a reused session it was worse: session listeners bind once at connect, so the handler could answer using the *creating* request's context. The session-level answer is retired; session cleanup and logging stay, and request notification is owned solely by the stream-level deliveries, which fire for every live stream when a session fails. HTTP/1.1, which has no session layer, already behaved this way.
- **Fixed — handle-mode query errors now reach your `onComplete` listener (#B404).** Every error-path `query#complete` emit is single-argument, mirroring the callback form's `callback(err)` contract, but both facades' `(err, data)` dispatch dereferenced `data.status` unconditionally — so a transport error or a non-2xx outcome crashed the facade and answered 500 with a marker that misattributed the failure to your callback, which never ran. Both facades now deliver the single-argument payload as the error: on failure `cb(err)` with `data` undefined (a plain `{status, error}` object for a non-2xx status or a transport failure, a native `Error` for a pre-transport failure such as a missing host, an unreadable certificate or an open circuit), and on success `cb(false, data)`. **Action required if a handle-mode query of yours can fail:** your listener is now *invoked* with the error, where the framework previously answered 500 before it could run — the outcome is yours to own, exactly as in the callback form.
- **Fixed — HTTP/2 queries in callback mode now deliver every non-2xx status (#B405).** The dispatch split 5xx to your callback and every *other* deliverable non-2xx to the framework's own error answer, so graceful degradation was impossible for something as ordinary as a 404 from an HTTP/2 upstream — and, measured, the documented `util.promisify(self.query)` idiom **never settled** on any non-5xx status: the `await` hung and its continuation was silently abandoned. HTTP/1.1 has delivered every non-2xx to the callback since its own earlier change. The split is retired: every body-announced non-2xx with a known status code now invokes your callback on both transports. **Behaviour change:** an HTTP/2 callback-mode query that previously auto-answered the original request with the upstream's non-5xx status now invokes your callback instead — decide there whether to degrade or surface. The 3xx-with-headers redirect replay is unchanged.
- **Fixed — `self.query()`'s documented return contract (#B401).** The JSDoc claimed the no-callback form returns a Promise. It returns a handle exposing `.onComplete(cb)`, which is not a thenable — so `await self.query({...})` resolved immediately with the handle and silently dropped the result. The JSDoc and the online guide now document the real contract and the supported `await` idiom, `await require('util').promisify(self.query)(options, {})`, including its rejection shapes: a non-2xx status rejects with the plain `{status, error, message}` object, a connection failure with a native `Error`. Both were verified against the runtime.
- **Fixed — a crash during bundle bootstrap now aborts loudly instead of hanging silently (#B406).** The boot callback in `core/gna.js` is declared `async`, so a synchronous throw anywhere in its frame became a promise rejection: the process-level net logged it at error level and stopped there — no emergency marker for the daemon's startup watchdog, no exit — so `gina bundle:start` sat on its 60-second startup timer and reported a timeout with no cause attached. The whole frame is now owned by a `try`/`catch` routing every failure (including a non-`Error` rejection like `throw null`) into the existing boot terminal: an emergency-level line the watchdog matches on, a synchronous stderr flush that survives the exit, and exit code 1. **Behaviour change worth knowing:** a throw late in the boot frame that previously left a half-initialised process limping along now refuses the boot cleanly. If a bundle that used to "start" begins aborting after this release, the printed cause was always there — it was simply invisible.
- **Fixed — GET and HEAD query parameters no longer lose backslash-escaped characters (#B407, consumer-reported).** The query pipeline serialized `request.query` and then stripped every backslash from the whole document in order to support nested-JSON value unwrapping. A newline (`%0A`) in a value degraded to the letter `n`, a tab to `t`, a backslash vanished outright, and a double quote or a JSON-array value produced invalid JSON that silently dropped **every** query parameter on the request. Nested-JSON string values (`?filter={"a":1}`) are now unwrapped by parsing them individually — the same intent, validated, and correct even when the nested content itself carries escapes, which the old unwrap also corrupted — and the query then serializes cleanly. Whole-value `true`/`false`/`on`/`null` coercion and plain values are unchanged; JSON-array parameters and unparsable `{`-leading values now arrive intact where they previously killed the whole query.
- **Fixed — `gina secrets:check` now agrees with the boot (#B408, #B409).** The checker kept its own hand-written mirror of the runtime's `settings.secrets.file` declaration guards, and it had drifted — twice, both times permissively: a whitespace-only entry and a path whose `${…}` token collapsed to a double separator both reported **green** while the bundle refused to boot on them. The validation now lives in one shared implementation (`lib.secrets.validateFilePaths`) that boot and check both consume, and the check validates the declaration *before* reading any declared layer, exactly as the boot does — so an invalid chain now reports with no layers listed. **Behaviour change for CI:** the command now exits non-zero when a bundle's declaration is itself invalid or unreachable — an unreadable declared file, a malformed entry, a failing exec fetch — not only when a required key is unset. Previously such errors were printed while the exit code stayed 0 whenever the environment happened to carry the keys, so the gate green-lit configurations the runtime refuses to boot.
- **Changed — one shared config-source walk behind `secrets:scan` and `secrets:check`.** The walk now lives in `lib.secrets` as `getProjectRequiredKeys(projectPath, {scope, bundle})`, with `loadManifest`, `readJsonSafe` and `resolveBundleSrc` exported alongside it for single-file reads. The two CLI handlers each carried a near-identical private copy and now delegate to the one implementation, so they enumerate the same config sources by construction and cannot drift apart. CLI behaviour and report output are unchanged by the relocation.

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
