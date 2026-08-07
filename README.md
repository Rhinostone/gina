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

## What's in 0.6.5

> **Re-bake your bundles, not just restart them.** The browser bundle changed in
> this release. Nearly every fix below lives in the bundle — the form validator,
> the popin plugin and the link plugin — so a restart alone will not deliver
> them. Rebuild each bundle (`gina bundle:build`) as well as restarting.

> **No settings reset.** `0.6.5` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

> **If you are on 0.6.4, upgrade.** `0.6.4` shipped a regression that could stop a
> submit button responding to clicks entirely (#B293, first below). This release
> fixes it, together with a family of long-standing defects that produced the same
> signature — a control that looks completely normal and does nothing at all.

**Four items may need action before you upgrade:** the submit-trigger marker
vocabulary change, `gina.setOptions()` starting to take effect, the new disabled
gate on links, and `isRequired` accepting padded input. Each is called out below
and detailed in the [migration guide](https://gina.io/docs/migration).

- **Changed — the not-ready submit-trigger marker is `data-gina-form-submit-gated`, not `aria-disabled`.** While live validation reports a form invalid, its submit control is marked with the framework-owned attribute plus the existing `gina-form-submit-disabled` class. It no longer carries `aria-disabled`, which announces a control as not operable while gina deliberately answers the click — revealing every invalid field and moving focus to the first. Announcing one thing and doing another was the contradiction; the behaviour is unchanged and the vocabulary now matches it. `aria-disabled` keeps exactly two writers, both honest: marks you author yourself, which the click gates now enforce and gina never auto-clears, and the anchor in-flight lock for the request window. A modest default look ships for the gated state (`cursor: not-allowed` plus a dim, single-attribute specificity, trivially overridden). **Action:** if your CSS targets `[aria-disabled="true"]` on submit triggers, key it on the new attribute or on the class. A gated trigger also no longer fails browser-driver actionability checks, so plain clicks deliver in tests. (#B312)
- **Fixed — a double-submit guard no longer kills the submit.** Since `0.6.4`, a submit trigger stopped responding to clicks when your own handler set the native `disabled` attribute during the click — the shape the near-universal double-submit guard uses. The click was cancelled before anything was sent, and because your handler cleared the attribute again the button looked perfectly normal while every further click was swallowed. The native attribute is now honoured only where the browser does not already enforce it (anchors, custom elements); on a real form control the browser suppresses the click itself, so the check never protected you there. The same shape is fixed for popin and dialog triggers, the legacy popin dispatch path, and in-popin close buttons, where a capture-phase guard could leave a popin stuck open. (#B293, #B296)
- **Fixed — a submit button keeps working after its DOM node is replaced.** The shape an AJAX update or a popin re-render produces when it swaps in fresh markup: the replacement went permanently and silently dead — no request, no navigation, no error — while Enter and `submit()` still worked. Click handling is delegated to the form and survived the swap, but the step that runs the submit was bound to the original node. Gina now recognises a replaced trigger on its first click and re-binds it. (#B294)
- **Fixed — an async `query` rule no longer leaves a valid form blocked.** A form whose last rule is an async uniqueness check stayed marked invalid after the check came back clean, because the completion path decided validity from one field's result and only ran its update when that field failed. Invisible until `0.6.4`, when the submit gate began reading the marker — after which the first click following a settled query was silently swallowed. (#B295)
- **Fixed — Enter and wrapped-label clicks respect the submit gate.** The submit proxy enforced its gate against a `DOMParser` copy of the form that could only see native `disabled`, so a gated trigger still ran the full cycle and **sent** from a click on markup nested inside the button, or from Enter on a form whose trigger is not a native submit button. Trusted gestures now hit the live registered trigger with the same answer as the click path. Programmatic `$forms[id].submit()` deliberately keeps the fresh-validate path. (#B308)
- **Fixed — an anchor submit trigger's in-flight lock survives a second click.** On an `<a data-gina-form-submit>` the validity gate and the in-flight lock both wrote `aria-disabled` with opposite lifecycles and could erase each other, leaving a form marked to the framework but operable to assistive technology, or announcing a control operable while its request was still running. With the not-ready state on its own attribute, the lock owns `aria-disabled` exclusively. Button triggers were never affected. (#B309, #B313)
- **Fixed — required fields accept padded input, and `trim` strips both sides.** `isRequired` treated any value *starting* with whitespace as empty, so `" john"` was rejected as *Cannot be left empty* — and when the rule set also declared `trim`, the same pass then trimmed the value after recording the error. Emptiness now means `undefined`, `null`, the empty string, or whitespace-only. `trim` also rewrote only the first whitespace run it found, so a value padded on both sides kept its trailing run. **Action:** if anything relied on leading whitespace being rejected, enforce it explicitly. (#B245)
- **Fixed — a popin holding several forms tears all of them down.** The teardown walked its list of forms while removing entries from it, releasing only every other one; the skipped forms kept stale records pointing at discarded markup, so the next open handed back the stale record and the form came up silently inert. Only popins given a validator explicitly are affected. Teardown is also no longer all-or-nothing. (#B265)
- **Fixed — a popin trigger shows its busy state when it adopts a preload.** The common path when warm-on-intent preloading is on: an open adopting a still-in-flight hover/focus preload left the trigger with no affordance. It is now armed for the adopted wait exactly like a cold load and released when the preload settles either way. An instant open from cache never flashes a busy state. (#B285)
- **Fixed — a legacy popin trigger cannot start a second load.** An anchor using the older `data-gina-popin-name` markup was marked `aria-disabled` while loading, but its dispatch path tested only the plain `disabled` attribute, which an anchor never carries — so a second click during a slow load issued a second request. In practice this reached triggers that opt out of preloading, i.e. links whose request has side effects on the server. (#B298)
- **Fixed — a popin close button works with your own id and with nested markup.** Giving the button your own id stopped it working, because gina recognised its close buttons by an id it had assigned itself. More commonly, an icon inside the button broke it too — a click landing on the inner `svg` or `span` was not recognised. Neither reported an error, and gina suppresses the default action either way, so nothing happened at all. (#B299, #B301)
- **Fixed — `data-gina-link` leaves native affordances to the browser.** Four cases are no longer intercepted: an anchor carrying `download` saves natively instead of being buffered in memory, one carrying `target` opens its window or tab again, one pointing at a bare `#` fragment moves within the page, and a ctrl/cmd/shift/alt click opens the tab or window the browser would. The tests run against the resolved target, so the documented placeholder form keeps working. Cross-origin links are unaffected. (#B288)
- **Fixed — a `data-gina-link` with your own id dispatches again.** Gina kept the id you wrote but dispatched only links whose id it had generated itself, so `<a id="my-link" data-gina-link>` registered normally and was then silently ignored on every click — with the default action already suppressed, nothing happened at all. Links with no id, and links wrapping a `span` or image, were unaffected, which is why this could sit unnoticed. (#B302)
- **Fixed — disabled links are refused.** `data-gina-link` anchors had no disabled gate at all: one marked `aria-disabled="true"` still fired its XHR from both dispatch paths. Both now refuse the click with the same predicate the popin and validator gates use, while still suppressing the default navigation. Programmatic `gina.link.request()` deliberately stays ungated. **Action:** this is an enforcement tightening — remove the attribute from any link you still expect to fire. (#B310)
- **Fixed — download filenames parse and serialize correctly.** Client-side, a `Content-Disposition` carrying no `filename` no longer throws mid-download (the browser derives a name), a quoted-string filename is unquoted and unescaped rather than saved with its quotes, and a trailing extended parameter is no longer folded into the name. Server-side, both emitters now write the filename as an RFC 6266 quoted-string with `"` and `\` escaped, so a name containing spaces, `;` or `,` produces a conformant header instead of a bare token an intermediary may truncate. (#B290, #B297)
- **Fixed — `gina.setOptions()` writes the config the framework actually reads.** It merged into an orphan object nothing ever read, and was therefore silently ignored for every key since it shipped — the documented `loadingAttribute` rename could not work. It now merges into the exposed `gina.config` in place, with override semantics. **Action:** anything your project was already passing and silently having ignored **will now take effect** — review those calls. The `data-gina-config` script-tag attribute, documented alongside the rename but parsed by nothing, is no longer documented. (#B305)
- **Fixed — the dev Inspector's standalone window reports its source mode.** The footer badge naming where the window's data comes from never appeared for a window opened from a `?target=` URL, because it was painted only from the data-poll timer that standalone mode deliberately never starts. The same mode did show when the window was reached through the connect form, so the badge's presence depended on how the Inspector had been opened rather than on the mode it was in. Polling is still not started there, deliberately. (#B306)
- **Fixed — the documented SQLite and DuckDB default database path.** The connector JSDoc and the `connectors.json` schema described the default as version-segmented; the framework resolves the gina home without a version segment, so the documented default now matches the real path. Documentation only — behaviour is unchanged. (#B317)
- **Fixed — `npm test` runs the suite.** The script pointed at a glob matching no files: 0 tests, exit 0 — a silent green that could pass for a healthy run. It now runs the full suite CI gates on, with `package.json` as the single source of truth for that file list. Adds `npm run test:coverage`, and a `pretest:e2e` step that installs the matching Chromium build so `npm run test:e2e` works from a clean checkout.

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
