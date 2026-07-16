# Gina

[![npm version](https://img.shields.io/npm/v/gina)](https://www.npmjs.com/package/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket](https://img.shields.io/badge/Socket-view%20analysis-blue)](https://socket.dev/npm/package/gina) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Bun >= 1.2](https://img.shields.io/badge/Bun-%3E%3D%201.2-brightgreen)](https://bun.sh) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Documentation:** [gina.io/docs](https://gina.io/docs/) · **Issues:** [GitHub](https://github.com/gina-io/gina/issues) · **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

Node.js MVC framework with built-in HTTP/2, multi-bundle architecture, and scope-based data isolation — no Express dependency.

- **HTTP/2 first.** Built-in `isaac` server with TLS, h2c, ALPN, HTTP/1.1 fallback, and full CVE hardening (Rapid Reset, CONTINUATION flood, RST flood, HPACK bomb) — all on by default.
- **Multi-bundle.** One project hosts multiple independent bundles (API, web, admin, …). Each bundle has its own routing, controllers, models, and config. Share code via the project layer.
- **Scope isolation.** Run `local`, `beta`, and `production` from the same codebase. Scopes propagate through routing, config interpolation, and data (every DB record is stamped with `_scope`).

## Features

| Feature | Detail |
| --- | --- |
| HTTP/2 server | Built-in `isaac` engine — TLS, h2c, ALPN, HTTP/1.1 fallback, 103 Early Hints, CVE-hardened |
| Multi-bundle | One project, N independent bundles with shared config and project layer |
| Scope isolation | `local` / `beta` / `production` — per-request and per-record |
| MVC routing | `routing.json` — declare routes in config, not code; O(m) radix trie lookup |
| Async/await | Controller actions can be `async`; rejections routed to `throwError` automatically |
| ORM / entities | EventEmitter-based entity system; SQL files auto-wired to entity methods |
| Connectors | Couchbase, MongoDB, ScyllaDB / Cassandra, MySQL, PostgreSQL, Redis, SQLite, AI (LLM) — loaded from project `node_modules` |
| AI connector | Any LLM provider via named protocol (`anthropic://`, `openai://`, `ollama://`, …) |
| Template engine | [`@rhinostone/swig`](https://github.com/gina-io/swig) 2.7.2 — maintained fork with CVE-2023-25345 patched; streaming SSE/chunked via `renderStream()`. Nunjucks supported as opt-in via `render.engine = "nunjucks"` or per-section `"ext": ".njk"` |
| Internationalisation | Per-bundle JSON catalogs, `t()` helper, swig + nunjucks `t` filter, CLDR plurals, ICU MessageFormat opt-in via `t.icu()` |
| Observability | Built-in `/_gina/metrics` Prometheus endpoint (opt-in, IP-allowlisted) — Node.js process metrics + HTTP counter / duration histogram with cardinality-safe route labels |
| Hot reload | WatcherService evicts `require.cache` only on file change — zero per-request overhead in dev |
| K8s ready | `gina-container`, `gina-init`, SIGTERM drain, JSON stdout logging |
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

## What's in 0.5.18

- **Added — a shared redis L2 for the render cache, and pluggable cache backends.** `server.cache.type` now sets a bundle's default output-cache backend (`memory`, `fs`, or `redis`) and a route with `cache` set inherits it, alongside new bundle-wide `sliding` / `maxAge` fallbacks (per-route values still win). The `redis` tier caches rendered output in a shared store, so several replicas serve the same rendered page and a freshly-started replica serves what a peer already rendered (cross-replica cold-start): writes go to the in-process L1 synchronously and to redis fire-and-forget (the response never waits on redis), an L1 miss warms back from redis with the authoritative remaining TTL, invalidation propagates, and a down or failing redis degrades to per-replica caching (fail-open). The bundle validates its cache configuration at boot and refuses to start on an unsupported shape. New bundles default to `memory`; existing installs are unchanged.
- **Added — type-safe DTOs and a default-on validation pipe.** `gina.dto` lets you author a data shape once and project it four ways: runtime validation, response shaping, JSON Schema (draft-07 or 2020-12), and TypeScript. A `routing.json` rule declaring `param.dto` has its payload validated before the controller action runs — a clean, localised 422 on failure, a type-coerced payload on success — and `param.responseDto` shapes the outgoing JSON so a field marked `.exclude()` never reaches the wire. `gina bundle:types <bundle> @<project>` emits declarations from those same DTOs, and `bundle:openapi` / `bundle:mcp` now emit real request/response schemas instead of `.*`. DTOs are resolved at bundle boot, so a missing one fails the boot instead of silently disabling validation; routes that declare no DTO are unaffected.
- **Added — `releaseWatch`, a stale built-release watch for local production rehearsals.** A bundle serving a built release under `local` scope + a non-dev env has no hot-reload, so after you edit source it silently keeps serving the stale build. Opt in via `server.releaseWatch`: the bundle fingerprints its source tree against the manifest release stamp (now written by `bundle:build` / `project:build`), surfaces staleness on `GET /_gina/release/status` and a `GET /_gina/release/events` SSE stream, and rebuilds on `POST /_gina/release/rebuild` with an **idle-gated restart** that waits on in-flight requests and `gina.registerBusyProbe` application probes. Rendered pages carry a live shadow-DOM banner offering one-click rebuild-and-reload, and `restartMode: supervisor` suits a daemonless container launch (drain, then exit(0) for an orchestrator to respawn). Hard-gated on local scope + a non-dev env — byte-inert everywhere else.
- **Added — flush or event-evict the render cache from outside the bundle.** `POST /_gina/cache/clear` (both engines, loopback-gated) and a new `gina cache:clear [<bundle>] @<project>` CLI flush the rendered-output cache — without ever touching compiled templates or HTTP/2 sessions — with `--dry-run` and `--format=json`. `?event=<name>` evicts by event: a controller's `self.cache.invalidateByEvent()` only reaches its own process, so this is how one bundle's write invalidates another bundle's cached pages. Note `?event=` previously went unread, so passing it flushed *every* bundle's output cache; it is now honoured.
- **Added — two-tier render-cache observability.** Every cache hit's `Cache-Status` header now carries an RFC 9211 `detail` parameter naming the physical tier that served the bytes — `memory` for the in-process L1, `redis` for a shared-L2 warm (the cross-replica cold-start, visible per request), `fs` for a disk read-back after a restart — and `/_gina/cache/stats` gains an `l2` block reporting the redis store's connection health, with no network round-trip on the admin path.
- **Changed — render-cache keys are release-namespaced, so an upgrade auto-invalidates.** The cache key *and* the `fs` cache path now carry a release namespace — `GINA_CACHE_NAMESPACE` (an id you set, such as a git SHA or build number) when present, otherwise the framework version — so a new build never serves a page cached by old code. `fs`-cached files from a superseded namespace are orphaned on disk until cleared. Dev mode is unaffected (it runs cacheless).
- **Changed — the `Cache-Status` miss form follows RFC 9211.** It is now `gina-cache; fwd=uri-miss` (previously the bare `gina-cache; uri-miss`, which read as an unregistered parameter to RFC-aware tooling), and the engine-agnostic read path emits it on a genuine both-tier miss — giving Express bundles their first cache-miss signal on the wire.
- **Fixed — event-driven cache invalidation now works, and a cache fault no longer discards a good page.** A route's `cache.invalidateOnEvents` was registered but nothing ever fired it — the documented `self.cache.invalidateByEvent()` did not exist, so configured routes served stale content until their TTL expired. `self.cache` now exists on the controller and reports the number of entries evicted. Three further defects in the same path are fixed: re-registering a key carrying a querystring **threw** (the registry ran cache keys through a condition evaluator, where `?`/`=` parse as operator tokens) and under the swig engine that throw unwound to the top-level error handler, which answered 500 and discarded a page that had already rendered; registrations were never reclaimed, so the registry grew a row per cache-miss re-render; and an `fs` entry read back after a restart carried no registration at all. Separately, a failed cache **write** now degrades exactly as the nunjucks and JSON renderers already did — the response is served, the failure logged, and the next miss retries.
- **Fixed — the `fs` render cache survives a restart.** An `fs`-cached response written to disk was previously orphaned on the next boot (the in-process index starts empty), so it was never served again and its file was never cleaned up — `fs` behaved no better than `memory` across a restart. The read path now falls back to disk on an index miss, replaying the entry from a `.meta` sidecar and preserving the **original absolute expiry**, so a restart never extends a TTL. Entries expiring on their timer now run the same cleanup as a manual eviction, instead of stranding their body and sidecar on disk.
- **Fixed — a checkbox's `value` attribute no longer decides its `checked` state.** The HTML `checked` attribute alone drives the initial rendering, and the posted boolean is derived from the live checked state rather than the value string — so a consent-style checkbox rendered with `value="true"` is no longer silently pre-ticked, `value="false"` no longer un-ticks a server-checked box, a checkbox unticked from your own script no longer posts `true` off its stale value, and a neutral-valued checkbox with an `isBoolean` rule posts real booleans instead of going dead. The forced rule injection now appends `isRequired` before `isBoolean`, so an unchecked box whose rule declared neither no longer fails with "Cannot be left empty". A transitional per-form opt-in — `data-gina-form-checkbox-value-as-state="true"` (deprecated) — preserves the old value-driven ticking while markup migrates to `checked`, and a once-per-field console warning flags the affected checkboxes. (#49)
- **Fixed — the published TypeScript declarations now describe the runtime.** `import gina from "gina"; gina.lib` previously failed to typecheck for every consumer, because the main entry declared no value at all. The module surface now carries all 78 runtime members including `gina.dto`; `SuperController` gains its i18n / jobs / trailers / events / template-override methods plus `GinaRequest<TDto>` and `req.dto` typing for route DTOs; fictional declarations were removed; and a two-part gate (a consumer fixture compiled by `tsc` through the package exports map, plus a runtime-parity test) keeps the declarations and the runtime in sync.
- **Fixed — errors surface instead of crashing, masking, or coming back as `0`.** A framework error raised from a detached context — a scheduled cron/timer, a worker, or a bootstrap-time `getLib()` — no longer crashes the process with `TypeError: next is not a function` while masking the original error. `getLib()` / `getConfig()` no longer crash with an opaque `Cannot read properties of undefined (reading 'conf')` when configuration is read while the config build is still partway (for example a fail-closed `${secret:KEY}` resolution), so the real boot error surfaces. A bitwise `|` at nine sites across the HTTP server, the browser client bundle, and three CLI commands coerced the Error to the number `0` — a rendered 500 page body and the `protocol:set` / `port:reset` / `project:add` output all reported `0` instead of the cause. And log messages containing a `$` are no longer mangled by the text formatter's `%`-token splice, across every level and sink. (#B108 / #B112)
- **Fixed — two smaller corrections.** A server-side form-validator `query` rule no longer re-points the framework's process-wide cache onto a second Map, so concurrent renders keep reading their cached entries and pooled HTTP/2 sessions land in the real server's cache. And `bundle:openapi` / `bundle:mcp` no longer advertise `.exclude()`d DTO fields in response schemas — the 200 content schema and the MCP tool `outputSchema` now emit the response projection, while request-side schemas keep the declared shape. (#B110 / #B115)

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
