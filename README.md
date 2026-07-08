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

## What's in 0.5.13

- **Added — unrenderable `_validator` catalog labels are caught at bundle boot.** Gina now warns when a `_validator` label in a locale catalog cannot be rendered. Built-in rule labels accept only the placeholders `%l` (field label), `%n` (field name) and `%s` (size); any other `%`-token — including a literal percent glued to letters, as in `20%sur le prix` — is substituted with the string `undefined` in the message shown to the user, and a non-string label makes the validator throw. The catalog still loads, and the warning names the offending rule and the catalog file, so a translation typo surfaces in the boot log instead of in production copy.

## What's in 0.5.12

- **Added — FormValidator built-in rule labels localise from the i18n catalog, client and server.** The built-in rule messages (`isEmail`, `isRequired`, and the rest) now resolve per culture from `bundle/locales/<culture>.json` under the `_validator.<rule>` namespace, on both the server-rendered and client-side validation paths — English defaults fill any gaps, with a culture → base-language → English fallback. An app can still override per key with `gina.validator.setErrorLabels(labels[, culture])` (precedence: `setErrorLabels` > bundle catalog > English), and a per-field or per-rule message still wins over all of it.
- **Added — per-bundle i18n catalogs activate culture negotiation and `t()`.** A bundle that ships a `locales/` directory now loads its catalogs at boot, activating URL-prefix / cookie / `Accept-Language` culture negotiation, the `t()` global, and the `t` template filter (opt-in and non-fatal — no `locales/` → unaffected; a malformed catalog warns rather than blocking boot). Two fixes make the negotiated culture actually reach every request: it previously resolved to `en`/empty regardless of configuration (#B83), and was dropped on warm/cached page reloads (#B84).
- **Added — `data-gina-form-rule` forms auto-boot the client validator.** A form declaring `data-gina-form-rule` with a matching rule set now validates in the browser automatically at page load, with no per-page boot code — the same batteries-included behaviour as `data-gina-dialog` popins. Explicit construction to attach submit/lifecycle handlers still works and is idempotent with the auto-boot.
- **Fixed — FormValidator correctness.** An empty required field shows a single "is required" message instead of also stacking "invalid" (#B78); a cross-field `is` rule no longer throws (and ungates the form) when the referenced field is still empty (#B82); and an invalid submit trigger is now marked `aria-disabled` + `.gina-form-submit-disabled` instead of natively `disabled`, so a click still surfaces every field error and focuses the first invalid field (#B76) — consumers should style that state (the framework ships no button CSS).
- **Fixed — popin / redirect robustness.** A hover/focus-warmed popin whose GET returned an XHR redirect no longer shows raw JSON (#B80); a `_self` popin redirect no longer intermittently opens against a not-yet-loaded body (#B77); XHR/popin redirect responses carry the same `no-store` directives as plain redirects (#B75); and the HTTP/1.x static directory-to-index redirect now sends an unconditional 301 outside dev instead of a blank 200.
- **Fixed — CLI robustness.** A malformed `@<project>` token (uppercase / dash / bare `@`) is now rejected with a clear error and exit 1 instead of silently targeting the wrong project (#B69); `GINA_HOMEDIR` is re-exported to every spawned child command so a home override is honoured; `project:start` / `service:start` delegate instead of hanging on a version-gate misparse; bulk `start` / `stop` / `restart` on a bundle-less project answer cleanly instead of crashing the daemon; and the framework-not-installed hint points at the real `gina framework:add` (#B81).

## What's in 0.5.11

- **Added — `gina image:build`: first-class OCI packaging.** Package a project bundle as a standard OCI image with one command: it synthesizes a `Containerfile` + build context from the project's registered state (bundles, entry, ports, env model, Node engine floor) and executes the build with buildah — natively on Linux, or on a container host reached over ssh (`GINA_CONTAINER_HOST=ssh://[user@]host[:port]` env override → native buildah → `container.host` in `~/.gina/<shortVersion>/settings.json`). A non-dev `--env` ships the release tree built in-image by `gina bundle:build`, so a production image never runs dev-mode hot-reload; the image boots via `gina-init` + `gina-container` (SIGTERM drain) and the `EXPOSE`d port is computed deterministically from the port allocator. `${secret:KEY}` placeholders ride byte-verbatim and resolve from the container environment at runtime — never baked. `--emit` prints the synthesized artifact without building; `--format=json` emits a one-shot machine-readable result; `--stream` emits NDJSON progress frames for CI/GUI consumers.
- **Fixed — proxied redirects now carry no-store cache headers (#B68).** Framework-emitted redirects on requests classified as reverse-proxied now include `Cache-Control: no-cache, no-store, must-revalidate` (+ `Pragma` / `Expires`), so a browser never caches a proxy-context-derived redirect; the inter-bundle query 3xx forward path inherits the set. Direct production redirects are byte-identical, and the `301` default and route-declared `param.code` are untouched.

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
