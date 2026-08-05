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

## What's in 0.6.4

> **Re-bake your bundles, not just restart them.** The browser bundle changed in
> this release. The new loading state, the form and staged-upload accessibility
> work, and the link-transport fix ship *only* in the bundle, so a restart alone
> will not deliver them. Rebuild each bundle (`gina bundle:build`) as well as
> restarting.

> **No settings reset.** `0.6.4` is a patch — the `shortVersion` stays `0.6`, so
> your `~/.gina/0.6/settings.json` is untouched. (`0.6.0` was the reset.)

> **One visual change arrives with no opt-in.** Gina now ships a default look for
> the loading state it writes, so a submit trigger picks up a `progress` cursor
> and a gentle opacity pulse while its request runs. Overriding takes one rule of
> your own — the selector is a single attribute, so any class beats it — and the
> pulse is already gated on `prefers-reduced-motion`.

- **Added — a framework-owned loading state for busy controls.** Clicking a `<button type="submit">`, an `<input type="submit">`, an `<a data-gina-form-submit>`, a `data-gina-link` anchor or a popin trigger sets `data-gina-loading="true"` on that control, and the attribute flips to `"false"` as soon as the work completes or is interrupted — settled, errored, timed out, aborted, rate-limited, or rejected by validation. That last case is the one that stranded loading state on forever: a submit refused before it starts sends no request at all, so nothing in the XHR lifecycle could ever release it (#B247). One stylesheet now covers every busy control on a page whichever plugin started the work. Enter-key and programmatic submits arm the form's registered trigger; a click on a wrapped label such as `<button type="submit"><span>Save</span></button>` arms the button rather than the span; and the state lands on the anchor itself even when the click hits a nested element. A project already built on `data-loading` renames the attribute with `gina.setOptions({ loadingAttribute: 'data-loading' })`. **Style the running state with `[data-gina-loading="true"]` and never with a bare `[data-gina-loading]`** — the attribute stays present when released, carrying `"false"`, so a presence selector would pin the loading style on permanently. Two limits are deliberate and tracked: a link request that hangs never settles and so never releases, and a popin opened from a still-in-flight hover/focus preload does not yet arm its trigger (it cannot leave anything stuck — nothing is armed). Browser-bundled — **re-bake**.
- **Added — a default look for that loading state, so the feature is visible without writing any CSS.** Deliberately minimal, with two omissions on purpose: no injected spinner, because one would stack with a spinner you already ship and would force a positioning change on a trigger gina does not own; and no `pointer-events: none`, because a link deliberately accepts a second click while its request runs and supersedes the first. Anyone who has asked for reduced motion gets a static dimmed state rather than no signal at all. `animation: none` drops just the motion, and renaming the attribute opts out of the default styling entirely, since it is keyed on the default name.
- **Added — `gina.config.a11y` translates what gina says on its own behalf.** For example `gina.config.a11y = { submitting: 'Envoi…' }`. English defaults ship for anything a project does not translate, mirroring how `setErrorLabels` already handles built-in rule labels. These are distinct from rule error labels: `setErrorLabels` is keyed by rule name, while these describe what the framework itself is doing.
- **Added — `${secret:KEY}` can resolve from `.env`-style files as well as the environment.** Declare `secrets.file` in the bundle `settings.json` — one path or an array — using the usual config tokens, e.g. `["${homedir}/secrets.env", "${homedir}/${scope}/secrets.env"]`. **Files are layered UNDER the environment**, which inverts the usual `.env` intuition on purpose: a non-empty environment variable always wins, so a Kubernetes secret, a `sops exec-env` invocation or a CI-exported value can never be shadowed by a stale file left on disk. A variable that is set but *empty* counts as absent and the file fills it — which keeps the common `environment: ["X=${X}"]` passthrough working — and that fall-through warns, naming the key. Within the array, later entries win, so a shared base file and a per-scope file combine. A declared file that does not exist contributes nothing rather than failing, resolution stays fail-closed when a key is in neither source, and a config that does not declare `secrets.file` behaves exactly as before. `lib.secrets` gains `parseEnv` / `parseEnvFile`, which `secrets:check --env-file` shares, so the CI gate and the runtime can never disagree about how a file is read. **This is a convenience for plaintext and pre-decrypted deployments, not a secrets-management integration:** for SOPS, Vault or a KMS, keep decrypting at the container entrypoint so values land in the environment.
- **Security — secret files are ignored by glob, not by exact name.** The previous single `.env` entry matched only that exact name. Dot-prefixed variants such as `.env.production` were already covered by the pre-existing `.*` catch-all, but a secret file whose name does not begin with a dot — `secrets.env`, `db.env`, `production.env` — matched nothing and was committable and publishable by default. `.env`, `.env.*` and `*.env` are now all covered in both the repository ignore list and the published-package ignore list.
- **Fixed — a submit trigger disabled by live validation is no longer operable.** A trigger marked disabled (`aria-disabled="true"` plus the `gina-form-submit-disabled` class) could still be clicked, and that click ran the entire submit cycle — field collection, validation, the submit latch and the send gate. The control was inert in appearance only, so one announced as disabled to assistive technology stayed fully operable. The click is now intercepted before the submit dispatch, and answered by a display-only validation pass that renders every invalid field and moves focus to the first, so the reason it is disabled stays discoverable; that pass also re-syncs the trigger, so a stale disabled marker on a form that has since become valid heals itself. The check reads the clicked element rather than the form's registered trigger, so forms carrying several submit buttons behave correctly. (#B246)
- **Fixed — a form's first validation error is now reliably announced.** The polite live region was created, inserted and given its text in a single synchronous step, which reaches a screen reader as one change on an element it has never seen and is commonly not spoken at all — so the first error on any form, the one most likely to matter, was the one least likely to be heard, while every later announcement worked. The region is now stood up when the form is bound. A region that still has to be created at announcement time defers its first write by a tick, which matters because the region lives inside the form and a subtree replacement destroys it: a popin re-render or fragment swap otherwise reproduced the original problem silently. The region deliberately stays a child of the form rather than moving to document level — a popin renders its form inside a native dialog opened with `showModal()`, which leaves everything outside the top layer inert, so a document-level region would go unspoken for exactly those forms. Browser-bundled — **re-bake**.
- **Fixed — submitting a form no longer loses the keyboard user's place.** Gina disables the submit trigger for the duration of the request, which makes the browser drop focus to the document body; focus is now returned to that trigger once the request settles, and only when nothing else claimed it meanwhile. The trigger also carries `aria-busy` while the request is in flight, and the form's polite live region announces the start once. Completion announces nothing, so an errored response still announces its field errors uninterrupted, and a submit rejected by validation announces nothing at all.
- **Fixed — validation messages stay reachable while they are hidden from view.** Gina hides a committed error's message when its field regains focus, but kept `aria-invalid="true"` asserted — so the `aria-errormessage` association pointed at an element `display: none` had removed from the accessibility tree, announcing a field as invalid with no retrievable reason. Both hide paths now clip the message out of view instead of out of the tree, and the `.hidden` class is still applied so consumer CSS keyed on it keeps matching. Re-announcing the same error works now too (a polite region ignores a byte-identical rewrite), and moving focus to the first invalid field no longer stops on a control that cannot take focus — every element has a `focus` method, including a custom element whose `focus()` does nothing, so the search confirms focus actually moved and continues otherwise.
- **Fixed — staged uploads are announced and operable.** A progress indicator that is not a native `<progress>` carries `role="progressbar"` with `aria-valuemin`/`aria-valuemax`/`aria-valuenow`; the value is **dropped rather than zeroed** while an upload is indeterminate or errored, so a screen reader reports an unknown state instead of stalled progress. A native `<progress>` is left untouched. Upload start and successful completion are announced through the polite live region gina already owns — per-tick progress deliberately is not, as one announcement per progress event would bury everything else on the page — and an upload error announces the server's own message there rather than only writing it into a container that is hidden when the text lands. The auto-generated reset control is now announced as a button, activates with Space as well as Enter, and names the file it acts on; focus moves to the file input before the control is removed. Preview images finally carry an `alt` taken from the user's own filename, where assistive technology previously read the temporary upload URI aloud once per staged file. The three new strings — `uploadStarted`, `uploadComplete` and `fileRemoved` (which takes a `%s` for the file name) — are overridable through `gina.config.a11y`. Browser-bundled — **re-bake**.
- **Fixed — a superseded popin no longer stays reachable behind the one on screen.** Non-modal is the framework default for the `data-gina-dialog` API and opening a popin never closes the one it supersedes, so both stay in the page — but a non-modal `<dialog>` gets none of the background `inert` that native `showModal()` provides, and gina restores it by hand. That restoration skipped the shared popin container wholesale, and every popin lives inside it, so a superseded dialog kept its links, buttons and fields in the tab order: a keyboard or screen-reader user could tab straight out of the popin they were looking at and into a stale one. The container is now descended into and sibling open dialogs are inerted individually. Closed ones are deliberately left alone — a `<dialog>` without `open` is already `display: none` per the user-agent stylesheet. Teardown still restores everything it marked, including an `inert` a project set itself, which gina never claims.
- **Fixed — built-in HTML error pages are conforming documents.** The fallback page served when a project has no custom error template emitted no doctype (so browsers rendered it in quirks mode), no head, no title and no `lang` — and on HTTP/1.1 it closed the body with an *opening* `<html>` tag, so the document never terminated. Both engine branches now ship a doctype, an `<html lang>`, a `<title>` and a `<main>` landmark. This is the default path: a scaffolded project ships no `templates/html/errors/` directory, so it is what an unhandled 500 actually serves. Separately, the `lang` value gina emits is normalised to BCP-47 wherever it appears — `en_CM` becomes `en-CM`, and an `accept-language` q-value such as `fr;q=0.9` reduces to `fr` — falling back to `en` rather than emitting a tag assistive technology cannot parse.
- **Fixed — clicking a second `data-gina-link` no longer kills the first click's response.** The link plugin built one `XMLHttpRequest` at initialisation and reused it for every click, and re-opening a request that is still running aborts it — an aborted request arrives with status `0`, which the completion path has no branch for, so the first click ended in total silence: no success callback, no error callback, nothing. Each link request now gets its own transport and carries a sequence number, so a superseded response is discarded rather than acted upon and a slow first response can never overwrite a newer one. Two related gaps stay unchanged for now because both would alter what your handlers receive: a link request that fails at the network level is still silent, and one that hangs still has no deadline. Browser-bundled — **re-bake**.
- **Fixed — `gina secrets:check` looks in the same two places a bundle would, in the same order.** It previously cross-referenced the environment only, so once a bundle declared `settings.secrets.file` the command reported `UNSET` — and exited non-zero — for a key that bundle would have started with perfectly well, turning a pre-deploy gate into a false alarm. It now resolves the declared file chain beneath the environment, reusing the runtime's own token substitution and the shared parser. An explicit `--env-file` still wins, because it stands in for the environment tier. The report gained a per-bundle chain listing marking each path `loaded` or `ABSENT`, and each key names the tier it was satisfied from, so a value coming from a plaintext file on the local disk is never mistaken for one the deployment will inject. `${projectVersion}`/`${projectVersionMajor}` are seeded from the project manifest and `${scope}` falls back to the project's default scope, so version- and scope-templated chains resolve; a path whose tokens still cannot be resolved is reported and skipped rather than opened blindly — which can only make the gate stricter than the runtime, never laxer. A bundle declaring no `secrets.file` reports exactly as before. (#B263, #B266)
- **Fixed — a declared secrets file that exists but cannot be read now refuses the boot.** Wrong permissions or ownership, or a path that is actually a directory, were all mistaken for a layer that is simply absent — so a chain whose per-scope file lost read permission silently fell back to the shared base file and **the bundle booted healthily on the wrong credential**, with only a debug line, itself mislabelled `ABSENT`, to say so at a level suppressed by default. Boot now refuses and names the path and the error code, and `secrets:check` reports the same distinction. A genuinely missing file is unchanged: it contributes nothing and is not an error, so shipping a base file and adding the per-scope one only on some targets keeps working. (#B267)
- **Fixed — an environment variable that is set but empty warns as it falls through to the file.** The fall-through itself is deliberate and unchanged — an empty value counts as absent, which is what keeps the `environment: ["X=${X}"]` passthrough working when the outer variable is unset. But the same shape appears when a container entrypoint runs `export X="$(fetch …)"` and the fetch *fails*, and there a file quietly supplying a stale value is exactly the shadowing that the environment-wins ordering exists to prevent. Since the two are indistinguishable from inside the process, the file tier now emits a warning naming the key — never the value — at a level that survives the default log hierarchy. (#B268)
- **Fixed — a trailing `#` comment in a secrets file is no longer read as part of the secret.** `DB_PASSWORD=s3cret # rotated May` resolved to the literal `s3cret # rotated May`, and a quoted value followed by a comment kept its quote characters too. The parser now strips a trailing comment the way a POSIX shell does when sourcing the same file — which is what the documented container-entrypoint pattern (`set -a; . secrets.env; set +a`) already did, so the same file no longer means two different things depending on which route delivered it. Two cases deliberately keep their hash, because stripping them would corrupt a legitimate password: a `#` with no whitespace before it (`abc#def`), and any `#` inside quotes (`"abc # def"`) — which makes quoting a complete escape hatch. **One consequence to check before upgrading:** `KEY= # comment` is now an empty value rather than the string `# comment`, and an empty value counts as unset — so a key written that way fails closed at bundle start and `secrets:check` reports it `UNSET` instead of `SET`. That reversal is the point: the shell always delivered it empty, and the previous `SET` was a false green.
- **Fixed — requiring gina outside a bundle context fails cleanly instead of hanging the process.** The bootstrap has always thrown when it cannot find the bundle context the CLI provides, but the logger — a load-time singleton — had already opened its MQ socket by then, and that socket kept the event loop alive: catching the error did not let the process exit, so a plain node process (a test runner, a one-off script, a codegen pass) stalled with no output wherever an MQ listener happened to be running. The speaker now unrefs its connection, so a logging transport can never be the reason a process stays alive. The error also names the boundary it hit and points at `SuperController.createTestInstance()` for exercising controller code without booting a bundle, instead of reporting an internal path-registry failure. (#B276, #B277)
- **Fixed — a bundle starting in an environment its `env.json` does not declare reliably prints why.** The refusal was written with `console.error` and the boot then ended through a callback, so on a loaded or short-lived pipe — a container start, CI — the explanation could be truncated away and the operator was left with an exit code and no reason. The message is now flushed synchronously before the boot unwinds, matching the other boot-refusal sites in the same file. (#B278)
- **Fixed — a gina command no longer dies when an MQ speaker disconnects abruptly.** Every CLI invocation starts the MQ listener on the shared log port, so commands running side by side connect to one another as speakers. When one ended or was killed, the listener still held its connection socket and the next write raised `EPIPE` or `ECONNRESET` on a socket that had no error listener — so Node threw the event and took the whole command down mid-run. The failure was silent and looked like the command had simply not done its work: a `bundle:add` killed this way exited non-zero after registering its ports but before writing the rest of its state, leaving a half-created bundle. Connection sockets now handle their own errors, dropping the departed speaker's session and carrying on. The listener-wide error handler was never a substitute — in Node every accepted connection is its own emitter, so it never saw these. (#B279)

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
