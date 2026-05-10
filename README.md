# Gina

[![npm version](https://badge.fury.io/js/gina.svg)](https://badge.fury.io/js/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![GitHub version](https://badge.fury.io/gh/gina-io%2Fgina.svg)](https://badge.fury.io/gh/gina-io%2Fgina) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket Badge](https://socket.dev/api/badge/npm/package/gina)](https://socket.dev/npm/package/gina)

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
| Template engine | [`@rhinostone/swig`](https://github.com/gina-io/swig) 2.0.1 — maintained fork with CVE-2023-25345 patched; streaming SSE/chunked via `renderStream()`. Nunjucks supported as opt-in via `render.engine = "nunjucks"` |
| Internationalisation | Per-bundle JSON catalogs, `t()` helper, swig + nunjucks `t` filter, CLDR plurals, ICU MessageFormat opt-in via `t.icu()` |
| Observability | Built-in `/_gina/metrics` Prometheus endpoint (opt-in, IP-allowlisted) — Node.js process metrics + HTTP counter / duration histogram with cardinality-safe route labels |
| Hot reload | WatcherService evicts `require.cache` only on file change — zero per-request overhead in dev |
| K8s ready | `gina-container`, `gina-init`, SIGTERM drain, JSON stdout logging |
| Dependency injection | Mockable connectors and config for unit testing |

## Quick start

```bash
npm install -g gina@latest --prefix=~/.npm-global
gina project:add @myproject --path=$(pwd)/myproject
gina bundle:add api @myproject
gina bundle:start api @myproject
open https://localhost:3100
```

## What's in 0.3.11

- **Internationalisation** (#I18N1 + #I18N2) — per-bundle JSON catalogs at `bundle/locales/<culture>.json`, `t(key, params, culture)` global helper auto-bound on controllers (`self.t()`) and as a swig + nunjucks `t` template filter, CLDR plurals via Node's built-in `Intl.PluralRules`, per-request locale negotiation (URL prefix > cookie > `Accept-Language` > settings default). New `gina i18n:scan / add / export / import` CLI for translator round-trip (PO / CSV / JSON). Optional ICU MessageFormat opt-in via `t.icu()` for gender / select / nested combinators powered by `intl-messageformat`. The legacy `__()` placeholder is rewired as a one-arg alias of `t()` — existing callers keep working.
- **Prometheus metrics endpoint** (#OBS1) — built-in `/_gina/metrics` exposing the standard Prometheus exposition format. Default metrics cover Node.js process state (heap, GC, event loop lag), HTTP request counter and duration histogram with cardinality-safe route labels (`req.routing.rule` with `__not_found__` / `__method_not_allowed__` / `__error__` / `__no_route__` fallbacks). IP-allowlist gated (loopback only by default; does NOT trust `X-Forwarded-For`). Opt-in via `app.json metrics.enabled`; install `prom-client` as a peer dependency.
- **ScyllaDB / Cassandra ORM connector** (#CN5) — entity classes with CQL prepared statements at `models/<keyspace>/cql/<Entity>/*.sql`, `@param` type coercion, lightweight-transaction (`IF NOT EXISTS`, `IF version = ?`) `[applied]` boolean handling, and a session store using CQL `USING TTL` for server-side reaping. Wraps the official `cassandra-driver` (Apache Software Foundation; Node.js has no first-party shard-aware driver, so token-aware routing is used). Requires Node 20+.
- **MongoDB ORM connector** (#CN6) — entity classes with JSON pipeline files at `models/<db>/pipelines/<Entity>/*.json`, JSDoc-style `@param`/`@return` headers, BSON-type casting (`objectid`, `int`, `long`, `double`, `boolean`, `date`, `timestamp`), `{$arg: N}` and `{$oid: "<hex>"}` placeholder shapes, eleven supported operations (`findOne` / `find` / `aggregate` / `countDocuments` / 7 writes), and a session store using a TTL index auto-created on first `set()` with `expiresAt > now` filtering on reads to cover MongoDB's 60-second TTL-monitor lag. Wraps the official `mongodb` driver.
- **`@rhinostone/swig` major bump 1.6.0 → 2.0.1** — upstream stable cycle. The framework's Phase 7 build switched from Closure-compiling `bin/swig.js` to copying the upstream esbuild bundle directly, so `swig-core`'s lazy `require()` works in the browser bundle. Resolver `DEFAULT_MIN` floor lifted to `2.0.0` — projects pinning `swig.useProject: true` need a `^2.0.0` install in their own `node_modules` to satisfy the resolver. Server-side API unchanged.
- **`page.section` auto-promotion** — `route.param.section` is now auto-promoted to `page.section` in the controller setup, for templates that compose include paths from a section name (sub-section dispatch from a single `index.html` that fans out to per-section partials based on the matched route).
- **X-Forwarded-Prefix per-request isolation** — fixes a cross-request webroot prefix leak under reverse-proxy sub-path mounts where the prefix was previously stored on `process.gina.PROXY_PREFIX` (process-global, sticky-after-first-request, leaking into direct/non-proxied calls); now per-request on `request._ginaProxyPrefix`. Combined with a synchronous `window.__ginaWebroot` global on the client to fix a `getDependencies` race where `gina.config.webroot` was undefined at script-tag onload time.
- **Release pipeline hardening** — three independent fixes for the `~/.gina/main.json` `def_framework` drift family: defensive pre-publish gate (`script/check_def_framework_consistency.js`), settings.json side fix in `prepare_version.js`, main.json side fix in `post_install.js` with a strict-semver comparator that skips def_framework updates on older-version reinstalls.

## What's in 0.3.10

- **FormValidator HTML5 form-reassociation hardening** — trilogy of fixes for `<input form="X">` controls. `bindForm` now uses `HTMLFormControlsCollection` (`form.elements`) for owner-aware control collection and attaches per-control listeners on out-of-tree reassociated controls; `unbindForm` symmetrically drains the side-table on cleanup. `updateRadio` scopes the mutual-exclusion peer set by form-owner — same-name radios in different form-owners are no longer cross-fired into each other's loop — and reconciles the IDL `.checked` with the HTML `checked` attribute on init when they disagree. `bindForm`'s `fieldsSet[id].defaultChecked` cache reads the IDL `defaultChecked` property (which mirrors the HTML attribute regardless of the live IDL state) instead of the live `.checked`, so a `type="reset"` action correctly restores the originally-checked option. No-op for the normal single-form-owner shape — only changes behaviour in the form-reassociation layouts that were broken.
- **`X-Forwarded-Prefix` reverse-proxy support** — when a reverse proxy (nginx, Traefik) mounts the bundle on a sub-path and forwards `proxy_set_header X-Forwarded-Prefix /sub;`, the framework composes a public webroot (proxy prefix + bundle internal `server.webroot`) and templates it into `gina.config.webroot`. Client-side URL construction (`/_gina/assets/routing.json` fetch, `gina.min.css` link injection, etc.) now targets the correct upstream through the proxy instead of root-relative URLs that route to whichever bundle answered `/`. Header value is normalised (leading slash, trailing slashes stripped, empty / `"/"` dropped); back-compat preserved when the header is absent.
- See 0.3.9 for the consumer-feedback 11-patch batch (per-request middleware dispatch isolation · Couchbase 4.x JsonTranscoder · `length` filter null safety · `process.env` mirroring · 6 nunjucks render-pipeline patches), and 0.3.8 for the install-script regression hotfix.

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

Gina is co-authored by **Martin Luther** ([Rhinostone](https://rhinostone.com)) and **Fabrice DELANEAU** ([fdelaneau.com](https://fdelaneau.com)). Final decisions on direction, API design, and releases rest with Martin Luther. Community contributions and RFCs are welcome and taken seriously. See [GOVERNANCE.md](./GOVERNANCE.md) for details.

## License (MIT)

Copyright © 2009-2026 [Rhinostone](http://www.rhinostone.com/)

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
