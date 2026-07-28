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

## What's in 0.6.0

> **Two behaviour changes to check before upgrading.** Neither refuses a boot,
> but both change how an untouched bundle behaves. Session records in the redis,
> sqlite, mongodb and scylladb stores now follow the session cookie's `maxAge`
> when no `ttl` is configured, instead of an implicit one-day cap — lifetimes
> move in **both** directions, so set an explicit `ttl` if you relied on the old
> 24-hour behaviour. And `req.logout()` now destroys the whole session record
> rather than only clearing `req.session.user`, so review any flow that expected
> other session keys to survive logout. See the
> [migration guide](https://gina.io/docs/migration) for each.

> **Action required — settings reset.** `0.6.0` is a shortVersion bump (`0.5` →
> `0.6`), so on install the framework creates a fresh `~/.gina/0.6/settings.json`
> from defaults — your `~/.gina/0.5/settings.json` customizations (log level,
> port, culture, timezone, etc.) are **not** carried forward. Re-apply them with
> `gina framework:set`, or copy the values across. Root-level state
> (`~/.gina/main.json`, `projects.json`, `ports.json`, `gina.db`) is shared
> across short versions and is unaffected.

- **Added — a tamper-evidence hash chain for the audit trail.** Opt in with `audit.chain.enabled: true` and a signing key (`audit.chain.secret`, a literal or a `${secret:VAR}` placeholder, or `GINA_AUDIT_SECRET`) and every record gains a `hash` chaining from its predecessor — `HMAC-SHA256(secret, previousHash + canonical(record))`. The new offline `gina audit:verify <bundle> @<project>` walks the trail and reports either the intact totals or the first break with its line and reason, exiting non-zero when the chain is broken. This detects any post-hoc edit, deletion, insertion or reordering by someone who does not hold the signing key; it is deliberately *not* a defence against the process that writes the records, which holds the key — for that adversary, stream the trail to WORM / Object-Lock storage as the compliance guide describes. Two boundaries are stated rather than implied: truncation at the exact tail is invisible to the chain (read the record count), and an empty trail verifies trivially. The boot refuses the deployment shapes a single linear chain cannot hold — no signing key, a connector `store` backend, or two bundles chaining into the same `audit.file` — so a chain that cannot be trusted never starts silently. Server-side — restart your bundles. (#COMPLY2)
- **Added — `lib.authn`, the authentication primitives that are dangerous to hand-roll.** `hashPassword` mints scrypt hashes as self-describing PHC strings (`$scrypt$ln=17,r=8,p=1$<salt>$<key>`), so the cost travels with the hash and can be raised later without a flag day. `verifyPassword` compares in constant time and *also* verifies existing `$argon2*$` and `$2a/2b/2y$` (bcrypt) hashes through your own project's package, so a bundle arriving with credentials already hashed keeps working; paired with `needsRehash`, a successful login upgrades them transparently and the store migrates itself with no password resets. `dummyVerify` spends matching work on the account-not-found branch to close the user-enumeration oracle — always pass `{like: <a stored hash>}` so the cost is read from real data. `validatePasswordPolicy` checks length first per NIST SP 800-63B (12 characters, no mandatory character classes by default). `createLockout()` adds the credential-stuffing brake, defaulting to PCI-DSS v4.0.1 §8.3.4 — 10 consecutive failures, 30 minutes — serialized per key so concurrent failures cannot lose the count, with one `auth.lockout` audit record on the transition. And `generateTotpSecret` / `otpauthURL` / `generateTotp` / `verifyTotp` implement RFC 6238 for a second factor; replay defence is yours, and the returned `counter` is what it needs. Gina still owns no user record, credential store or login route — these are helpers, not an identity provider. Server-side — restart your bundles. (#COMPLY3)
- **Added — `req.login()` works for gina-native bundles and rotates the session id.** Previously the login shim only served Passport bundles; without Passport it threw, so native bundles bound the user by hand with no rotation at all. The native branch now regenerates the session — destroying the pre-login record, the session-fixation defence — binds the principal at `req.session.user`, stamps the absolute-timeout anchor, persists, and reports through the required callback; where the session provider exposes no `regenerate()` it binds without rotation and warns. Anything stored in the pre-login session is destroyed by the rotation: read it before the call and re-set it in the callback if it must survive. Outstanding CSRF tokens re-derive from the current session id on the next response, and Passport bundles are untouched. Server-side — restart your bundles. (#COMPLY4)
- **Added — an opt-in absolute session timeout.** `session({ absoluteTimeout: <ms> })` on the Session plugin, or `settings.json > session.absoluteTimeout` as the deployment default with bundle code winning (`absoluteTimeout: false` disables it). An authenticated session older than the cap — measured from login, not from last activity — is destroyed on its next request and the request proceeds with a fresh anonymous session, exactly as a naturally-expired record behaves. Fail-closed: when the record cannot be destroyed the authentication is still dropped. This is the fixed-cap half of session-lifetime control; idle expiry already existed (the cookie `maxAge` and the store-record TTL both roll with activity) and composes with it. Anonymous sessions are never touched, preserving `saveUninitialized: false` semantics. Declared in the published settings.json schema. Server-side — restart your bundles. (#COMPLY4)
- **Security — `req.logout()` destroys the persisted session record.** It previously only cleared `req.session.user`: the store record, the session id and every other session key survived to TTL, so a leaked or intercepted session id stayed valid server-side long after the user logged out. It now calls the session's own `destroy()` when one is exposed, degrades gracefully when it is not, and accepts an optional callback — `req.logout(function (err) { … })`. **Review flows that relied on other session keys surviving logout: the whole record is gone afterwards.** The session cookie stays yours to expire (its name is not discoverable by the framework), and Passport bundles are unaffected — the shim never installs when Passport is initialized.
- **Fixed — co-located CLIs reach the control plane again.** 0.5.26's loopback bind default carried a dial-side regression: CLI-side clients (the command socket, the MQ speaker and file log containers, and `gina tail`) dialled `host_v4` while the daemon binds `bind_host`, so any deployment whose `host_v4` is a non-loopback address of the same machine — the common containerized shape — could not reach its own daemon, and `bundle:start` aborted before the HTTP server ever bound. Clients now resolve the dial host through a locality check: a `host_v4` naming one of the machine's own interfaces dials the bind address, while a genuinely remote `host_v4` is dialled unchanged. The bind side is untouched, so nothing is newly exposed, and the connection-refused error now names both the dial target and the `bind_host` knob. If you applied the `GINA_BIND_HOST=0.0.0.0` workaround purely to un-break co-located CLIs, you can drop it after upgrading. (#B160)
- **Fixed — `gina framework:set --bind-host=` now persists.** The value was silently reverted to the loopback default by the very next CLI invocation — the settings regeneration had a disk-to-env read-back for every connection key except `bind_host` — and again by every container bootstrap, which rewrote settings.json with a hardcoded value. The persisted value now survives both paths; `GINA_BIND_HOST` still takes precedence when set. (#B161)
- **Fixed — session records honour the cookie `maxAge`.** In the redis, sqlite, mongodb and scylladb stores an implicit one-day default made the cookie-`maxAge` fallback in `set()` / `touch()` unreachable, so a record's lifetime ignored the session cookie unless a `ttl` was configured explicitly — a 1-hour cookie left its record alive server-side for 24 hours, and a 7-day cookie was silently cut to 24 hours. When neither the store options nor the connectors.json entry sets a `ttl`, the record TTL now follows the cookie's `maxAge` (one day only when the cookie has none), matching the Couchbase stores. An explicitly configured `ttl` still wins. **Note this moves record lifetimes in both directions** relative to the old accidental 24-hour cap. (#B163)
- **Fixed — the SQLite session store no longer expires the session it was asked to refresh.** `touch()` stamped `now + ttl` without first checking the resolved ttl — and express-session's `cookie.maxAge` is a decaying remainder, which truncates to zero in the final second and turns negative once expired — so a session near its expiry had an already-past expiry written to it and ended early. It now performs no write and returns cleanly on a non-positive ttl, matching the redis, mongodb and scylladb stores which already guarded this. (#B166)
- **Fixed — the Couchbase session store's `lastModified` is refreshed and UTC.** An internal idle check compared an elapsed value in milliseconds against a TTL in seconds, so it fired roughly 1000× sooner than intended and left `lastModified` un-refreshed on most calls — even though every `touch()` extends the document's expiry regardless. The stamp now tracks each extension, keeping the client-side session countdown measuring from the right origin. The SDK 4 store additionally writes it as an ISO 8601 UTC string, matching the redis, sqlite, mongodb and scylladb stores; it previously wrote a zone-less local-time value that the browser re-parsed in its own timezone. (#B165)
- **Fixed — the Couchbase session store requires its open bucket explicitly.** It now takes `options.db` — the already-open bucket the model layer creates from the `session` connector entry (`getModel('session').getConnection()`) — and fails fast with an actionable error when it is missing or is not a bucket, instead of crashing at bundle init inside a dead self-connect path that called the SDK v2 `openBucket()` API, absent from the supported v3 and v4 SDKs. The connection options that only fed that dead path (`host`, `hosts`, `username`, `password`, `bucket`, `cachefile`) were removed with it. No working deployment is affected — the path they fed could not succeed on a supported SDK. (#B167)
- **Fixed — server-side `getRoute()` no longer crashes when no proxy hostname is resolvable.** With the worker-wide proxied latch set but both proxy-hostname sources unset — the boot-time global and the per-render `envConf` fallback, each of which the framework itself can legitimately leave empty — every `getRoute()` call threw a `TypeError`, taking down any render or readiness probe that resolved a route. The route now degrades to its direct hostname and `route.isProxyHost` flips false, so `toUrl()` cannot stringify an unset value into the emitted URL; a once-per-process warning names the degraded state. The `url` template filters hold `getRoute()`'s own resolution so their per-request override can never replace a usable value with an unset one. Server-side — restart your bundles. (#B168)
- **Fixed — the JSON schemas now describe the `audit` and `session` blocks.** All five audit keys (`enabled`, `file`, `store`, `actorKey`, `events.authz`) and the three consumed session-cookie keys (`sameSite`, `httpOnly`, `secure`) were undeclared, so an editor offered no completion, no type checking and no description on hover, and a mistyped key surfaced only as a boot refusal at the next restart. Each declaration mirrors the corresponding boot lint or factory-time validation rather than merely permitting the keys, and rejects unread keys — putting `maxAge` or a store `ttl` under `settings.json > session` has never had any effect, and an editor now says so. Separately, the `connectors.json` schema no longer labels the session-store `ttl` and `prefix` keys "Redis only" — `ttl` is read by the redis, sqlite, mongodb and scylladb stores and `prefix` by redis and sqlite — and its stale `86400` default is gone. Runtime behaviour is unchanged; the schemas are editor tooling, never enforced at boot.

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
