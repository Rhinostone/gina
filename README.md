# Gina

[![npm version](https://img.shields.io/npm/v/gina)](https://www.npmjs.com/package/gina) [![npm downloads](https://img.shields.io/npm/dm/gina)](https://www.npmjs.com/package/gina) [![GitHub stars](https://img.shields.io/github/stars/gina-io/gina)](https://github.com/gina-io/gina/stargazers) [![Tests](https://github.com/gina-io/gina/actions/workflows/test.yml/badge.svg)](https://github.com/gina-io/gina/actions/workflows/test.yml) [![Socket Badge](https://socket.dev/api/badge/npm/package/gina)](https://socket.dev/npm/package/gina) [![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D%2022-brightgreen)](https://nodejs.org) [![Bun >= 1.2](https://img.shields.io/badge/Bun-%3E%3D%201.2-brightgreen)](https://bun.sh) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## What's in 0.5.15

- **Added — client-side components (Web Components).** Standards-based, zero-dependency conventions for stateful client widgets: `gina view:add` scaffolds a reference custom element (a server-rendered light-DOM partial paired with a behavior-only class, HTML and JS kept separate), components upgrade automatically inside popin/XHR-injected content with no rebinding, and the whole pattern is SEO/GEO-first (meaningful content ships in the initial server-rendered HTML) and strict-CSP compatible. Form-associated custom elements (`static formAssociated = true` + a `name` + a `.value` getter) participate in `FormValidator` like native controls — collected, live-checked, validated, serialized into the AJAX payload, and error-rendered. Live-data components ride the `connectedCallback`/`disconnectedCallback` lifecycle over `method:"ws"` routes or SSE. The dev Inspector gains a component census (with a red indicator for undefined components awaiting upgrade) and captures client-side `<tag>:<verb>` component events.
- **Added — a popin/dialog trigger can opt out of the hover/focus preload.** Declare `data-gina-dialog-preload="false"` on any trigger whose GET has server-side effects and the warm-up GET no longer fires on hover or focus; the click loads normally, at click time. Existing triggers are unaffected.
- **Fixed — `gina.popin` sees every popin.** The popin registry is now shared across every `Popin` instance, so `getPopinByName()` / `getPopinById()` / `activePopinId` resolve every registered popin — a form submitted from a popin whose response redirects into a *different* popin no longer fails with a 422 `Popin not found` error.
- **Fixed — a redirect into a popin opens content-first.** The popin's body is injected before it opens, so a slow or failed load no longer flashes (or leaves open) an empty popin.
- **Fixed — server-side validation of a data object against a rules object works.** `gina.plugins.Validator(rules, data, formId[, culture])` used to crash on its first field; plain rules now validate and return `{ isValid(), error, data }`, with the optional `culture` localising labels from the bundle catalog. Conditional (`_case_`) rules remain client-only.
- **Fixed — `$form.send(FormData)` nests bracket-notation field names.** `item[0][id]`-style names now nest into objects/arrays before posting (matching the declarative submit path), instead of being transmitted as literal JSON keys.
- **Fixed — a fields-only multipart POST no longer hangs, and a malformed multipart body no longer crashes the bundle.** A `multipart/form-data` POST with no file parts previously hung until a front-proxy timeout, and a malformed/empty multipart body could take a worker down via an uncaught parser error (an unauthenticated single-request DoS); both are fixed — the fields-only case resumes directly, and the parser error is answered with HTTP 400.
- **Fixed — `X-Powered-By` suppression reaches static and error responses.** `settings.json > server.hidePoweredBy: true` now suppresses the header on every response gina originates (routed pages, static serves, static/traversal 404s, framework error pages) on both engines, and an `env.json` `X-Powered-By` override now replaces the value on HTTP/1.1 error responses too.
- **Fixed — upload reset/delete removes the preview, restores class-hidden inputs, and gains removal callbacks.** Clicking a preview's **Reset**/**Delete** link now actually removes the preview image, its trigger link, and the generated hidden fields (the cleanup was previously dead code that threw a `ReferenceError`); the add-affordance restore lifts a `data-gina-form-upload-hidden-class`, the `-reset-trigger`/`-delete-trigger` id override now resolves, and new `data-gina-form-upload-on-reset` / `-on-delete` callbacks fire once per removal.

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
