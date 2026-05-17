# Gina — Roadmap

This roadmap covers planned features, architectural improvements, new connectors, and AI integration. Items marked ✅ are shipped. All planned items are open to community contribution — see [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get involved.

> **Docs:** [gina.io/docs](https://gina.io/docs/) · **Issues:** [github.com/gina-io/gina/issues](https://github.com/gina-io/gina/issues)

---

## Timeline

| Period | Version | Focus |
| --- | --- | --- |
| **Apr 2026** | `0.1.8` ✅ | Scaffold correctness · K8s support · Dependency injection · Automatic version migration |
| **Q2 2026** | `0.2.0` ✅ | Stability · WatcherService · Redis & SQLite connectors · K8s session storage · Startup cache · Pointer compression · Couchbase v2 deprecation · Couchbase security & critical bug fixes · HTTP/2 security hardening |
| **Q3 2026** | `0.3.0` ✅ | Async/await · Dev hot-reload · MySQL & PostgreSQL connectors · AI Phase 2 · Tutorials · Mobile backend guide · Route radix tree · Connector peerDependencies · 103 Early Hints · HTTP/2 observability · Security & CVE page · Couchbase connector hardening · Inspector Phase 1 + Phase 2 · CLI Tier 1 (project lifecycle, port:set, framework:get) |
| **Q3 2026** | `0.3.1` ✅ | Release workflow fixes · SQL index reporting Phase A · HTTP/2 direct stream for HTML · Dependency reduction (`ssl-checker`, `colors`, `uuid` removed — engine.io sole runtime dep) |
| **Q3 2026** | `0.3.2` ✅ | JSON Schema for config files · Entity short-name aliases · Model loading fix · getConfig() proxy fix · Inspector tab presets & QI propagation |
| **Q3 2026** | `0.3.3` ✅ | OpenAPI spec generation · CLI port:set & framework:get · TypeScript declarations · Explicit exports · Swig npm migration · Live index introspection · Popin perf · Docker fixes |
| **Q3 2026** | `0.3.4` ✅ | Patch: `gna.js` stale framework path fix · Release lifecycle `gna.js` sync |
| **Q3 2026** | `0.3.5` ✅ | Security: `@rhinostone/swig` 1.5.0 (CVE-2023-25345 extended guards) · Browser-side swig parity |
| **Q4 2026** | `0.3.6` ✅ | Inspector payload redaction (#R7) · Pre-commit & CI local-tool path guards · Private-token leak gate · Whisper Error fix (#B12) · `framework:init` hardening (#B13) · CORS preflight fix · `syncDocs` lockfile regen |
| **Q4 2026** | `0.3.7` ✅ | Web Security CSRF trilogy (#CSRF1/2/3) · Nunjucks template engine opt-in (#NJ1–#NJ4) · Eval-safety hardening (#SCS1) · MCP server (#AI8 stdio + HTTP transports) · `connector:*` CLI (#CN10) · vendored-dep CVE-visibility lock · psl/optimist removal · Session.name drop-in identity |
| **Q4 2026** | `0.3.8` ✅ | Patch: `npm install -g gina@latest` regression fix — `psl` + `@rhinostone/swig` promoted to top-level deps · install scripts decoupled from framework `lib` registry · helpers preload guarding `lib/logger` ↔ `framework/v*/helpers` circular dep |
| **Q2 2026** | `0.3.9` ✅ | Consumer-feedback batch (11 framework patches): per-request middleware dispatch isolation · Couchbase 4.x JsonTranscoder · `length` filter null safety · `process.env` mirroring · 6 nunjucks render-pipeline patches (libRef fallback · namespace prefix drop · bundle filter wraps · top-level userData · `data.data` alias · ginaLoader placeholders) · `getAssets` mid-URL `{{ }}` strip-guard anchor |
| **Q2 2026** | `0.3.10` ✅ | FormValidator HTML5 form-reassociation hardening trilogy (`HTMLFormControlsCollection`-based `bindForm` + `unbindForm` symmetry · radio mutual-exclusion + IDL/attribute reconciliation · `defaultChecked` cache for reset) · `X-Forwarded-Prefix` reverse-proxy path-prefix awareness |
| **Q4 2026** | `0.4.0` | AI agents (MCP) · ScyllaDB connector · Advanced tutorial · Website redesign · Docs offline ZIP · Bun investigation · Couchbase v2 removal · Trailer support · CLI Tier 2 (bundle/project status, rename, copy, protocol:remove, minions) |
| **Q1 2027** | `0.5.0` | ESM support · Template engine migration · Structured logging · Alt-Svc · HTTP/2 priorities · WebSocket over HTTP/2 · Inspector Production · CLI Tier 3 (project:move, framework:update, backup/restore, man pages) |
| **Q3 2027** | `1.0.0` | First stable release — Windows alpha compatibility is a hard gate |

---

## Features

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Automatic version migration** — Upgrading or downgrading gina (e.g. `0.1.x → 0.2.0`, `0.5.x → 1.0.0`) automatically migrates `~/.gina/` config to the new version on first startup. Downgrade is free — old version data is never removed. | `0.1.8` | 2026-03-26 |
| ✅ | **`watchers.json`** — First-class bundle config for file watchers. Declare watchers on config files with event-based notification (no polling). Foundation for the dev-mode hot-reload system. | `0.2.0` | 2026-03-29 |
| ✅ | **i18n core** — Per-bundle message catalogs under `bundle/locales/<culture>.json` with a fallback chain (specific culture → base language → default). Server-side `t(key, [params], [culture])` global helper with parameter interpolation and CLDR pluralisation. Swig and Nunjucks filters with the same surface (`{{ "key"\|t }}`, `{{ "key"\|t({ name: x }) }}`). Per-request locale negotiation from URL prefix / cookie / `Accept-Language` / settings default. CLI: `gina i18n:scan` for missing-key coverage per culture, `i18n:add <culture>` to seed a new catalog, `i18n:export` / `i18n:import` for `.po` / `.csv` / `.json` round-trip with translators. Headless by design — the visual translation editor lands later as the first content feature in Beemaster (admin Phase 3). Runtime + filters + `req.culture` negotiation + full CLI all shipped on the `0.3.11-alpha` track. | `0.3.11-alpha` | 2026-05-08 |
| ✅ | **i18n ICU MessageFormat** — Opt-in `t.icu(key, params, culture)` variant powered by `intl-messageformat`. Adds gender / select / nested combinators (`{count, plural, one {# item} other {# items}}`, `{gender, select, female {…} male {…} other {…}}`) on top of the i18n core. Existing `t()` shape unchanged — v1 catalogs continue to work. Covers grammars (Romance, Slavic) and select expressions the v1 `{name}` + plural-forms shape can't express. Exposed as `gna.t.icu()` (global), `self.t.icu()` (controller helper), and `tIcu` template filter (swig + nunjucks). Library loaded via dynamic `import()` from a module-level loader kicked off at bundle boot — sync API after first-call resolves. | `0.3.11-alpha` | 2026-05-08 |
| ✅ | **PWA scaffold** — `gina view:add` drops a `manifest.webmanifest` and a cache-first service worker stub (`sw.js`) into the bundle's `public/` directory, and adds the manifest `<link>`, a `theme-color` `<meta>`, an apple-touch-icon `<link>`, and an inline service-worker registration script to the default HTML layout. Zero runtime dependency — static files plus layout tags. Enables Gina apps to be installed on mobile as PWAs without additional tooling. | `0.3.13` | 2026-05-14 |
| ✅ | **Per-bundle framework version** — Declare `"gina_version": "0.1.8"` on any bundle entry in `manifest.json` to pin that bundle to a specific installed framework version. The socket server continues running its own version; only the spawned bundle process uses the declared version. Validated against the tracked version list in `main.json` before start. `--gina-version=X.Y.Z` flag on `bundle:start` provides the same override without touching config files. | `0.3.0` | 2026-03-31 |
| ✅ | **PATCH method** — `req.patch` populated with the parsed request body (JSON or form-encoded). `req.body` aliases `req.patch`. URI params merged. `"method": "PATCH"` valid in `routing.json`. Use PATCH for partial updates (only sent fields change) vs PUT which replaces the full resource. | `0.3.0` | 2026-03-31 |
| ✅ | **HEAD method** — `req.head` populated with query-string and URI params. Full controller action runs so all response headers are set correctly; body is suppressed before writing to the wire. Both `render()` and `renderJSON()` honour HEAD. Routes declared as `GET` automatically accept HEAD — no extra routing rule needed. | `0.3.0` | 2026-03-31 |

---

## CLI

Stub commands confirmed in source — handler files exist but are empty or comments-only. Ordered by user impact.

### Tier 1 — `0.3.0`

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **`project:start` / `project:stop` / `project:restart`** — Start, stop, or restart all bundles in a project with one command. Each delegates to `gina bundle:start/stop/restart @<project>` (bulk mode). `start` and `restart` accept `--env`, `--scope`, `--inspect-brk` (flags forwarded). 41 unit tests. | `0.3.0-alpha.1` | 2026-04-02 |
| ✅ | **`framework:get`** — Read one or all keys from `~/.gina/settings.json`. Completes the `gina set` / `gina get` pair. Supports `--flag`, bare key names, and `all` keyword. | `0.3.3-alpha.2` | 2026-04-08 |
| ✅ | **`port:set`** — Set or update a specific port for a bundle/env/protocol/scheme combination without a full `port:reset`. Positional syntax: `gina port:set <protocol>:<port> <bundle> @<project>/<env>`. Flag syntax: `--protocol=`, `--scheme=`, `--port=`, `--env=`. Prompts interactively for missing values. | `0.3.3-alpha.2` | 2026-04-08 |

### Tier 2 — `0.4.0`

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 📋 | **`bundle:status`** — Show the running/stopped state, PID, port, and active env for a specific bundle. Handler is comments only (6 lines). | `0.4.0` | Q4 2026 |
| 📋 | **`bundle:rename`** — Rename a bundle within a project, updating `manifest.json`, routing config, and the `src/` directory name. Handler is comments only (7 lines). | `0.4.0` | Q4 2026 |
| 📋 | **`protocol:remove`** — Remove a protocol assignment from a bundle. No handler file exists. Also requires fixing the `help.txt` typo ("remouve"). | `0.4.0` | Q4 2026 |
| 📋 | **`minion:kill` / `minion:list`** — Kill all orphaned Node.js child processes for a project (`kill`), or list active minion PIDs grouped by bundle (`list`). No handler files exist despite both being documented in `minion/help.txt`. | `0.4.0` | Q4 2026 |
| 📋 | **`gina --status` / `-t`** — Top-level health check: print whether the framework daemon is running, its version, and active bundle count. Requires adding `--status`/`-t` entries to `aliases.json` and implementing `framework/status.js`. | `0.4.0` | Q4 2026 |
| 📋 | **`bundle:copy` / `bundle:cp`** — Duplicate a bundle (source files + config) under a new name within the same project. Handler is comments only (17 lines). | `0.4.0` | Q4 2026 |
| 📋 | **`project:status`** — Show the running/stopped state of each bundle in a project with PID and port info. Handler is comments only (3 lines). | `0.4.0` | Q4 2026 |

### Tier 3 — `0.5.0`

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 📋 | **`project:move`** — Relocate a project's source directory and update all `~/.gina/` registry entries to the new path. Handler is 0 lines. | `0.5.0` | Q1 2027 |
| 📋 | **`framework:update`** — Self-update the installed Gina framework to the latest (or a specified) version without reinstalling via npm. Handler is 0 lines. | `0.5.0` | Q1 2027 |
| 📋 | **`project:backup` / `project:restore`** — Archive a project's source, config, and data to a tarball (`backup`), and restore from it (`restore`). Documented in `project/help.txt` as support-only. No handler files exist. | `0.5.0` | Q1 2027 |
| 📋 | **`framework:man` / `project:man` / `bundle:man`** — Inline CLI manual pages. Mentioned in `framework/help.txt` but no handler files exist for any group. | `0.5.0` | Q1 2027 |

---

## Modernisation

### Phase 1 — Stability

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Per-request controller instances** — Each HTTP request gets its own isolated controller instance with its own request state. Removes dead singleton infrastructure and fixes edge-case memory retention in error paths. | `0.2.0` | Q2 2026 |
| ✅ | **Entity `_arguments` buffer scoped to call** — Move the event result buffer from the entity to the individual call, preventing concurrent callers from sharing state. | `0.2.0` | 2026-03-29 |
| ✅ | **Retire `freeMemory`** — Once per-request instances land (#M1), there is no shared `local` closure to null. Replace `freeMemory` call sites with explicit `local.req = null; local.res = null; local.next = null` at response exit points. | `0.2.0` | Q2 2026 |

### Phase 2 — Async

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Promise adapter for onComplete calls** — `onCompleteCall(emitter)` wraps the EventEmitter `.onComplete(cb)` pattern in a Promise. Controllers can switch to `async/await` immediately without rewriting entities. | `0.3.0` | 2026-03-29 |
| ✅ | **Async controller actions** — Controller actions can be declared `async`. The router attaches `.catch()` to any thenable returned by an action; rejections are routed to `throwError(response, 500, ...)`. | `0.3.0` | 2026-03-29 |

### Phase 3 — Dev Tooling

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **File-watcher hot-reload** — Replace `delete require.cache` per-request with a `WatcherService` that evicts modules only on actual file change. Controllers and SQL files reload on save with zero per-request overhead. | `0.3.0-alpha.1` | 2026-03-30 |
| ✅ | **SQL annotation parser** — Replace the single-pass regex for N1QL file parsing with a state-machine parser. Handles nested block comments and `--` in string literals correctly. | `0.3.0-alpha.1` | 2026-03-31 |

### Phase 4 — DX

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Explicit exports for global helpers** — `getContext`, `setContext`, `_`, `requireJSON` etc. available as explicit `require('gina/gna').getContext` imports alongside the existing global injection. Enables IDE navigation and static analysis. | `0.3.3-alpha.3` | 2026-04-09 |
| ✅ | **TypeScript declaration files** — `.d.ts` declarations for the public surface: `SuperController`, `EntitySuper`, connector config shapes, `routing.json` schema, `PathObject`, `uuid`, all config file interfaces, `GinaRequest`/`GinaResponse`. No TS migration of internals — just declarations for consumer projects. `package.json` wired with `"types"` and `"typesVersions"`. | `0.3.3-alpha.3` | 2026-04-09 |
| ✅ | **Auto-generated `types/gna.d.ts` from JSDoc** (#M9) — `script/generate_gna_types.js` reads the `GLOBAL_EXPORTS` inventory from the gna-exports unit test plus the JSDoc on `framework/v*/core/gna.js` and emits `types/gna.d.ts` with one entry per global export. Two npm scripts: `npm run types:gen` regenerates, `npm run types:check` exits non-zero if drifted. A `gna-types-drift.test.js` unit test re-runs the generator in memory on every test pass — the JSDoc on `core/gna.js` is the single source of truth. Closes the #M8 → #M9 loop and removes the hand-written declaration. | `0.3.7-alpha.2` | 2026-04-18 |
| 📋 | **`gina connector:audit [@project]`** — reads `connectors.json`, maps each declared connector to its npm peer package (`mysql2`, `pg`, `ioredis`, `couchbase`, `openai`, `@anthropic-ai/sdk`, etc.), and runs `npm audit --json` scoped to those packages in the project's `node_modules`. Reports CVEs with severity and fix availability. If `socket` is installed in the project, delegates to it for supply-chain analysis (malware, typosquatting, protestware) instead of `npm audit`. Exit code 1 on any high/critical finding — CI-friendly. Only audits packages actually declared in `connectors.json`, not the full dependency tree. | `0.4.0` | Q4 2026 |

### Phase 5 — Future

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 📋 | **ESM compatibility layer** — Dual CJS/ESM entry points via `"exports"` in `package.json`. Framework internals stay CJS; public API gets ESM re-exports. | `0.5.0` | Q1 2027 |
| 🚧 | **Pluggable template engine** — **Partially shipped in `0.3.7`**: opt-in `render.engine = "nunjucks"` dispatch per bundle. The project installs `nunjucks` itself (no framework dep); Gina loads it via `lib/nunjucks-resolver` and routes through `controller.render-nunjucks.js`. Swig remains the default, runs unchanged. Inspector dev payload, HTTP/2 `stream.respond()` direct path, and error-page template routing all shipped in `0.3.7-alpha.2`. **Closing the parity gap on the `0.3.7` ASAP track** (see Nunjucks Parity below): filter registry port, `setResources` / `<gina>` layout placeholders, static HTML cache parity, Early Hints 103 auto-send. **Remaining `0.5.0` scope**: within-Inspector sub-items (`statusbar.html` include + flow/queries pipelines); per-template-extension dispatch so a single bundle can mix engines (`.swig` / `.njk`); optional auto-detect on `.njk` presence. Breaking syntax differences (`{% parent %}` → `{{ super() }}`, filter renames, `autoescape` default, `date` format strings, no `{% spaceless %}`) are nunjucks's own — Gina doesn't paper over them. | `0.5.0` | Q1 2027 |
| 📋 | **Structured logging** — JSON log output (`{ level, message, bundle, requestId, durationMs }`). Additive — existing consumers are unaffected. Enables log aggregation (Loki, Datadog, CloudWatch). | `0.5.0` | Q1 2027 |
| 📋 | **Research `AsyncLocalStorage` for request context** — Evaluate `node:async_hooks` `AsyncLocalStorage` as a replacement for the `local` closure pattern, giving true async isolation across `setTimeout`, Promises, and `async/await` chains without any closure threading. Output: decision doc + proof-of-concept branch. | `0.5.0` | Q1 2027 |

### Nunjucks Parity (`0.3.7` ASAP track)

Four focused follow-up sessions to close the deferred gap left by the `0.3.7-alpha.2` nunjucks MVP. Ordered by user impact.

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Port `lib/swig-filters` → `lib/nunjucks-filters`** — Mechanically port the 7 filters (`getUrl`, `getWebroot`, `length`, `nl2br`, `addHours`, `addDays`, `addYears`) into a sister library registered via `env.addFilter()` in `controller.render-nunjucks.js`. Closes the most user-visible gap — template authors get `{{ '/home' \| getUrl() }}` and the date helpers immediately. | `0.3.7-alpha.3` | 2026-04-23 |
| ✅ | **`setResources` / `<gina>` layout placeholders** — Port the asset-cataloguing pipeline so build-time `<link>` / `<script>` tags are auto-injected into nunjucks layouts the same way they are into swig layouts. `data.page.view.stylesheets` / `.scripts` now populated before render; post-render `injectAssets` helper auto-injects stylesheets before `</head>`, scripts before `</body>` (or before `</head>` when `javascriptsDeferEnabled`), plus `externalPlugins` and the `ginaLoader` before `</head>`. Templates may opt in explicitly with `{{ page.view.stylesheets \| safe }}` — exact-substring detection skips the auto-inject when they do. | `0.3.7-alpha.3` | 2026-04-23 |
| ✅ | **Static HTML cache parity** — Port the swig disk-write/serve cache path so `cache:` keys in `routing.json` actually produce cached HTML for nunjucks routes. | `0.3.7-alpha.4` | 2026-04-23 |
| ✅ | **Early Hints 103 auto-send for CSS/JS preloads** — Move the 103 path in `controller.js this.render()` to be engine-agnostic. Pure perf optimisation; manual `self.setEarlyHints(linkHeader)` already works. | `0.3.7-alpha.4` | 2026-04-23 |

### Eval safety

Complete the removal of `eval` / `new Function` call sites from the published tarball. Four tranches shipped across `0.3.7-alpha.4` / `0.3.7-alpha.5` cleared 13 of 24 catalogued sites; 2 more were removed by deleting orphaned source during the toolbar cleanup (15 of 24 addressed). The validator structural refactor cleared 3 more on `0.3.13-alpha.2` (18 of 24). The two remaining clusters — the feature-intrinsic eval design pass and the logger circular-require refactor — completed the campaign in `0.3.13`. The single remaining eval is a load-bearing public-API site (user-defined form validators), kept by design with a documented trust model.

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Validator structural refactor** — Refactored `makeObjectFromArgs` in the validator plugin: the previous string-accumulator path-build + runtime evaluation is replaced by a segments-array threaded through the recursion plus a local safe setter. Cleared 3 eval sites. +27 parity tests in `test/lib/validator-scs1f.test.js`. Browser bundle rebuilt. | `0.3.13-alpha.2` | 2026-05-13 |
| ✅ | **Feature-intrinsic eval design pass** — 6 sites that eval user-supplied JS by design, across 3 patterns (HTML event callbacks, user-defined form validators, conditional binding fallback). The design pass formalised the trust model; the coding slices dropped the HTML-event-callback evals and the conditional-binding fallback, and documented the user-defined-validator site as a load-bearing public API with an invariant test. | `0.3.13-alpha.3` | 2026-05-14 |
| ✅ | **Logger circular-require refactor** — 3 load-bearing `eval(fs.readFileSync(...))` fallbacks in the logger worked around a circular `merge → helpers → logger` require chain. Fixed at the source of the cycle: `merge.js` now requires the json-clone primitive directly instead of going through the helpers loader, so the circular chain never fires and the 3 eval fallbacks are unreachable and removed. | `0.3.13` | 2026-05-14 |

---

## Web Security

Cross-site request forgery protection. Three-phase defense-in-depth plan aligned with OWASP ASVS 4.0 V4.2.1; each phase shippable on its own. All three phases shipped: cookie hardening in `0.3.7-alpha.8`, signed double-submit token middleware in `0.3.7-alpha.9`, Origin/Referer pre-filter in `0.3.7-alpha.10`.

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Cookie hardening (baseline)** — Opt-in plugin `gina.plugins.Session` wraps `express-session` and injects `SameSite=Lax` + `HttpOnly` + `Secure=auto` defaults from `settings.json > session.cookie.{sameSite,httpOnly,secure}` into the cookie options before the middleware sees them. Bundle-supplied cookie options always win, so intentional configuration is preserved. Adoption is a one-line swap in the bundle bootstrap: `var session = require('gina').plugins.Session(require('express-session'))`. Browser-parity invariant enforced at factory call time: `SameSite=None` without `Secure` throws at bundle startup. Migration guide flags cross-site cookie-send bundles (rare — third-party OAuth embeds, iframe flows) that must set `sameSite: "none"` + `secure: true` explicitly. 41 unit tests (source-inspection guards + mergeCookie + invariant negative-lock + resolveSettingsDefaults + end-to-end through stub express-session + registration + template integrity). | `0.3.7-alpha.8` | 2026-04-24 |
| ✅ | **Signed double-submit token middleware** — Stateless signed-double-submit-cookie pattern (OWASP ASVS 4.0 V4.2.1). Opt-in plugin `gina.plugins.Csrf()`: HMAC-SHA256 cookie bound to session ID + matching `X-Gina-CSRF-Token` header (or `_csrf` form field) required on POST/PUT/PATCH/DELETE; `timingSafeEqual` comparison; safe methods (GET/HEAD/OPTIONS) pass through. Per-route opt-out via `routing.json > "csrfExempt": true` for webhook receivers (Stripe, GitHub, etc.). Server secret read from `process.env.GINA_CSRF_SECRET` at factory-call time — no dev fallback. Sessionless or session-after-csrf misorder produces a clear `next(err)` message pointing at the fix. Stateless so it scales with distributed Redis/K8s sessions without server-side storage; signed so sibling subdomains cannot inject cookies. 69 unit tests (source-inspection guards, generateToken/verifyToken primitives, negative-invariant lock, issue + verify middlewares, per-route exempt, plugin registration, settings template integrity). Validator AJAX header injection + controller template context (`{{ gina.csrfToken }}` / `{{ gina.csrfInput \| safe }}`) ship in follow-up commits. | `0.3.7-alpha.9` | 2026-04-25 |
| ✅ | **Origin/Referer pre-filter** — Secondary check on mutating methods, layered on top of the token middleware INSIDE `gina.plugins.Csrf()`: parses `Origin` first, falls back to the host portion of `Referer`, and matches against `settings.json > csrf.allowedOrigins`. Both headers missing → 403 `missing origin/referer`. Mismatch → 403 `origin not allowed`. Empty/unset `allowedOrigins` defaults to `[bundleHostname]` (auto-derived from `conf[bundle][env].hostname` or composed from `server.scheme + host + server.port`); non-empty = explicit allowlist for multi-domain bundles. Per-route `csrfExempt: true` bypasses BOTH Origin and token layers consistently. Negative-invariant lock: matching token + mismatching Origin still 403s — token layer ≠ Origin layer. Factory throws at startup when neither a settings allowlist nor a bundle hostname can be resolved. 54 unit tests added (parseRequestOrigin/parseOriginString helpers, resolveBundleHostname, resolveAllowedOrigins precedence, behavioural matrix Origin × Referer × allowlist, scheme/port discrimination, `Origin: "null"` sentinel handling, negative-invariant lock, exempt interaction, source-inspection guards pinning the pre-filter ordering). Full suite 3822/3822 (prior 3768 + 54). | `0.3.7-alpha.10` | 2026-04-26 |

---

## Web Security Headers

HTTP security response headers as opt-in `gina.plugins.*` middlewares, mirroring the `Session` (#CSRF1) and `Csrf` (#CSRF2/#CSRF3) plugin shape. Each plugin is single-concern, opt-in by default-off, and reads its config from a flat top-level `settings.json` key. Native implementation — no `helmet` dependency. **Phase 1** covers the five modern critical headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, Origin-Agent-Cluster) — all shipped in `0.3.15-alpha`. **Phase 1.5** covers helmet-parity gap-fill (HidePoweredBy, X-DNS-Prefetch-Control, X-XSS-Protection, X-Download-Options, X-Permitted-Cross-Domain-Policies) — defense-in-depth + parity-with-helmet narrative; modest practical value. **Phase 2** covers CSP + COEP/COOP/CORP (dynamic / higher-break-risk, deferred to `0.4.0`). CORS handling is separate and already lives in `core/server.js` (request-side).

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **`X-Content-Type-Options: nosniff` middleware** — Opt-in plugin `gina.plugins.XContentTypeOptions()` returns an Express-compatible middleware that emits the `X-Content-Type-Options: nosniff` response header on every response (the only valid value per RFC 7034 / WHATWG Fetch Standard). Adoption is two lines: `var xContentTypeOptions = require('gina').plugins.XContentTypeOptions(); app.use(xContentTypeOptions);`. Idempotent — if an earlier middleware already set the header, the existing value is preserved (safe to stack with helmet-style upstream gates). No `enabled` flag — register to opt in, don't register to opt out. Settings template seeds `xContentTypeOptions: {}` with the block reserved for future fields (per-route opt-out, etc.); future additions do not need an API break. Establishes the per-header response-middleware shape that the rest of Phase 1 (X-Frame-Options, Referrer-Policy, HSTS, Origin-Agent-Cluster) will mirror. 33 unit tests; full suite 5467/5467. | `0.3.15-alpha` | 2026-05-17 |
| ✅ | **`X-Frame-Options` clickjacking-defense middleware** — Opt-in plugin `gina.plugins.XFrameOptions({ value })`. Settings: `xFrameOptions.value: "DENY"` or `"SAMEORIGIN"` (default `"SAMEORIGIN"`). Caller options always win over settings; values are normalised to uppercase. Validation rejects the legacy `"ALLOW-FROM"` value at factory call time with a dedicated error pointing at the modern `Content-Security-Policy: frame-ancestors` replacement (modern browsers never honoured ALLOW-FROM cross-vendor). Idempotent — first-writer-wins. 51 unit tests. | `0.3.15-alpha` | 2026-05-17 |
| ✅ | **`Referrer-Policy` middleware** — Opt-in plugin `gina.plugins.ReferrerPolicy({ value })`. Settings: `referrerPolicy.value` is one of the eight W3C tokens (`"no-referrer"`, `"no-referrer-when-downgrade"`, `"origin"`, `"origin-when-cross-origin"`, `"same-origin"`, `"strict-origin"`, `"strict-origin-when-cross-origin"`, `"unsafe-url"`). Default `"strict-origin-when-cross-origin"` matches the browser default since ~2021. Caller options always win over settings; values are normalised to lowercase per the W3C spec's case-insensitive matching. Invalid tokens throw at factory call time with the full eight-token list + W3C spec URL in the message. Idempotent — first-writer-wins. 56 unit tests. | `0.3.15-alpha` | 2026-05-17 |
| ✅ | **`Strict-Transport-Security` (HSTS) middleware** — Opt-in plugin `gina.plugins.Hsts({ maxAge, includeSubDomains, preload })`. Defaults: `maxAge: 15552000` (180 days), `includeSubDomains: false`, `preload: false`. Caller options always win over settings. Browser-parity invariant: `preload: true` requires `includeSubDomains: true` AND `maxAge >= 31536000` (1 year) per the HSTS preload-list submission requirements; factory throws at call time on invariant violations with a pointer at https://hstspreload.org/. Also throws on non-integer / negative / NaN / Infinity `maxAge`. Header value built per RFC 6797 §6.1 directive order (`max-age=<n>; includeSubDomains; preload`). Spec deviation documented: emits on every response (helmet-aligned) rather than gating HTTPS-only — receiver enforces correctly anyway per RFC 6797 §8.1. Idempotent — first-writer-wins. 69 unit tests. | `0.3.15-alpha` | 2026-05-17 |
| ✅ | **`Origin-Agent-Cluster: ?1` middleware** — Opt-in plugin `gina.plugins.OriginAgentCluster()` requests origin-keyed agent clustering — same-site cross-origin pages get isolated agents (can no longer reach in via `document.domain`), mitigating one class of Spectre side-channel attack. Per the HTML spec, `?1` (Structured Header boolean true) is the only useful value; no tunable options. Browser support: Chrome 88+, Edge 88+, Firefox 109+, Safari 15+. Mirrors the #HDR1 shape exactly. Idempotent — first-writer-wins. 33 unit tests. **Closes Phase 1 (modern critical coverage).** | `0.3.15-alpha` | 2026-05-17 |
| 📋 | **Phase 1.5 — `HidePoweredBy` (#HDR8)** — `gina.plugins.HidePoweredBy()` removes the `X-Powered-By` response header (Express's `X-Powered-By: Express` leaks framework identity). REMOVE shape (`res.removeHeader`), unlike the SET shape of every other plugin in the track. Modest practical value; helmet covers it. | `0.3.16-alpha` | Q2 2026 |
| 📋 | **Phase 1.5 — `X-DNS-Prefetch-Control` (#HDR9)** — `gina.plugins.XDnsPrefetchControl({ value })`. Default `"off"` (matches helmet). Marginal value — modern browsers mostly ignore the header. | `0.3.16-alpha` | Q3 2026 |
| 📋 | **Phase 1.5 — `X-XSS-Protection: 0` (#HDR10)** — `gina.plugins.XXssProtection()` emits `0` to DISABLE Chrome's legacy XSS auditor (deprecated; auditor had its own vulnerabilities). Near-zero practical value in 2026 (Chrome dropped the auditor in 78; Firefox / Safari never implemented). | `0.3.16-alpha` | Q3 2026 |
| 📋 | **Phase 1.5 — `X-Download-Options: noopen` (#HDR11)** — `gina.plugins.XDownloadOptions()` IE8+ legacy header. Modern browsers ignore. Defense-in-depth for IE11 holdouts only. | `0.3.16-alpha` | Q3 2026 |
| 📋 | **Phase 1.5 — `X-Permitted-Cross-Domain-Policies` (#HDR12)** — `gina.plugins.XPermittedCrossDomainPolicies({ value })`. Restricts Adobe Flash / PDF cross-domain. Flash EOL since 2020; PDF readers mostly ignore. Helmet still ships it. | `0.3.16-alpha` | Q3 2026 |
| ✅ | **`Content-Security-Policy` middleware (Phase 2 — static directives)** — Opt-in plugin `gina.plugins.Csp({ directives, reportOnly })`. **Opens Phase 2** of the security-headers track. v0 ships static directives only; per-response nonce wiring requires template-render integration and defers to a future CSP-aware view-layer plugin. Strict whitelist of 27 CSP Level 3 standard directives — unknown directive names throw at factory call time (CSP typos are silent at the browser; fail-fast catches them). Value parsing accepts arrays of source-list tokens (joined with space), pre-formatted strings, `true` (boolean-only directives + `sandbox`), or `false` (omit). `reportOnly: true` emits `Content-Security-Policy-Report-Only` for non-enforcing migration testing. `directives` is required — no sensible cross-bundle default. Mirrors the HDR1-7 shape (idempotent first-writer-wins via `res.getHeader`). 92 unit tests; full suite 5768/5768. HDR6 Coep/Coop/Corp three-plugin split (per wrapper-consistency design) + HDR15 `SecurityHeaders` combined wrapper composing HDR1-7 + HDR5 + HDR6/13/14 to follow. | `0.4.0-alpha` | 2026-05-17 |
| 📋 | **`Cross-Origin-{Embedder,Opener,Resource}-Policy` (Phase 2)** — Opt-in plugin `gina.plugins.CrossOriginPolicies({ embedder, opener, resource })` — COEP/COOP/CORP browsing-context isolation. Distinct from CORS (request-side, handled in `core/server.js:1362-1520`). Can break legitimate cross-origin resource loading; opt-in even more conservatively than Phase 1. | `0.4.0` | Q1 2027 |

---

## Secrets & Configuration

Secrets handling for bundle JSON configs without baking plaintext values into source. Pluggable-backend design with `process.env` as the default; the reserved API surface allows future Vault / SOPS / K8s Secrets backends to slot in without changing call sites or the placeholder syntax.

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **`${secret:KEY}` placeholder substitution** — `lib/secrets` resolves `${secret:KEY}` placeholders embedded in bundle JSON configs (`settings.json`, `app.json`, `connectors.json`, `mcp.json`, etc.) at config-load time. Anchored regex matches the entire string value only — mixed strings (`"prefix-${secret:K}-suffix"`) pass through unchanged. Default backend reads `process.env[KEY]`; pluggable-backend interface reserved for a future iteration. Fails closed (throws `Error('Secret resolution failed')`) when an env var is unset or empty; the error message intentionally omits the key name. Resolution is once per config-load cycle (in-place mutation). `WeakMap`-backed path tracking enables a future log-redaction wrapper at merged-conf print sites. Hooked inside `core/config.js::loadBundleConfig`, so downstream readers (`getConfig()`, plugin factories) see resolved values transparently. **Consumers shipped**: `gina.plugins.Csrf()` reads `settings.csrf.secret` (precedence `opts.secret` > `settings.csrf.secret` > `process.env.GINA_CSRF_SECRET` for back-compat); `gina bundle:mcp-start` re-runs the resolver on the parsed `mcp.json` immediately after `requireJSON()` so `server.authToken` and any future placeholder field gets filled before downstream readers; bundle scaffolding (`project:add` / `bundle:add`) recommends the placeholder shape in `core/template/conf/settings.json` and `core/template/boilerplate/bundle/index.js`. 33 tests in `test/core/config-secrets-resolver.test.js`. | `0.3.13-alpha` | 2026-05-13 |

---

## Connectors

New database connectors follow the same interface as the existing Couchbase connector: declared in `connectors.json`, acquired via `getConnection()`.

| Status | Connector | Version | Target | Notes |
| --- | --- | --- | --- | --- |
| ✅ | **Redis** | `0.2.0` | Q2 2026 | Session store and general-purpose cache. Client: `ioredis`. Required for K8s horizontal scaling. |
| ✅ | **SQLite** | `0.2.0` | Q2 2026 | Three use cases: framework state storage (replaces JSON files under `~/.gina/`), session store for single-pod/dev deployments, and embedded ORM connector. Uses `node:sqlite` (Node.js built-in since v22.5.0 — zero npm deps). Session store done (v1 — 2026-03-27 · `96c5808a`); ORM connector done (v2 — 2026-03-28 · `08ead296`); state storage done (v3 — 2026-03-28 · `da5c55ba`). |
| ✅ | **MySQL / MariaDB** | `0.3.0` | Q1 2026 | ORM connector. Client: `mysql2`. Entity wiring, `sql/` layout, `?` placeholders, `@param`/`@return` annotations, native Promise + `.onComplete()`. |
| ✅ | **PostgreSQL** | `0.3.0` | Q1 2026 | ORM connector. Client: `pg` (node-postgres). Entity wiring, `sql/` layout, `$1`/`$2` placeholders, `@param`/`@return` annotations, idle-client error guard, native Promise + `.onComplete()`. |
| ✅ | **ScyllaDB** | `0.4.0` | Q4 2026 | Cassandra-compatible wide-column store. Client: `cassandra-driver` (Apache Software Foundation; Node.js has no first-party shard-aware driver — token-aware routing only). ORM connector + session store via CQL `USING TTL`. Implemented 2026-05-09 (#CN5). |
| ✅ | **MongoDB** | `0.4.0` | Q4 2026 | Document store connector. Client: `mongodb` (official driver, `>=7.0.0`). ORM connector with `pipelines/<Entity>/*.json` files (JSON body + JSDoc-style `@param`/`@return` annotations + `{$arg: N}` positional placeholders + `{$oid: <hex>}` ObjectId literals + `$scope` substitution at load time). Session store backed by a TTL index (`createIndex({expiresAt: 1}, {expireAfterSeconds: 0})` auto-created on first `set()` with one-shot guard). `get()`/`length()`/`all()` filter on `expiresAt` to protect against MongoDB's 60s TTL monitor lag. Implemented 2026-05-09 (#CN6). |
| ✅ | **Couchbase SDK v2 deprecation** | `0.2.0` | 2026-03-27 | Couchbase Server SDK v2 reached end-of-life in 2021. `connector.v2.js` now logs a deprecation warning at connection time, and a fatal error when V8 pointer compression is active (NAN bindings are incompatible). Upgrade path: set `sdk.version` to `3` or `4` in your bundle's `connectors.json`. |
| 📋 | **Couchbase SDK v2 removal** | `0.4.0` | Q4 2026 | `connector.v2.js` and all `sdk.version <= 2` branches removed. Default falls back to v3 when `sdk.version` is unset. Full migration guide in `CHANGELOG.md`. |
| ✅ | **`peerDependencies` for connector clients** | `0.3.0` | 2026-04-01 | All connector client libraries (`ioredis`, `mysql2`, `pg`, `mongodb`, `@scylladb/scylla-driver`, `couchbase`, `openai`, `@anthropic-ai/sdk`) are declared as optional `peerDependencies`. Signals the tested version range to npm/yarn and surfaces a compatibility warning when a user pins an untested version. Zero framework runtime dependency — clients are always loaded from the project's `node_modules`. |
| ✅ | **`connector:*` CLI group + lint/fix migration** | `0.3.8` | Q2 2026 | New CLI for managing `connectors.json` at project (shared) or bundle scope: `connector:list`, `connector:add`, `connector:rm`, `connector:migrate`. Positional-absence signals scope — omit `<bundle>` to operate on `shared/config/connectors.json`, include it to operate on the bundle's own. `list` cross-references declared connectors against the project's `node_modules` and prints install status per driver. `add` writes the JSON entry and prints the exact `npm install <driver>@<range>` command (no auto-install in v1). `rm` supports `--dry-run` / `--force` and scans sibling bundles for usage before removing at project scope. `migrate` lints every `connectors.json` (or a single bundle's file) and, with `--fix`, injects missing `$schema` entries while preserving comment headers and key order — dry-run by default. Framework-side auto-migrate hook deferred to `0.4.0` alongside the Couchbase SDK v2 removal where a concrete old-shape → new-shape delta will justify touching the boot path. Adds a `version` property to the `connectors.json` schema for install-version resolution. Optional follow-up: `--install` flag with lockfile-based package manager detection. **Session 1 (`connector:list`) shipped 2026-04-21, `0.3.7-alpha.3`** — read-only lister with overlay/override detection, driver install probing, version-pin disagreement warnings, JSON output, 89 source-inspection unit tests. **Session 2 (`connector:add` + schema `version`) shipped 2026-04-21, `0.3.7-alpha.3`** — writes shared or bundle-scoped connector entries, infers type from `<name>`, preserves comment headers and key order, pins `$schema` at the top, rejects overwrites without `--force`, prints `npm install <pkg>@"<range>"` install hint (AI resolves per protocol scheme, sqlite short-circuits to built-in note), adds `version` property to `schema/connectors.json`. 94 source-inspection unit tests; 7 live smoke tests. CLI flag rename (`--connector-port=`/`--driver-version=`) avoids framework-reserved `--port`/`--version`. **Session 3 (`connector:rm`) shipped 2026-04-21, `0.3.7-alpha.3`** — removes shared or bundle-scoped entries via positional-absence scoping (`remove` alias accepted); `--dry-run` previews without writing; `--force` skips the project-level usage guard that otherwise refuses when any bundle still references the same logical name; driver-retention hint prints after every removal naming sibling bundles that still use the same driver (sqlite exempt — built-in); inherited-from-shared hint fires when rm from a bundle targets an entry declared only in shared. Never runs `npm uninstall`. 81 source-inspection unit tests. **Session 4 (`connector:migrate`) shipped 2026-04-21, `0.3.7-alpha.3`** — CLI-only linter: dry-run by default, `--fix` applies auto-fixable issues in place. Two detection types: `missing-schema` (auto-fixable, injects `"$schema": "https://gina.io/schema/connectors.json"` pinned at top while preserving comment header and key order) and `bare-key-no-connector` (entry key not in `couchbase, mysql, postgresql, sqlite, redis, ai` enum with no `connector` field — warn-only since driver cannot be inferred). Two invocation modes via positional-absence: `@<project>` scans shared + every bundle; `<bundle> @<project>` scans just that bundle. `--format=json` emits `{project, scope, bundle, fixApplied, files[]}` envelope for CI. Registered as offline — no framework socket required. Idempotent. Never modifies `core/config.js` and never runs at bundle boot — explicit and opt-in. Real framework-side hook deferred to `0.4.0` alongside Couchbase SDK v2 removal. 87 source-inspection unit tests; full write-path smoke test on a disposable sandbox (shared + two bundles), plus a no-false-positive smoke on a real 7-bundle project. |

---

## Couchbase Connector Hardening

A cold audit of the Couchbase connector identified two critical security vulnerabilities and four high-severity bugs. All items are contained to specific code paths and do not affect the common case (v4 SDK, Promise API, no `useRestApi`), but they should be resolved before the next stable release.

### Critical — Security

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Credential exposure in process list (`restQuery`)** — The `useRestApi: true` path built a shell command containing `-u username:password` passed to `exec()`. Plaintext credentials were visible in `ps aux` for the duration of the call. Fixed: replaced `exec()` with `execFile()` — credentials passed as positional arguments, never in the shell string. | `0.2.0` | 2026-03-27 |
| ✅ | **Shell command injection in `restQuery`** — The same `exec()` path joined the N1QL statement and query parameters into a single shell string. Metacharacters (`$`, `;`, `&`, `|`, backtick) in parameters were not neutralised. Fixed: same change as above — `execFile()` eliminates the shell entirely. | `0.2.0` | 2026-03-27 |

### High — Bugs

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **`gina.onError()` handler accumulates on every reconnect** — The error handler was registered inside `onConnect()`, which fired on every reconnection. After N reconnects, N stacked handlers raced on the same error. Fixed: `_errorHandlerRegistered` guard ensures the handler is registered only once per connector instance. | `0.2.0` | 2026-03-27 |
| ✅ | **`session-store.v3 get()` always returns "session not found"** — `.then()/.catch()` callbacks are microtasks; the `if (!data)` guard ran synchronously before they resolved. Every session read returned empty. Fixed: rewrote `get()` with `async/await`, matching the v4 store. | `0.2.0` | 2026-03-27 |
| ✅ | **`session-store.v3 set()` silently discards writes** — Same async/sync confusion. `fn(false, null)` was called before the upsert Promise resolved. Fixed: rewrote `set()` with `async/await`. | `0.2.0` | 2026-03-27 |
| ✅ | **Infinite recursion when `keepAlive: false`** — The `else` branch in `ping()` called itself unconditionally. Stack overflow on first connection with `keepAlive: false`. Fixed: replaced the unconditional self-call with `return`. | `0.2.0` | 2026-03-27 |

### Medium

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **300ms arbitrary startup delay** — A `setTimeout(300)` was firing `ready` instead of a condition. Added 300ms to every Couchbase-connected bundle startup and was unreliable under load. Fixed: `self.emit('ready')` now fires directly. | `0.3.0` | 2026-03-28 |
| ✅ | **`ping()` drops reconnection callback in v2/v3** — `typeof(next)` was checked but `next` was not in scope, so reconnect-from-ping always called `connect()` without a callback, silently swallowing errors. Fixed: changed to `typeof(ncb)` and pass `ncb` on reconnect. | `0.3.0` | 2026-03-28 |
| ✅ | **Stack traces in HTTP 500 responses** — `err.stack` was included in the JSON sent to the HTTP client, exposing absolute filesystem paths and internal module names. Fixed: stack logged server-side; client receives only the error message. | `0.3.0` | 2026-03-27 |
| ✅ | **`eval()` for `@options` parsing** — `@options` directives in `.sql` files were evaluated with `eval()`. Fixed: replaced with a regex key-normalisation pass then `JSON.parse()` — handles all production value shapes correctly. | `0.3.0` | 2026-03-28 |
| ✅ | **`bulkInsert` does not return a Promise** — Unlike all other N1QL entity methods, `bulkInsert` returned a plain `{onComplete: fn}` object. Fixed: converted to the Option B Promise pattern with `.onComplete(cb)` chaining. | `0.3.0` | 2026-03-28 |

---

## K8s & Docker

| Status | Feature | Version | Date |
| --- | --- | --- | --- |
| ✅ | **Graceful shutdown on SIGTERM** — `server.close()` drains in-flight requests with configurable hard timeout (`GINA_SHUTDOWN_TIMEOUT`). | `0.1.8` | 2026-03-06 |
| ✅ | **`gina-container` foreground launcher** — Drop-in entrypoint for Docker/K8s. Spawns the bundle non-detached, forwards SIGTERM, exits with the child's code. No framework socket server required. | `0.1.8` | 2026-03-06 |
| ✅ | **Stdout/stderr structured logging** — `GINA_LOG_STDOUT=true` emits JSON lines compatible with `kubectl logs`, Fluentd, and Datadog. | `0.1.8` | 2026-03-21 |
| ✅ | **`gina-init` — stateless container bootstrap** — Generates all required `~/.gina/` config from env vars or a mounted JSON file. Idempotent. Makes the framework init-container friendly. | `0.1.8` | 2026-03-22 |
| ✅ | **Session storage for horizontal scaling** — Redis session store (multi-pod) + SQLite session store (single-pod/dev) + full sessions guide. | `0.2.0` | Q2 2026 |

---

## Observability

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Prometheus metrics endpoint** — Built-in `/_gina/metrics` endpoint exposing Prometheus-format metrics. Opt-in via `app.json` (`"metrics": { "enabled": true }`). Collects Node.js process metrics (heap, GC, event loop lag) automatically via `prom-client.collectDefaultMetrics()`, plus HTTP request metrics — count, latency histogram, status-aware fallback labels — sourced from `req.routing.rule` (routing.json key, cardinality-safe; never the raw URL). `prom-client` is loaded from the user project's `node_modules` (peer dependency, same pattern as `ioredis` and `mysql2`). Endpoint is IP-restricted by default (loopback only; configurable via `metrics.allowFrom` in `app.json`); reads client IP from `req.socket.remoteAddress` only — does NOT trust `X-Forwarded-For`. Each bundle self-reports on its own port — point Prometheus at `host:port/_gina/metrics` per bundle, no sidecar required. | `0.3.11-alpha` | 2026-05-09 |

---

## HTTP/2

| Status | Feature | Version | Target | Notes |
| --- | --- | --- | --- | --- |
| ✅ | **Fix `/_gina/info` HTTP/2 endpoint** — `stream.end(infoStatus)` not `stream.end(infoHeaders)` | `0.2.0` | Q2 2026 | The HTTP/2 branch of the info endpoint passes the headers object instead of the JSON string. Returns `[object Object]` instead of JSON. One-line fix. |
| ✅ | **Add stream-closed guard to HTML error response** — `stream.destroyed \|\| stream.closed` check in `throwError()` | `0.2.0` | Q2 2026 | JSON error path has this guard; HTML path does not. If the stream closes during error handling, Node.js emits an unhandled error. |
| ✅ | **HTTP/2 server security settings** — `maxHeaderListSize: 65536`, `enablePush: false`, `maxSessionInvalidFrames`, `maxSessionRejectedStreams` | `0.2.0` | Q2 2026 | Four missing settings on the server. `maxHeaderListSize` prevents HPACK bomb attacks (only set on the client today). `enablePush: false` — server push is deprecated in Chrome 106+ and removed in Firefox 132+. `maxSessionInvalidFrames` and `maxSessionRejectedStreams` defend against CONTINUATION flood (CVE-2024-27316) and RST flood / rapid reset (CVE-2023-44487). |
| ✅ | **103 Early Hints** — send `Link` preload headers as informational response before the final response | `0.3.0-alpha.1` | 2026-03-31 | `self.setEarlyHints(links)` on SuperController. HTTP/2: `stream.additionalHeaders({ ':status': 103 })`; HTTP/1.1: `res.writeEarlyHints()` (Node.js 18.11+). Silent no-op on unsupported runtimes. |
| ✅ | **HTTP/2 session metrics** — expose active session count, stream count, GOAWAY and RST_STREAM totals via `/_gina/info` | `0.3.0-alpha.1` | 2026-04-01 | `server._h2Metrics` counter object instrumented via session event handlers; exposed under `"http2"` key in `/_gina/info` JSON. |
| ✅ | **Configurable `maxConcurrentStreams` and `initialWindowSize`** — move from hardcoded to `settings.json` `http2Options` | `0.3.0-alpha.1` | 2026-04-05 | All four HTTP/2 server settings configurable: `maxConcurrentStreams` (256), `initialWindowSize` (655350), `maxSessionRejectedStreams` (100), `maxSessionInvalidFrames` (1000). Security guards (`maxHeaderListSize`, `enablePush`) remain hardcoded. |
| ✅ | **Application-level rapid reset rate limiter** (CVE-2023-44487) — per-session stream creation counter | `0.3.13` | 2026-05-14 | The Isaac HTTP/2 session handler counts new streams in a rolling 1s window per session; over `maxStreamsPerSecond` (default 200) it sends a GOAWAY and closes the session. More targeted than `maxSessionRejectedStreams` (which counts refused streams, not created ones). Configurable via `settings.json` `http2Options.maxStreamsPerSecond`; `/_gina/info` exposes a `rapidResetBlocked` counter. |
| 📋 | **Trailer support** — `stream.sendTrailers()` + `waitForTrailers: true` | `0.4.0` | Q4 2026 | No trailer support today. Required for gRPC-style streaming (grpc-status trailer) and content integrity use cases. Opt-in: activated only when a controller calls `self.sendTrailers(fields)`. |
| 📋 | **Alt-Svc header** — advertise HTTP/3 availability | `0.5.0` | Q1 2027 | Set `Alt-Svc: h3=":443"; ma=86400` response header to advertise HTTP/3 (QUIC) availability via a QUIC-capable reverse proxy (nginx, Caddy, Cloudflare). Gina does not need to implement QUIC — just announce it. Opt-in via `settings.server.json`. Native HTTP/3 is out of scope: Node.js has no stable QUIC API, and the standard deployment topology (Gina → proxy → client) already delivers HTTP/3 at the edge. |
| 📋 | **RFC 9218 Extensible Priorities** — read `Priority: u=N, i` request header | `0.5.0` | Q1 2027 | Use the RFC 9218 priority header to order response writes for multiplexed API clients. Low value for typical HTML page loads; high value for parallel API requests with declared urgency. |
| 📋 | **WebSocket over HTTP/2** (RFC 8441 — CONNECT method extension) | `0.5.0` | Q1 2027 | Tunnel WebSocket over an HTTP/2 stream without a separate HTTP/1.1 connection. Node.js supports this since v10.19. Enables WebSocket in HTTP/2-only deployments. |

---

## AI

### Phase 1 — AI can write Gina code correctly

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **JSON Schemas for config files** — Machine-readable schemas for `routing.json`, `connectors.json`, `app.json`, `settings.json`, `app.crons.json`. Adds `"$schema"` references to generated scaffold files. Gives editors free validation and autocomplete; gives AI assistants authoritative field names so generated config is correct on the first attempt. | `0.2.0` | Q2 2026 |
| ✅ | **Publish JSON Schema files at `gina.io/schema/*`** — 7 JSON Schema files published: `app.json`, `app.crons.json`, `connectors.json`, `manifest.json`, `routing.json`, `settings.json`, `watchers.json`. IDEs can now download and validate config files automatically. | `0.3.2` | Q3 2026 |
| ✅ | **TypeScript declaration files** — Cross-listed with Modernisation Phase 4. Essential for AI code generation accuracy. | `0.3.3-alpha.3` | 2026-04-09 |

### Phase 2 — Gina apps can use AI

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **AI connector** — Declare any LLM provider in `connectors.json` via named protocol (`anthropic://`, `openai://`, `deepseek://`, `qwen://`, `groq://`, `mistral://`, `gemini://`, `xai://`, `perplexity://`, `ollama://`). Unified `.infer(messages, options)` normaliser + raw `.client` for advanced use. | `0.3.0` | Q1 2026 |
| ✅ | **`renderStream` — streaming responses** — `self.renderStream(asyncIterable, contentType)` streams SSE or chunked JSON without buffering. Required for LLM token streaming without bypassing the render pipeline. | `0.3.0` | 2026-03-31 |
| 📋 | **Async job pattern for slow AI calls** — First-class "start job → return jobId → poll or webhook on completion" pattern integrated with the cron/queue infrastructure. Prevents LLM latency (1–30s) from blocking the response pipeline. | `0.4.0` | Q4 2026 |

### Phase 3 — AI agents can consume Gina apps

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **OpenAPI spec generation** — `gina bundle:openapi @myproject` emits `openapi.json` from `routing.json`. Zero manual spec writing — route annotations become `description` fields. Makes any Gina app consumable by AI agents, API gateways, and testing tools. Alias: `bundle:oas`. Supports `--output` flag for custom path. | `0.3.3-alpha.2` | 2026-04-08 |
| ✅ | **MCP server wrapper** — Phase 1 (done, `0.3.7-alpha.2`, 2026-04-18): `gina bundle:mcp @myproject` emits a static MCP tool manifest (`mcp.json`) targeting MCP spec revision 2025-06-18. Phase 2a (done, `0.3.7-alpha.3`, 2026-04-18): `gina bundle:mcp-start <bundle> @myproject` serves the manifest as a live MCP server over stdio (JSON-RPC 2.0, newline-delimited). `tools/call` is dispatched as real HTTP requests against the running bundle. Phase 2b (done, `0.3.7-alpha.2`, 2026-04-22): Streamable HTTP transport for remote/containerised agents — `gina bundle:mcp-start <bundle> @myproject --transport=http`. Opt-in static bearer auth via `--auth-token`, built-in loopback `Origin` allowlist, full CORS echo, SSE response mode, JSON-RPC 2.0 batch, `Mcp-Session-Id` lifecycle. OAuth 2.1 intentionally out of scope — deploy behind a reverse proxy. Live end-to-end smoke recipe ready for the next alpha release. | `0.3.7-alpha.2` | 2026-04-22 |

---

## Performance

| Status | Feature | Version | Target | Notes |
| --- | --- | --- | --- | --- |
| ✅ | **`NODE_COMPILE_CACHE` — V8 bytecode startup cache** | `0.2.0` | Q2 2026 | Node.js 22.8+ caches compiled V8 bytecode to disk. Set once at startup — 30–60% faster cold start on subsequent runs with zero code changes to user bundles. No-op on Node < 22.8, so safe to ship unconditionally. |
| ✅ | **Route radix trie — compile `routing.json` at startup** | `0.3.0-alpha.1` | 2026-04-01 | `lib/routing/src/radix.js` builds a segment-level trie once at startup. O(m) candidate lookup per request (m = segment count). `Set.has()` check skips non-candidates in the `for…in` loop. Internal change — no user-facing API change. |
| 📋 | **Bun runtime compatibility investigation** | `0.4.0` | Q4 2026 | Prototype Gina under Bun. Two blockers to verify: `require.cache` deletion (dev hot-reload) and `node:http2` completeness. If both pass, Bun gives 3–10x faster startup and meaningful throughput gains. Deliverable: a compatibility report. |
| ✅ | **V8 pointer compression support** | `0.2.0` | Q2 2026 | Node.js built with `--experimental-enable-pointer-compression` (e.g. [node-caged](https://github.com/platformatic/node-caged) or a custom build) delivers ~50% heap memory reduction across all pointer-heavy structures. Gina is pure JS — compatible out of the box. Adds: startup detection + `GINA_V8_POINTER_COMPRESSED` env var, Dockerfile guide with custom build recipe (full-icu + pointer compression), 4 GB ceiling documentation, N-API-only connector policy. |

---

## Windows

Windows compatibility is a hard requirement for `1.0.0`. The alpha scope covers all core features: install, scaffold, bundle start/stop, routing, rendering, and basic CLI. Full production-grade parity is post-1.0.0.

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 📋 | **Windows alpha compatibility** — Install scripts, path handling, symlinks, and bundle lifecycle (start/stop/restart) work correctly on Windows. `bin/gina.bat` kept in sync with `bin/gina`. CI Windows runner required before this can be marked done. Out of scope for alpha: full build system (bash-based), Windows service integration, production-grade process management. | `1.0.0` | Q3 2027 |

---

## Inspector

Gina's built-in per-bundle inspector. Phases 1–2 ship as an embedded SPA at `/_gina/inspector/` inside every bundle's own HTTP server (dev mode). Phase 3 evolves it into a standalone web app served by `services/src/inspector/` that can connect to any bundle in any environment — including production. Beemaster (global admin app) is a separate project — also the planned home for content-management surfaces such as the **i18n translation editor** (the visual layer of i18n core).

**Why a standalone web app:** Electron is heavy and adds distribution burden. A browser extension is browser-specific and can't inspect from a different machine. The standalone web app works locally and remotely, any browser, zero install. A browser extension companion can be layered on top later.

### Phase 1 — Decouple in-page toolbar

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Thin in-page status bar** — Shadow DOM host (`#__gina-statusbar`, fixed bottom-right) in dev mode. Status dot, `bundle@env`, "Open Inspector" link to `/_gina/inspector/`. Pure vanilla JS — no RequireJS, no jQuery, no SASS. | `0.3.0` | 2026-04-01 |
| ✅ | **`window.__ginaData`** — Replace `<pre>` tag data embedding with `<script>window.__ginaData={...}</script>` (dev mode only). Inspector reads via `window.opener` or `postMessage`. | `0.3.0` | 2026-04-01 |
| ✅ | **Gina infrastructure port range 4100–4199** — Reserved for Gina infrastructure. `4100` = socket server (future), `4101` = Inspector standalone (future), `4102` = engine.io transport. Inspector currently served at `/_gina/inspector/` (same origin, no dedicated port). | `0.3.0-alpha.1` | 2026-04-01 |

### Phase 2 — Inspector core

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| ✅ | **Embedded SPA at `/_gina/inspector/`** — Served by the bundle's own HTTP server in dev mode. Engine-agnostic handler in `server.js` `onRequest()`. Same origin — `window.opener.__ginaData` always accessible. | `0.3.0-alpha.1` | 2026-04-02 |
| ✅ | **Data tab** — Full inspection UI (Data, View, Forms, Configuration, Routing sub-tabs). `renderTree()` for collapsible JSON trees; click-to-copy on leaf values. Routing tab fetches `/_gina/assets/routing.json`. | `0.3.0-alpha.1` | 2026-04-02 |
| ✅ | **Real-time data via engine.io** — Push-based data updates when engine.io is configured. | `0.3.0-alpha.1` | 2026-04-02 |
| ✅ | **Logs tab** — Real-time log tail with level filter, source filter (Client/Server), text search, pause/resume. Client logs via `window.__ginaLogs`; server logs via SSE (`/_gina/logs`). | `0.3.0-alpha.1` | 2026-04-02 |
| ✅ | **Query tab** — Per-request query instrumentation via AsyncLocalStorage in the Couchbase connector. Cross-bundle propagation via `__ginaQueries` JSON sidecar. Split trigger badge (entity\|method), SQL syntax highlighting, params table, free-text search. Tagged with `origin` (bundle) and `connector`. | `0.3.0-alpha.1` | 2026-04-03 |
| ✅ | **Remove legacy toolbar from `gina.min.js`** — Toolbar AMD module removed from RequireJS bundle. The `statusbar.html` shim is now the sole provider of `window.ginaToolbar` in dev mode. Guard fixes in `events.js` (unguarded call, `typeof == 'object'` null bug). Source directory retained for reference. | `0.3.0-alpha.1` | 2026-04-03 |
| ✅ | **Reorganize Inspector source to match plugin conventions** — Source moved into `html/`, `css/`, `js/`, `sass/` subdirectories. CSS converted to SCSS with nesting. Build script Phase 2 skips Inspector; Phase 3 compiles SCSS and copies to flat dist. Inspector CSS served separately, not concatenated into `gina.min.css`. | `0.3.0-alpha.1` | 2026-04-04 |

### Phase 3 — Production

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 🔨 | **`services/src/inspector/` standalone bundle** — ~~Rename `services/src/toolbar/` to `services/src/inspector/`~~ (done). Inspector SPA as a standalone gina bundle on port 4101. Connects to bundles via authenticated WebSocket. The embedded SPA at `/_gina/inspector/` remains for quick dev-mode access. | `0.5.0` | Q1 2027 |
| ✅ | **Agent endpoint — dev-mode SSE (`/_gina/agent`)** — Combined data + log SSE stream. CORS, server.js + server.isaac.js (HTTP/2), Inspector SPA `tryAgent()` with `?target=` param. Named events (`event: data`, `event: log`). Manual connect form on "No source" overlay. | `0.3.0` | 2026-04-05 |
| 📋 | **Agent endpoint — production auth** — Upgrade `/_gina/agent` to authenticated WebSocket. API key gating (`inspector.agent_key` in `settings.json`), production-safe toggle. | `0.5.0` | Q1 2027 |
| 📋 | **Toggleable instrumentation** — Runtime toggle for query instrumentation independent of `NODE_ENV_IS_DEV`. Enable in production for a time window without full dev mode. Minimal overhead when disabled. | `0.5.0` | Q1 2027 |
| 📋 | **Multi-bundle dashboard** — Discover all running bundles via `ports.json`, connect to each agent. Full-stack request tracing across bundle boundaries. | post-1.0.0 | — |
| 📋 | **Browser extension companion** — Chrome/Firefox DevTools panel. Thin UI shell connecting to the standalone Inspector via WebSocket. Optional — not a replacement. | post-1.0.0 | — |

---

## Tutorials

| Status | Tutorial | Duration | Version | Target |
| --- | --- | --- | --- | --- |
| ✅ | **Mobile Backend guide** — REST API patterns, JSON-only bundles, all HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD), standard response envelope, pagination, CORS middleware, session auth + token auth patterns, HTTP/2 benefits, `renderStream` for AI/SSE. Docs only — no code changes. | — | `0.3.0` | 2026-04-01 |
| ✅ | **Beginner — Notes API** — Your first REST API: scaffold a project, define 3 routes in `routing.json`, write synchronous controller actions, read `req.post` / `req.params`, return JSON with `renderJSON()`, handle errors with `throwError()`. In-memory store — no database needed. | ~15 min | `0.3.0` | 2026-04-01 |
| ✅ | **Tutorial locale detection** — `LocaleSettings` React component detects the reader's locale and timezone via `navigator.language` + `Intl` APIs and pre-fills the `settings.json` scaffold example. Inserted after the scaffold step in both tutorials. Falls back to `en_US`. | — | `0.3.0` | 2026-04-06 |
| ✅ | **Intermediate — Link Shortener** — SQLite ORM connector, async controller actions, `render()` + `renderJSON()` in same bundle, HTTP 302 redirect, route `requirements` guard. Includes downloadable project ZIP. | ~30 min | `0.3.0` | 2026-04-01 |
| 📋 | **Advanced** — Full production project: authentication, scoped data isolation, async/await, HTTP/2, structured logging, Docker/K8s deployment. Starts from the intermediate tutorial's finished state. | ~60 min | `0.4.0` | Q4 2026 |

---

## Website

| Status | Feature | Version | Target |
| --- | --- | --- | --- |
| 📋 | **Official website redesign + docs integration** — Refactor gina.io as a proper project homepage (landing page, feature highlights, showcase) with the documentation fully integrated. Single coherent web presence. Prerequisite: tutorials complete. | `0.4.0` | Q4 2026 |
| 📋 | **Docs offline ZIP** — One-click download of the complete gina.io documentation as a static HTML ZIP archive. Generated at deploy time by the Docusaurus build pipeline — no server-side logic required. Targeted at users in regions with limited or expensive internet access (offline-first for the African market). | `0.4.0` | Q4 2026 |
| ✅ | **Security & CVE compliance page** — Dedicated docs page listing the HTTP/2 CVEs addressed by Gina and the Node.js version required for each mitigation. Covers CVE-2023-44487 (Rapid Reset), CVE-2024-27316 / CVE-2024-27983 (CONTINUATION flood), CVE-2019-9514 (RST flood), HPACK bomb, and server push abuse. Docs only — no code changes. | `0.3.0-alpha.1` | 2026-04-01 |

---

*Last updated: 2026-04-09 (0.3.3-alpha.3 — TypeScript declarations, explicit exports via require('gina/gna')) · To suggest a feature, [open an issue](https://github.com/gina-io/gina/issues).*
