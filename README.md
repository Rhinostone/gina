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

## What's in 0.6.3

> **Re-bake your bundles, not just restart them.** The browser bundle changed in
> this release. Several of the fixes below — the client-side validator work, the
> boot-time routing fetch guard, and the new navigation module — ship *only* in
> the bundle, so a restart alone will not deliver them. Rebuild each bundle
> (`gina bundle:build`) as well as restarting.

> **No settings reset.** `0.6.3` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

> **Two enforcement tightenings to review before upgrading.** Several validator
> fixes convert silent passes into real verdicts: rules authored on
> bracket-notation keys now enforce server-side, `isBoolean` and `isInteger`
> stop accepting values they used to coerce, and required radio groups now gate
> submission. Forms that relied on the old silent behaviour will start rejecting.
> Each bullet below discloses its direction; the [Changelog](./CHANGELOG.md) has
> the per-rule detail.

- **Added — opt-in SPA-style client-side navigation.** A route can now declare `negotiate: true` in `routing.json`; a request carrying `X-Gina-Navigate: fragment` then receives that route rendered **without its layout** — the content region alone — over the same URL, with no second route, duplicated controller or query-string convention. The new `gina/nav` module turns that into navigation: a page carrying a `data-gina-nav` region fetches same-origin links as fragments and swaps them in, with history, scroll, focus, title, fragment script re-injection and validator form rebinding handled for you. Every uncertainty — a non-2xx, a timeout, an un-negotiated answer, a JSON redirect — falls back to a normal full-page navigation, and a page without the marker is byte-identical. Negotiable routes advertise `Vary: X-Gina-Navigate` and deliberately opt out of the render cache (the cache key carries no shape dimension, so a stored entry could otherwise replay a fragment to a browser asking for a full page). `{% extends %}` templates render their blocks correctly as fragments via a dedicated cache namespace. Browser-bundled — **re-bake**. (#SPA1)
- **Security — the client-served routing map no longer discloses server-side contracts.** `/_gina/assets/routing.json` is now built from an **allowlist** instead of a denylist: controller dispatch keys (`param.control`/`file`/`path`/`title`), `namespace`, `scopes`, `cache` configuration including invalidation event names, `csrfExempt`, `middlewareIgnored` and `validator::` requirement bodies all stay server-side — and structurally, so does every *future* route key until it is deliberately added to the roster (`schema/routing.json` allows additional properties, which is how several of these reached the wire in the first place). What ships is the measured client contract: `url`, `method`, `webroot`, `bundle`, `hostname`/`host`, the `negotiate` flag, plain-regex `requirements`, URL-placeholder `param` bindings, and a derived `isRedirect` boolean. Client URL building (`getRoute`/`toUrl`, including cross-bundle `rule@bundle` references) is unaffected; **code reading other keys off `gina.config.routing` must move that logic server-side.**
- **Changed — a restart's new route table reaches returning browsers immediately.** `/_gina/assets/routing.json` is now served with a per-variant weak `ETag` and `cache-control: no-cache` (was `max-age=86400`) on both engines, so each page boot revalidates with one conditional GET — normally answered `304`. Previously a restart's route changes could take up to 24 hours to reach a returning browser. The proxied variant keeps its `private` marking.
- **Fixed — the client routing map serves under every engine, and a failed fetch is no longer installed as the route table.** The maps were built and served by the isaac engine only, so an `engine: "express"` bundle answered a 404 for the URL every browser fetches at boot (#B212). And because `fetch` resolves on error statuses and the framework's 404 page is valid JSON, that answer was silently installed *as* the client routing table, breaking every later client-side `getRoute`/`toUrl`; the boot fetch now checks the status first (#B213). Browser-bundled — **re-bake**.
- **Fixed — server-side validation now enforces rules authored on bracket-notation and nested keys.** Rules keyed `account[username]`, and nested rule trees, were **silently skipped** server-side — fail-open, with no warning, for checks, the `exclude` drop and value transforms alike. Both production wire shapes now join: flat bracket keys and nested objects. Error keys come back under the DOM-name bracket form the client renders against. **Enforcement tightening — a bracket-keyed rule that never fired now enforces**, so a form relying on the old silent skip will start rejecting or dropping those fields. (#B241)
- **Fixed — the validator's empty-value contract is now uniform across every rule.** Five sites tested emptiness with loose equality, so `0`, `-0`, `false` and `[]` all rode the empty bypass: `isEmail`, `isJsonWebToken` and `isFloat` reported such values **valid outright** (a JSON body carrying `{"email": 0}` passed email validation), and `isInteger`/`isNumber` digit bounds were skipped for zero. All five now compare strictly. Separately, `is` (custom condition) and `isBoolean` joined the same contract, so a required-but-empty field records `Cannot be left empty` once rather than a second, contradictory message beside it. **Enforcement tightening** — review `isEmail`/`isJsonWebToken`/`isFloat` fields that can receive a numeric or boolean value from a JSON body, and bounds-carrying `isInteger`/`isNumber` fields that can receive zero. (#B233, #B235)
- **Fixed — `isBoolean` is the single adjudicator on every surface, and `isInteger` bounds enforce on real numbers.** Server auto-validation coerced every non-boolean string to `false` *before* the rule could run, so junk like `nope`, the HTML checkbox default `on`, and the strings `"1"`/`"0"` validated clean and **persisted as `false`** — and the number `1` stored as `false`. The engine now accepts `true`/`'true'`/`1` and `false`/`'false'`/`0` and errors on anything else, matching what the routing requirements surface always enforced and the reference always promised. Likewise `isInteger`'s digit bounds were silently ignored whenever the value arrived as a real number rather than a string — from a JSON body, a `validator::{}` requirement, or a preceding `toInteger` — and now measure the string form, as `isNumber` always has. **Enforcement tightening in both cases.** (#B236)
- **Fixed — a `$` token in a rule no longer crashes the whole validation pass.** A rule set still carrying a `$` after field substitution — a regex end-anchor in an `is` condition (`/^(alpha|beta)$/`), a `$` inside a human-readable message, or a `$` in a later array element — threw a `TypeError` on the server, because a DOM-fallback substitution loop bare-dereferenced a DOM the server does not have (#B234). And an array-form rule whose first argument carries a `$` token resolving to no field threw on **both** client and server; such a token now stays literal, so `isInList: ['$100', '$200']` accepts the literal `$100` and rejects a non-member with the rule's own message (#B239). No rule set that already validated changes verdict.
- **Fixed — required radio groups now gate, and the submit trigger re-enables on a pick.** No collector admitted a radio group with no checked member, so an `isRequired` rule on the group never ran — and a form whose only named controls were radio groups **skipped client validation entirely** and submitted its XHR unvalidated (#B221). With that fixed, a second defect surfaced: the radio live-check listener was registered under an event name nothing dispatches, so picking a value never re-ran the pass and the trigger kept its `aria-disabled` state while submit-time validation let the send through anyway (#B228). **Enforcement tightening — forms that silently submitted with nothing picked now genuinely gate on the pick.** Browser-bundled — **re-bake**.
- **Fixed — a field that drives its own `_case_` block is validated, and keeps the value the user picked.** When a rule file declared both a rule for a field and a `_case_<field>` block keyed on that same field, the client validator skipped that field entirely in every whole-form pass, so a required radio group selecting its own case was never adjudicated (#B229). Separately, any such driver except the last-declared had its collected value dropped mid-pass, and later readers re-read it from the DOM — for a radio group, the *first* member regardless of which was picked — so conditions could match a choice the user never made (#B230). Browser-bundled — **re-bake**.
- **Fixed — a rejected submit no longer kills a form's live check for the rest of the page's life.** The submit path arms an internal latch before validating, but only the XHR settle cleared it — and a rejected submit renders errors without sending anything. One invalid attempt therefore swallowed every later keystroke and left the trigger `aria-disabled="true"`, hard-blocking keyboard and assistive-technology users while mouse users saw a disabled-looking trigger that still submitted. Rebinding the form did not restore it either. Browser-bundled — **re-bake**.
- **Fixed — the documented `setFlash` `[null, "message"]` form works in the browser.** `lib/merge` classified a `null` array element as an object (the `typeof null` trap) and refused to carry it through no-override merges, so the client received a one-element array, bound the message to the ignored first argument and rendered the built-in label instead. Merges now preserve `null` array elements framework-wide. (#B226)
- **Fixed — `pauseRequest()`/`resumeRequest()` replay the byte-exact halted URL, query string included.** The recomposed replay URL only carried query keys declared in *both* a rule's `requirements` and `param` blocks, so a key bound in `param` only — or an entirely undeclared one like `?returnTo=…` — was dropped; the replay then matched anyway and rendered literal `:key` template paths as a **500**, including on the framework's own `requireAuth` login replay (#B215). And on the isaac engine the snapshot itself was path-only, since the engine strips the query from `req.url` before controllers run (#B219). Both engines now replay the full URL, verified over HTTP/1.1 and HTTP/2. Middleware comparing `haltedRequestUrlResumed` to `req.url` by equality should compare against `req.originalUrl || req.url`.
- **Fixed — `Controller.store()` publishes each file atomically and surfaces the real error.** Failures were reported as a fabricated `No file to upload` Error, masking the actual ENOSPC/EACCES/ENOENT diagnostics; a source-side stream error had no listener at all and **killed the bundle process**; a destination failure unlinked the caller's staged source file after the failed move and settled the callback a second time as a success; and the copy streamed straight to the final name after pre-deleting any existing destination, so a concurrent reader could observe a truncated file. Each file now streams to a temp sibling and is published with an atomic rename, the callback settles exactly once with the real Error, and a failed move leaves both the staged source and any pre-existing destination intact. (#B223)
- **Fixed — custom error pages answer with their real HTTP status.** A page configured through the routing error param / `errorFiles` mechanism was rendered with **status 200** by the nunjucks and async render delegates, so a configured 500 or 404 answered 200 on the wire (#B190). Separately, the custom-error renderer discarded its resolved error template whenever the dispatch reset flag was absent, so the delegates fell back to the failing route's own file and produced a bare-path "could not open" error plus a routing-rule dump that misdirected diagnosis. The resolved template now reaches the render unconditionally, the dispatch works on a clone rather than mutating shared routing configuration, and an unopenable error template falls back to the built-in page naming the template.
- **Added — the `Cache-Status` identifier is configurable.** `server.cache.name` sets the RFC 9211 identifier the render/output cache reports on the wire (default `gina-cache`; byte-identical when unset). With `server.hidePoweredBy` true and the cache enabled, leaving it unset now logs a boot warn naming the remaining framework disclosure — set any token to close it, or explicitly `gina-cache` to keep the current wire and silence the warn. Resolved once at boot, so it can never disagree across engines or between hit and miss. (#B238)
- **Fixed — session stores no longer write an immortal record for an already-expired session.** When the resolved TTL is ≤ 0 — a cookie `maxAge` of 0, or the decaying remainder truncating to zero in a session's final second — `set()` is now a no-op in every store. Previously redis wrote an expiry-less `SET` and the couchbase and scylladb stores stored the record with a **zero (never-expires) expiry**, leaving a zombie session that still validated if its id was replayed. **Behaviour change:** a configured `ttl: 0` now refuses at bundle init naming the offending channel, instead of silently behaving as unset.
- **Fixed — Couchbase: an unserializable query parameter no longer kills the bundle, and range SDK pins resolve.** A parameter the SDK cannot serialize (a bare `undefined`, a function, a Symbol) made the native driver abort the process from an internal thread — uncatchable by `try/catch`, `uncaughtException` or `unhandledRejection` — so the bundle **died outright** instead of the request failing with a 500. The most reachable case needed no misuse: a query method called one argument short with a trailing callback put the *callback* into a parameter slot. The connector now refuses it before dispatch with a `GINA_COUCHBASE_UNSERIALIZABLE_PARAM` TypeError naming the position and likely cause (#B243). Separately, the SDK-major resolvers now take the pin's first integer, so range pins like `~4.5.0` or `>=4.5` no longer mangle, slip past the v2 floor and refuse to boot with a misdirecting error.
- **Added — a Couchbase SDK soak harness.** `script/soak/couchbase-soak.js` screens an SDK candidate against a caller-chosen Couchbase Server before a consuming project adopts it: it scaffolds a fully isolated throwaway project (your real `~/.gina` and projects are never touched), installs the candidate, and drives N1QL entity queries, KV through the entity collection handle, and the express-session store under sustained concurrent load — targeting the silent-death class where a process dies with no JS stack. A generic soak is a screen, not proof: run it as the first filter on an SDK bump. (#CN12) The published `schema/connectors.json` description of the couchbase `useScopeAndCollections` option was also corrected — it claimed to enable scope/collection support while the option is accepted but currently inert.
- **Fixed — `lib/math` `checkSumSync`, three defects.** Every **array** input collapsed to the checksum of the empty string (the serializer assigned to the wrong variable), and the caller's array was sorted in place (#B208). Any input whose serialized form ended in a dot plus three lowercase letters — an email domain, a URL, a filename mentioned in text — was passed to `fs.readFileSync` and threw ENOENT, with the error naming the caller's own data as a path (#B209). And real file paths whose extension was *not* exactly dot-plus-three-lowercase were hashed as path strings, never tracking content (#B210). **Stored checksums change** for arrays and for those file paths.
- **Fixed — `GINA_*` environment variables are visible everywhere they should be.** `GINA_HOMEDIR=/path gina env:list` now resolves the home directory, settings file and host from that value during the CLI's own bootstrap instead of falling back to the default home — no more null-laden seeded settings, no more `Cannot override Env variable` warnings, and no junk `gina` variable leaking into every spawned child's environment. The MQ speaker and file logger containers now honour `GINA_HOMEDIR` too, instead of silently mixing an isolated home with the real home's MQ port and host. `${secret:GINA_*}` placeholders resolve in CLI contexts (`mcp.json`, connector CLI commands, `audit:verify`). And the MCP HTTP transport's dead `GINA_HOST_V4` bind tier is replaced by `GINA_BIND_HOST` read through the framework environment, so a connect address can no longer become the bind.
- **Fixed — a sub-directory in the configured run directory no longer aborts every gina command.** The `framework:init` pid cleanup read every entry as a pidfile with no guard, so one unreadable entry threw `EISDIR` out of the loop and failed the whole command. Unreadable entries are skipped — and deliberately never pruned, since stale-pidfile removal is only safe for entries actually read.
- **Inspector — bundle-following, per-tab restore, and six scope/display fixes.** The Inspector now **follows the monitored tab across bundles** of a proxy-routed multi-bundle project, re-pointing its server-side channels at the bundle actually serving the page, so the Flow and Query tabs stop reporting "No timeline data" for every page served by a bundle it was not opened from (#B205). A window opened by direct URL or bookmark now adopts the statusbar-advertised tab channel instead of silently falling back to bundle-global data, with a new footer badge naming the active mode (#B231), and warmed (hover/focus-preloaded) popin opens now set the XHR overlay exactly as cold opens always did (#B225). Hidden tabs can be restored **one at a time** by clicking their dimmed preview pill. Also fixed: the tab-layout preview rendered the two newest tabs as literal "undefined" and silently rejected custom layouts above six tabs; the Query pane and its badge froze on the first page whose queries lacked index data (#B222); multi-index Couchbase queries were reported as "no index — full bucket scan", inviting a needless index build for an already-fully-indexed query; and the footer memory gauge's unfilled track was invisible in both themes (#B237). Dev-tool only — reopen the Inspector window.
- **Fixed — `bundle:openapi` and `bundle:mcp` no longer drop three declared bound forms.** Un-collapsing a `validator::{}` routing requirement into a parameter schema silently discarded them: scalar `"isString": N` now maps to `minLength`, and `isInteger`/`isNumber` digit bounds reach the schema as a human-readable `description` plus a machine-readable `x-gina-digitBounds` extension. They are deliberately *not* emitted as `minimum`/`maximum` (wrong for any negative value, whose sign counts toward the length) nor `minLength`/`maxLength` (string-only keywords, inert on numeric types). Schemas generated from bare `true` rules are byte-identical.
- **Fixed — the scaffolded bundle template taught an impossible session-store selection.** `bundle:add` emitted `expressSession.name = 'myRedis'` — `Function.prototype.name` is read-only, so the assignment silently no-ops and the factory always resolved the literal `"session"` entry, meaning the template's own `"myRedis"`/`"myDb"` examples could never be found and boot failed with `[SessionStore] Could not be loaded`. The template now shows the documented shape: one `connectors.json` entry named `"session"` whose `connector` field selects the backend.
- **Changed — the dormant transitive `object-assign` dependency is overridden.** `engine.io` → `cors` → `object-assign@4.1.1` (unmaintained since 2017) is replaced by `@socketregistry/object-assign` via npm `overrides`, with zero runtime change. **Scope, so nobody reads more into this than it does:** npm and bun alike honour `overrides` only in a project's *own root* manifest, so this cleans the gina tree and **not your install** — a project depending on gina still resolves `object-assign@4.x` beneath `cors`. Add the same `overrides` entry to your own root `package.json` to get it in your tree; the consumer-reaching fix is upstream ([expressjs/cors#430](https://github.com/expressjs/cors/pull/430), filed).

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
