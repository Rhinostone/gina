# Gina

[![npm version](https://img.shields.io/npm/v/gina)](https://www.npmjs.com/package/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket Badge](https://socket.dev/api/badge/npm/package/gina)](https://socket.dev/npm/package/gina) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## What's in 0.5.4

- **Node.js 26 support.** The supported range now includes Node 26 — `engine.node` is `>= 22 <27`, the full test suite passes on 26.3.0, and Node 26 is part of the CI matrix.
- **Form-validation rule fixes (server + client).** `isFloat` now accepts string float values such as `"1.5"`, so server-side validation of form and urlencoded input (always strings) no longer rejects valid floats — whole numbers still fail. `isDate` validates non-ISO masks like `dd/mm/yyyy` (a slash mask with a day past 12 is no longer mis-read as US `MM/DD`) and now returns the field object, so it chains: `field.isDate(mask).isRequired()`.
- **Quieter live form validation.** While a field is being edited only the soft warning border shows; the error message is revealed once the field is committed (on blur or submit).
- **File uploads honour their configured directory and limits.** Multipart uploads now write to the configured `upload.tmpPath` (or a per-group `path`), creating the directory if missing, instead of always using the OS temp dir. `upload.maxFields` (a global per-request file-count cap) is now enforced, and `upload.maxFieldsSize` honours its unit suffix (`B`/`KB`/`MB`/`GB`; a bare number is read as MB). **Security:** a file uploaded to an unconfigured group is now rejected with HTTP 400 instead of streaming through unchecked, closing a bypass of a group's `allowedExtensions` / `isMultipleAllowed` limits. **Back-compat:** the `untagged` default now sets `isMultipleAllowed: true`, and a non-MB `maxFieldsSize` suffix now means what it says — see the [migration guide](https://gina.io/docs/migration) if your bundle configures uploads.
- **Dev-mode heap fixes.** Two retention paths that could push a long-running dev bundle toward an out-of-memory crash under sustained traffic are closed: the hot-reload path no longer accumulates dead module references for five core libraries (now loaded once, like the logger / job / state singletons), and the HTTP/2 `self.query()` client releases a settled stream at every non-retry outcome instead of retaining the per-request controller and its config clone. Production was never affected by either.
- **Tighter per-request config isolation.** The router now deep-clones only the routing table a matched request mutates, sharing the large immutable remainder by reference — removing a concurrency heap high-water-mark proportional to config size. Relatedly, `getRouteByUrl` no longer mutates the shared route config in place, so a `:placeholder` route can't leak one request's resolved values (path / namespace / file / title) into later requests for the same route.
- **Dev Inspector reliability.** The data tabs now reliably track the page that opened the Inspector — a per-tab channel survives `Cross-Origin-Opener-Policy: same-origin` severing `window.opener`. The Swig render path isolates per-request query/flow capture (concurrent requests no longer cross data); `/_gina/logs` and `/_gina/indexes` resolve the right bundle in reverse-proxy multi-bundle setups; and the SPA is hardened against a corrupted localStorage fold-state and an unescaped form-data label. Dev tooling only.
- **Express-engine admin-endpoint parity.** The default (Express) engine now serves `/_gina/info` and `/_gina/cache/stats` with the same always-on, loopback-only, IP-allowlisted behaviour as the Isaac engine (they previously 404'd there).
- **`gina bundle:add --ignore-ports`.** Exclude specific ports from the availability scan when creating or importing a bundle (e.g. `--ignore-ports=3000,3001`); composable with `--start-port-from`.

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
