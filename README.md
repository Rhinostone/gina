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

## What's in 0.6.9

> **Restart your bundles — no re-bake.** The browser bundle is byte-identical to
> `0.6.8`, so `gina bundle:restart` is enough; everything below is server-side
> or CLI.

> **No settings reset.** `0.6.9` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

**This release fixes one security flaw, live in every published version that
attaches `server.ioServer`.** It closes the receiver half of the axis `0.6.8`
opened, and it fails closed — so if you use targeted pushes, confirm they still
arrive after upgrading. Separately, two malformed `settings.secrets.file` shapes
now refuse to boot; check that config if you use the file tier. Both are covered
in the [migration guide](https://gina.io/docs/migration).

- **Security — an engine.io socket's session is now proven, not claimed.** A socket's `sessionId` — the value every targeted `self.push()` matches against — was set from `payload.session.id`, a field the browser sends, on every message, and was never checked against the connection's own session. Any client could therefore claim another user's session and receive the pushes addressed to it; and because a rendered page carries the *bare* session id in its bootstrap script while the cookie carries the signed form, doing so took strictly less than stealing the cookie the signature exists to protect. The binding now happens once, at connection, from the upgrade request's own cookie: gina replays the bundle's own session middleware over that request, so the same secret, store and cookie name apply with no new configuration and no framework access to your secret — and it works whether or not the bundle adopted `gina.plugins.Session()`. The response handed to that middleware is inert, so a socket upgrade can never emit `Set-Cookie` or persist a session. It fails closed: no session middleware, no cookie, or a cookie that does not verify leaves the socket with no id, and an id-less socket matches no targeted push. A client that still asserts an id is logged and ignored, which doubles as an impersonation detector. No code change is needed — but because the failure direction is silence rather than an error, verify your targeted pushes still land.
- **Added — `gina.pushToSession()`, a sanctioned push from outside a request.** `self.push()` needs a live request-bound controller, so a `lib/job` handler, a cron tick or a boot hook had no route to a user's socket at all — and the pattern reached for instead, a worker making an HTTP hop carrying the session id in the request body, *was* the flaw `0.6.8` closed. This is the replacement `0.6.8` promised, and it is deliberately narrow: the recipient is a required argument, an absent or empty `sessionID` is an error rather than a fan-out, and no broadcast is reachable from this API at all (a deliberate all-clients send stays in-request as `self.push(payload, { broadcast: true })`). Source the recipient from server-held state — round-tripping a recipient id, or a token naming one, through the browser hands the choice back to the caller and re-opens the same flaw one layer up. Delivery is reported rather than assumed: `callback(err, { delivered })` fires exactly once with the number of sockets written, and `delivered: 0` is a normal outcome, not an error. Errors carry a machine-readable `err.code`. Requires the `isaac` engine with `server.ioServer` attached; also available as `lib.push.toSession()`.
- **Added — a bundle can declare which scopes it is deployed in.** An optional `scopes` allow-list on a bundle's `manifest.json` entry replaces the all-or-nothing choice between "registered everywhere" and "not in the manifest at all". The motivating case is a bundle you are still building: `"scopes": ["local"]` keeps it running locally while every other scope behaves as though it does not exist. An absent or null key means every scope, so existing manifests are completely unaffected; an empty array parks the bundle everywhere; a non-array value is reported as a manifest error by name. How an exclusion is reported depends on whether you asked for it — the boot and `gina project:build` skip an excluded bundle with a notice, so one parked bundle never blocks a project build, while starting it or naming it in `gina bundle:build --scope=` is refused by name, because silently producing no artifact would read as success in a deploy script.
- **Fixed — `engine: "express"` bundles boot and serve on Express 5.** Express 5 broke the engine twice over: its router rejected the bare-string `'*'` catch-all at mount time, so the bundle aborted before ever listening, and it turned `req.query` into a prototype getter, so even past the mount every request died on the framework's strict-mode query assignment. Both are fixed, and the supported range is declared for the first time — `>= 4 < 6`, with both majors verified live. An out-of-range major logs a loud warning but still boots, since a wrong refusal is a total outage while a wrong warning is a log line. Express remains yours to provide: it is deliberately neither a dependency nor a peer dependency.
- **Fixed — `project:add` / `project:import` no longer rebuild the `bundles` block destructively.** Any mismatch between the declared bundle count and what was on disk made those commands empty the whole block and rebuild it from the directory listing — dropping every key the rebuild template does not carry (the new `scopes` allow-list, `gina_version`, any custom key) and resetting each bundle's version, tag and release targets. The reset hit *every* registered project on the machine, not just the one being named: a bystander project got no rebuild at all and was left with a permanently empty `bundles` block that fails its next boot. The manifest is now the authority — declared bundles are preserved untouched, bundles found on disk but missing from the manifest are still registered additively on import, and a declared bundle whose directory is absent is reported with a warning rather than auto-pruned. A related path bug is fixed with it: the rescan built a wrong `settings.json` path for every bundle after the first, so only the first bundle's settings could ever be found.
- **Fixed — registration no longer adopts invalid protocol/scheme declarations, nor reads other projects' bundles.** `project:add`/`project:import` adopted whatever `server.protocol` or `server.scheme` a bundle declared straight into the project's registry lists, unchecked — an arbitrary string became a registered "valid" value, persisted, and `gina image:build` then baked the polluted list into the synthesized image's environment. The same pass also resolved *every* registered project's bundles against the path of the project being added, so when two projects each had a bundle of the same name, one project's declarations leaked into the other's registry entry from a command that never named it. The framework's supported sets are now the authority, a project's lists stay a subset of them, an unsupported value is reported by name and adopted nowhere, and each project's bundles are resolved against that project's own path.
- **Fixed — `project:add` writes the project's `.gitignore`.** The framework has always shipped a `core/template/_gitignore` whose underscore prefix implies a rename at scaffold time, but nothing performed that rename — so the template had zero consumers and every scaffolded project came out with no `.gitignore` at all, leaving the secret-file globs it carries protecting nothing. The copy is skip-if-exists, so your own file is never replaced or appended to, and re-running the command changes nothing.
- **Fixed — a failed file copy can no longer destroy the destination it was replacing.** The path helper's copier — the byte-writer behind `_().cp()` and `PathObject.mv()`, which CLI copy, build and rename paths all ride — wrote directly to the final name and unlinked an existing destination *before* the copy started. Bytes now stage to a temp sibling and publish with an atomic rename, so a reader never observes a partial file and the destination is replaced only on success. A source-side read error is handled instead of killing the process, a failed copy settles its callback exactly once, and failures propagate a real `Error` rather than a plain string. **Contract note:** code matching the exact former failure string now receives an `Error` instead.
- **Fixed — the environment beats the secrets file again, and three malformed `secrets.file` shapes are caught.** The two environment tiers were joined with `||`, and the CLI stores swept `GINA_*`/`VENDOR_*`/`USER_*` values as real booleans — so a key whose swept value was boolean `true` satisfied the short-circuit, `process.env` was never consulted, and the file tier won over a perfectly good environment variable, letting a stale plaintext file shadow a platform-injected credential. The tiers are now read independently. **Action required if you use the file tier:** a whitespace-only entry and a path containing an empty segment (`//`) now refuse to boot rather than failing as a suppressed debug line. The empty segment is worth a look — it is what a `${...}` token that resolved to nothing leaves behind, but a token carrying a *trailing slash* produces the same shape and resolves to exactly the intended file, so a config that worked before will now refuse; removing the doubled separator resolves it.
- **Fixed — a bundle whose release tree cannot be linked says which bundle, and why.** The config loader built a useful error carrying the offending path, but the receiving callback never inspected it and dereferenced the absent configuration object instead — so the reason was discarded and the process died on an opaque `TypeError`. Because the configuration load is shared across the project, one bundle's missing release tree took down every bundle in it. The error is now reported through the same sink the bundle-configuration loader already used, naming the bundle, env and scope.
- **Fixed — `self.push()` refuses by name when there is no engine.io channel.** The push channel is an isaac-engine facility, so on the Express engine the client lookup dereferenced an absent `eio` and surfaced as an opaque 500 that named neither push nor the missing channel. It now warns, hands a supplied callback a `PUSH_CHANNEL_NOT_CONFIGURED` error, and sends nothing — without failing the request, so a notification side-channel no longer takes down the response it rode in on. This is also the first time `push()` honours the `callback(err, result)` contract its documentation always described.
- **Fixed — the port-setup merge read the wrong list.** The pass that folds newly seen protocols and schemes into a project's registry lists indexed the project's own list by the contextual list's position, so once the contextual list outgrew it the overshoot read `undefined`. No user-visible consequence was demonstrated, so this ships as a correctness fix.

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
