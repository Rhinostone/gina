# Content-Security-Policy Plugin (#HDR5)

Opt-in middleware that sets the `Content-Security-Policy` (or
`Content-Security-Policy-Report-Only`) response header on every response,
limiting which resources the browser is allowed to load and from where.

## Why

CSP is the modern defense against cross-site scripting (XSS) and data
injection attacks. By declaring a policy of allowed sources for scripts,
styles, images, fonts, frames, connections, etc., the browser refuses to
execute any resource that doesn't match the policy — even if an attacker
manages to inject a `<script>` tag into the page via stored XSS, the script
won't load unless its source is on the allowlist.

CSP also defeats whole classes of clickjacking (via `frame-ancestors`),
mixed-content downgrade (via `upgrade-insecure-requests`), and base-tag
manipulation (via `base-uri`) attacks.

Opens Phase 2 of the gina security-headers track. Phase 1 (HDR1-4 + HDR7)
shipped in `0.3.15-alpha`; CSP is the most-requested helmet header that
wasn't yet covered.

## Adoption

One block in the bundle bootstrap (`bundles/<name>/index.js`):

```js
var myapp = require('gina');
var csp   = require('gina').plugins.Csp({
    directives: {
        'default-src': ["'self'"],
        'script-src':  ["'self'", 'https://cdn.example.com'],
        'style-src':   ["'self'", "'unsafe-inline'"],
        'img-src':     ["'self'", 'data:', 'https:'],
        'upgrade-insecure-requests': true
    }
});

myapp.onInitialize(function(event, app) {
    app.use(csp);
    event.emit('complete', app);
});
```

Order with other gina security plugins does not matter — the header is
emitted on the response, not consumed from the request.

## Configuration

Settings.json shape — caller-supplied options always win over settings:

```jsonc
{
  "csp": {
    "directives": {
      "default-src": ["'self'"],
      "script-src":  ["'self'", "https://cdn.example.com"],
      "style-src":   ["'self'", "'unsafe-inline'"],
      "img-src":     ["'self'", "data:", "https:"]
    },
    "reportOnly": false
  }
}
```

| Field        | Type    | Default | Notes                                                                |
|--------------|---------|---------|----------------------------------------------------------------------|
| `directives` | object  | —       | **Required.** Throws if missing or empty. See "Directives" below.   |
| `reportOnly` | boolean | `false` | When `true`, emits `Content-Security-Policy-Report-Only` instead.   |

There is no sensible cross-bundle default for `directives`. Every bundle
has its own resource graph; a default policy would either be too restrictive
(breaks every bundle that loads external resources) or too permissive
(gives no real protection). **The factory throws at call time if
`directives` is missing or empty.**

## Directives

The plugin enforces a **strict whitelist of CSP Level 3 standard
directives**. Unknown directive names throw at factory call time —
fail-fast is the only way to catch typos like `scrpt-src` (browsers
silently ignore unknown directives, so without the throw the page would
be unprotected with no error).

Each directive value can be:

- **Array of source-list tokens** (recommended) — joined with space:
  `['\'self\'', 'https:']` → `default-src 'self' https:`
- **String** (pre-formatted source list) — emitted as-is:
  `"'self' https:"` → `default-src 'self' https:`
- **`true`** — emit the directive name alone (boolean-only directives, or
  `sandbox` with no value).
- **`false`** — omit the directive entirely.

### Categories

**Source-list directives** (string / array / `false`):

`child-src`, `connect-src`, `default-src`, `font-src`, `frame-src`,
`img-src`, `manifest-src`, `media-src`, `object-src`, `prefetch-src`,
`script-src`, `script-src-attr`, `script-src-elem`, `style-src`,
`style-src-attr`, `style-src-elem`, `worker-src`, `base-uri`,
`form-action`, `frame-ancestors`, `report-to`, `report-uri`,
`require-trusted-types-for`, `trusted-types`

**Boolean-only directives** (`true` / `false` only):

`block-all-mixed-content`, `upgrade-insecure-requests`

**Hybrid directives** (string / array / `true` / `false`):

`sandbox` — `true` applies all sandbox restrictions; a string/array adds
specific exceptions (e.g. `sandbox allow-scripts`).

### Example — a typical strict policy

```js
require('gina').plugins.Csp({
    directives: {
        'default-src':                 ["'self'"],
        'script-src':                  ["'self'"],
        'style-src':                   ["'self'", "'unsafe-inline'"],
        'img-src':                     ["'self'", 'data:'],
        'font-src':                    ["'self'"],
        'connect-src':                 ["'self'"],
        'frame-ancestors':             ["'none'"],
        'base-uri':                    ["'self'"],
        'form-action':                 ["'self'"],
        'object-src':                  ["'none'"],
        'upgrade-insecure-requests':   true
    }
});
```

## `reportOnly` — non-enforcing migration testing

Setting `reportOnly: true` switches the response header name from
`Content-Security-Policy` to `Content-Security-Policy-Report-Only`.
Browsers report violations (to the configured `report-to` / `report-uri`
endpoint, or to the console) but do not block any resources. Useful when
rolling out a new policy: ship it as report-only first, collect violations
from real traffic for a few days, refine the policy, then flip to
enforcing.

```js
require('gina').plugins.Csp({
    reportOnly: true,
    directives: {
        'default-src': ["'self'"],
        'script-src':  ["'self'"],
        'report-uri':  ['/csp/report']
    }
});
```

## Per-response nonce wiring — deferred

v0 ships **static directives only**. Per-response nonce wiring (e.g.
emitting `script-src 'nonce-<random>'` with a fresh nonce per render that
the template engine then writes onto inline `<script>` tags) requires
template-render integration and defers to a separate CSP-aware view-layer
plugin that can co-operate with swig / nunjucks template rendering.

For now, inline scripts and styles must use `'unsafe-inline'` (loosens
the policy — only acceptable when the rest of the policy is strict
enough to make XSS injection of inline content hard) or be moved to
external files served from a script-src-allowed origin.

## Spec note — strict whitelist tradeoff

The plugin's whitelist tracks the W3C CSP Level 3 spec
(https://www.w3.org/TR/CSP3/#csp-directives). Experimental / future
directives (`webrtc`, `fenced-frame-src`, etc.) are not yet supported —
users wanting them get a clear "unknown directive" error and can open an
issue to request inclusion in a future release.

This is a stricter posture than helmet's CSP middleware, which is more
permissive on directive names. The tradeoff: gina catches typos at
factory call time; helmet catches them only via reports / browser
console at runtime. Gina favours fail-fast.

## Failure modes

| Condition                                                | Outcome                                              |
|----------------------------------------------------------|------------------------------------------------------|
| `directives` omitted / null / non-object                 | Factory throws at call time                          |
| `directives` is an empty object                          | Factory throws with directives-list pointer          |
| `directives` contains an unknown directive name          | Factory throws with full whitelist in message        |
| Boolean-only directive given a non-boolean value         | Factory throws with directive name in message        |
| Source-list directive given `true` (and not `sandbox`)   | Factory throws with directive-category explanation   |
| Source-list directive array contains a non-string entry  | Factory throws with index in message                 |
| All directives resolve to `false` (omitted)              | Factory throws — empty CSP is invalid                |
| `reportOnly` is non-boolean                              | Factory throws                                       |
| Plugin not registered                                    | Header not emitted; browser applies no CSP           |
| Header already set by an earlier middleware              | Existing value preserved (idempotent)                |
| Response already sent (`res.headersSent === true`)       | Node's `setHeader` no-ops; request resumes           |

The idempotent behaviour makes the plugin safe to register more than once
or alongside another middleware that emits the same header — the first
writer wins.
