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

## What's in 0.5.19

- **Added — route authorization.** A `routing.json` rule can now gate access declaratively, enforced before the controller action runs. `param.requireAuth: true` requires an authenticated session (`req.session.user` set — populating it at login stays the app's job): an unauthenticated XHR gets a 401, a browser navigation gets a non-cacheable redirect to `settings.json > auth.loginRoute` with the original request snapshotted for `self.resumeRequest()` to replay. `param.roles: ["admin", "editor"]` requires any one of a set of roles (implies `requireAuth`); `param.policy: "ownsInvoice"` delegates the decision to a per-bundle `policies/ownsInvoice.js` function for the ownership/record checks roles can't express (AND-composed after roles, allowed only on a literal `true`, a throwing policy denies). Denials stay generic — the required roles and policy name never reach the wire, and the client-served routing maps no longer ship the authorization keys. Author mistakes refuse to boot rather than leaving a route silently open (a non-boolean flag, an undeclared `loginRoute`, an invalid `roles` shape, a missing / broken / `async` policy). Also adds the imperative `self.hasRole(role)` controller helper. Routes that declare nothing behave exactly as before.
- **Added — an audit trail.** A user-attributed, append-only record of "who did what to which record when", with its own store, never riding the logger sinks. Opt in with `settings.json > audit.enabled: true` and call `self.audit("invoice.delete", { resource: id })` from an action; the default backend is an append-only JSONL file at `<project>/logs/audit-<bundle>-<env>.jsonl` (override with `audit.file`, or point `audit.store` at a connectors.json entry). The actor is a snapshot of `session.user[audit.actorKey]` plus a copy of `user.roles` — never the whole user object — and `X-Forwarded-For` is never trusted. Route-authorization denials are recorded automatically (`authz.denied`, opt out with `audit.events.authz: false`), and an audit failure can never change an authorization outcome. Every request now carries an always-on request id, so audit records and JSON log lines correlate by construction. Malformed `audit` settings refuse to boot rather than leaving a compliance control silently off.
- **Added — an OCI image and container CLI.** Building on `image:build` (0.5.11), five verbs now inspect and run images on the same container host: `gina image:list` (aligned table or `--format=json` with a machine-sortable `sizeBytes` and an RFC3339 `createdAt`), `image:rm <ref>` (untags a multi-tagged image; no bulk delete; the reference is charset-gated), and `image:run <image>` (runs with podman — detached by default, publishing the EXPOSEd port same:same, with `--publish` / `--rm` / `--stream` / `--env-var` / `--env-file`, so a `${secret:KEY}` baked into an image gets its value at start without ever entering argv or a shell). A new `container:` group lists and stops running containers — `container:ps [--all]` and `container:stop <name|id>`, which reports the rung the container came down on (137 = SIGKILL after the grace period, otherwise its own terms). Every verb resolves the host with `image:build`'s precedence and reports a build-only host (buildah without podman) honestly instead of failing opaquely.
- **Changed — `redirect()` carries request data through the session by default.** When a redirect carried the request's params they used to travel in the URL as `?inheritedData=<encoded JSON>` — in clear, in the address bar, browser history, and access logs, capped at 2000 characters. On a bundle with a session they now ride the session instead (a one-shot flash, consumed by the next routed GET, gone on refresh); the URL form and its cap now apply only to session-less bundles. For a bundle that halts a credential-bearing POST mid-flight (a registration or login), this removes a plaintext-secret-in-URL disclosure. The target action still reads the data from `req.get` unchanged, and `resumeRequest()`'s plain-XHR and full-page replays no longer drop it.
- **Fixed — metrics no longer double-count under the isaac engine.** With `app.json metrics.enabled` on, the request-lifecycle hook ran at both dispatch layers for any request reaching the router, so Prometheus counters were double-incremented and the duration histogram double-observed. The hook now records exactly once on either engine, durations are measured from engine entry, and the dev Inspector Flow timeline keeps its accurate request-start time. Metrics-enabled deployments will see counter rates roughly halve at pickup — that is the double-count disappearing, not traffic dropping. (#OBS1)
- **Fixed — redirect resolution.** The relative-path `self.redirect('/path')` form resolves its target server-side again (the route matcher is async and the historical un-awaited call could never match; `redirect()` is now async — prefer `return self.redirect(...)` from actions), a redirect to an unresolvable target gets a clean 404 instead of crashing the process, and `getRoute()` no longer throws a 500 when composing a URL for a GET route that declares no `requirements` block and receives extra params (they now land as query parameters). (#B120 / #B121)
- **Fixed — `image:build` for projects that depend on gina.** Images built for a project that lists gina among its own dependencies no longer fail at `gina-init` with `EACCES`, and the pinned framework now actually wins `require('gina')` inside the image — the `node_modules/gina` link supersedes the project-extracted copy. Dependency-free projects were unaffected. (#B118 / #B119)
- **Fixed — two smaller corrections.** `gina.emit('error', ...)` on the module object no longer throws (`emit` is an inert stub; application events go through the controller's `self.emitEvent()`), and the checkbox migration warning added in 0.5.18 now also covers the un-tick direction — markup carrying `checked` plus a false / empty `value` that used to render unticked and now stays ticked is flagged once per field. (#B109 / #49)

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
