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

## What's in 0.6.28

> **Restart your bundles *and* rebuild them.** Three of the fixes are
> browser-bundled — both client-boot fixes and the proxy-context change — so
> `gina.min.js` changed and `gina bundle:restart` alone leaves the old client
> running. Rebuild each consuming bundle, then restart.

> **No settings reset.** `0.6.28` is a patch — the `shortVersion` stays `0.6`,
> so your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**The every-request release** — much of it is one shape in several places:
something that was right *once* and not afterwards. `self.forward()` computed
the target route and then discarded it. The browser client attached its boot
listener after the event that would have fired it, so a light page stayed
half-booted. And a run of HTTP/2 response features — the `rel=preload` header,
the automatic 103, the Inspector's asset map — were built on the compile path
only, so the first request of a view carried them and every later one did not.
Alongside them `self.forward()` learns to relay an upload, five fluent
`.onComplete()` handles learn to refuse a callback they cannot call, and one
request's proxy context can no longer steer the absolute URLs another request
builds. Full detail in [CHANGELOG.md](./CHANGELOG.md).

- **Security — one request's proxy context no longer steers another's absolute URLs (#B502).** After a single request carrying a port-less `Host` — an orchestrator probe, a sibling-bundle call, any client sending `Host: name` with no port — reached a worker, every later direct request on that worker built `getRoute().toUrl()` from a worker-global: on an HTTP/1.1 bundle the port vanished, and on an HTTP/2 + HTTPS bundle the *last port-less client's host* was emitted verbatim. Because that host is chosen by the client, it is a host-header-injection class for application-built links and redirects. `getRoute()` now resolves the proxied classification and the proxy hostname from the request itself through a per-request store, and only req-less callers (boot, CLI, cron) still read the worker-global. On earlier versions `server.proxy.requireForwardedHeaders` closes the port-less-`Host` path **only** — it never gated `X-Forwarded-Host` — so the complete interim there is a fronting proxy that overrides both headers before the bundle.
- **Added — `self.forward()` relays a `multipart/form-data` request, uploads included (#B489).** It used to hand `req[method]` to `self.query()`, which JSON-encodes its `data` and forces the JSON mime, so a forwarded upload arrived as a JSON object of its text fields and `req.files` never travelled at all. A new `lib/multipart` encoder rebuilds one RFC 7578 body from the parsed text fields — re-flattened to bracket notation, the exact inverse of the parser's nester — and from the staged files read at their staged paths, under a CSPRNG boundary redrawn until it appears in no part. The body is buffered and therefore bounded: by the source bundle's `upload.maxFieldsSize` when the parser stamped a usable cap, else 16 MB, checked before a byte is read — a breach answers 413 naming both numbers. Files forwarded under a method carrying no body answer 400; an unreadable staged part answers 500 naming the path. Staged files are read and never deleted, so your own cleanup still owns them.
- **Fixed — `self.forward()` forwards to the route it resolves (#B488).** It computed the target route and discarded it, sending the request to the target bundle's webroot alone — or, for a raw host, to the *port number* as the path — with placeholder values taken from the routing declaration (`":id"`) rather than the captured URL parameters, an inverted `project` override, and a credentials read that could throw on a bundle without any. The resolved route URL is now the forwarded path, placeholders come from the request, a string answer is relayed verbatim with `renderTEXT()` instead of being re-encoded as JSON, and an unknown target is answered through `throwError()`.
- **Fixed — the client no longer stays half-booted on a light page (#B483).** `core.js` attached its `ginaloaded` listener only after the async `routing.json` fetch resolved, while the `core` RequireJS factory — which the loader defers by a 4 ms `nextTick` — is what constructs gina and dispatches that event. Whenever the fetch lost the race the event fired with no listener: `isFrameworkLoaded` never flipped, and the popin, validator and nav boot pollers gave up, so every `data-gina-nav` hop degraded to a full navigation and no form ever bound. Pages registering a `gina.ready()` handler had a second route through the ready scheduler, which is why heavier pages booted. The listener is now attached at parse time, above the `core` module definition, so it precedes the dispatch by construction.
- **Fixed — the client boots inside a cross-origin iframe (#B486).** `construct()` read `parent.window['gina']` unconditionally to inherit a parent frame's instance; under a cross-origin parent that named-property read throws `SecurityError`, and since `construct()` is `async` the throw became an unobserved rejection — `ginaloaded` was never dispatched and the page stayed silently half-booted, with nothing in the console beyond the rejection. The inheritance is optional and is now attempted inside a try/catch: a same-origin parent still shares its instance, a cross-origin one is skipped and the boot proceeds.
- **Fixed — the HTTP/2 `link` preload header is sent on every response, not only the first per view (#B495).** With `server.cache.enable: true` a bundle served over HTTP/2 built its `rel=preload` header on the compile path only, and the compiled-template cache-hit path returned before reaching it — so in production the first request of a view carried the hints and every later one carried none, with no 103 to compensate. The header is now assembled once per view, memoised on the cache entry and re-emitted on hits under the same gates (never for XHR, never in dev). Two consequences worth knowing: with the template cache on, an XHR request now computes the preload map too, so a page first loaded by fetch no longer leaves it empty; and an empty `link` header is no longer sent when nothing qualifies.
- **Fixed — the automatic 103 Early Hints response actually fires (#B496).** `render()` read the accumulated `h2Links` prefix and called `setEarlyHints()` when truthy — but the only writers of that prefix run in `getNodeRes()`, which every one of the five render delegates reaches *after* `render()` has dispatched to it. The read therefore always saw the empty string the router seeds, and the hint was skipped on every request since the feature was added. It was never a regression: the introducing commit already dispatched below the read. The prefix is now computed before the dispatch from the view's declared stylesheets and scripts, and the router's seed is restored immediately afterwards so the final 200 `Link` header is byte-identical, verified on a live HTTP/2 production boot against a same-boot control. No hint for XHR, in dev, or for SRI'd assets — a preload hint carries no integrity metadata. `self.setEarlyHints()` was unaffected and has always worked.
- **Fixed — the Inspector View tab shows the preload assets map again (#B490, #B481).** Since `0.6.25` it rendered the literal `${assets}`: the layout-level substitution that swapped the placeholder for the real `getAssets()` map stopped matching once inline-script brace escaping landed (#B463), and `0.6.27` then moved the Inspector payload after template execution (#B464), so the placeholder rode `user.view.assets` — and the XHR hidden view input — verbatim for three releases. The payload now reads the per-template parsed assets map at splice time on both cache paths, and under HTTP/1.1, where the preload block never runs, `view.assets` is simply absent instead of a placeholder.
- **Fixed — a custom error page carries its preloads and its external plugins (#B497).** Rendered over HTTP/2, a custom error page now carries the config-declared CSS/JS `rel=preload` entries in its final `link` header and — when scripts are not in defer mode, the only mode in which the framework injects external plugins into the head — the scripts declared `isExternalPlugin: true`, like every other page. The custom-error render built its options with a *copy* of the template config, so what the framework accumulated while resolving the error page's assets never reached the header or the head it read; error pages had never carried either since both existed. The render now shares the request's template object and re-seeds its per-response accumulators first, so an error struck after the failing route's assets were resolved does not double the preload entries or the plugin tags.
- **Fixed — a retried HTTP/1 request goes out with its body (#B494).** The handler deleted `options.queryData` after writing the first attempt, and the retry re-entered with the same options object, so the second attempt was sent with `content-length: 0` and an empty body — and whatever the upstream made of that was reported back as the result. It affected any body, but only with `retryUnsafe` enabled, since the methods that auto-retry by default carry none. The body is now stashed on the options the way the HTTP/2 handler already did, and restored on re-entry.
- **Fixed — `self.store()` no longer drops the outcome of a `null` callback (#B480).** The fluent guard tested only for `undefined`, so `store(target, files, null)` fell into the callback branch, whose arms emitted to an event with zero in-tree listeners: the upload ran and nothing was told. A truthy non-function given to `.onComplete()` threw from inside an fs callback — an uncaughtException on every path but one. The guard now mints the fluent handle for any non-function `cb`, `.onComplete()` throws synchronously at the caller, and the seven unreachable emitter arms are gone with their undocumented event. Behaviour change: `store(target, files, null)` returns the handle and starts the upload when `.onComplete()` is chained, exactly like an omitted `cb`.
- **Fixed — `self.query()`'s fluent `.onComplete()` rejects a non-function at registration (#B485).** It minted a deliverer for whatever it was given, so `.onComplete(null)` registered silently and the `TypeError` fired only at settle — inside the delivery wrapper's own try/catch, which turned it into a 500 blaming the application callback for an exception it never had. It now throws at the caller's line, mirroring `self.store()`. Anything relying on the old behaviour was relying on a 500.
- **Fixed — `run()` refuses a callback it cannot call (#B491).** The framework global (also `gna.run`) now throws a `TypeError` at the caller's line when its fluent `.onComplete()` or its positional callback is given anything but a function. A wrong argument used to be accepted silently: the command ran to completion, the resulting `callback is not a function` was caught by the command's close handler and only logged, and the caller's completion never arrived. `null`/`undefined` positionally still mean "use `.onComplete()`".
- **Fixed — `Shell::run()` refuses one too, on both of its handles (#B491).** `lib/shell` wraps the callback inside its own listener on `.onComplete()` *and* `.onData()`, so either given a non-function was accepted silently and the failure surfaced only as a logged line while the caller's delivery never arrived. Both now throw at the caller's line, with `null` reported as `null` rather than `object`.
- **Fixed — the dead `onComplete` on entity method objects is gone (#B491).** A leftover of the pre-Promise design, when a method returned the entity function itself with the handle hanging off it. Its own comment claimed it would be overridden; nothing ever wrote to it, so a callback registered on the *method* rather than on the *call* was swallowed and never fired. Disclosed behaviour change: `entity.method.onComplete(cb)` — the wrong form, silently dead in every release that had it — now throws `is not a function` at the call site. The correct `entity.method(args).onComplete(cb)` is untouched.
- **Fixed — `{% extends %}` extraction stops at its own directive (#B484).** Both quantifiers were greedy, so a one-line directive followed by another quoted tag ran the directive match to the last closing delimiter on the line and the quoted-path match to the last quote, producing a layout path that matched nothing — the layout-cache re-point then silently never happened and the page extended the raw layout.
- **Fixed — a layout named ahead of its `{% extends %}` directive no longer breaks the re-point (#B482).** The rewrite that sends the directive at its assembled cache copy searched the whole template for the layout's bare filename and took the first occurrence anywhere, so a mention in a leading comment was rewritten while the directive kept the raw path. The substitution is now spliced inside the matched directive, leaving a later legitimate mention untouched.
- **Fixed — `POST /_gina/maintenance` no longer fails open on an invalid `ttlSeconds` (#B498).** The handler validated `enable` but guarded `ttlSeconds` with a single positive condition, so a value that was not an integer from 1 to 86400 — a 25-hour window, a float, a numeric string — was silently ignored and the flip applied with **no timer at all**: the caller asked for a bounded maintenance window and got an unbounded one, with `until: null` as the only tell. Both engines now answer 400, naming the bound and the configuration alternative for a window that must outlive a day. Refused rather than clamped on purpose — a shorter-than-requested window reopens a site mid-deploy, so there is no safe direction to round toward.

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
