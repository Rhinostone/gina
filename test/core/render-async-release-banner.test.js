'use strict';
/**
 * #RWATCH — stale-release banner parity on the ASYNC template-loader render
 * delegates (controller.render-swig-async.js / controller.render-nunjucks-async.js).
 *
 * The sync delegates have injected the release-watch banner since 0.5.18
 * (render-swig.js ×2 sites, render-nunjucks.js ×1 — pinned in their own
 * suites: render-swig.test.js §24, render-nunjucks.test.js §09). The async
 * delegates shipped without the splice, so an async-loader bundle doing a
 * local production rehearsal with `server.releaseWatch.enabled` got the
 * `/_gina/release/*` endpoints + SSE but no injected client banner. This
 * suite pins the ported call in BOTH async delegates:
 *
 *   - the `require('./release-banner')` binding (module scope, sibling file);
 *   - exactly ONE `releaseBanner.maybeInject(html, localOptions.conf,
 *     _cspNonceAttr)` site per delegate;
 *   - placement: AFTER the gina-bootstrap whisper pass (so the banner snippet
 *     never rides through the `{{ }}` whisper regex) and BEFORE the final
 *     `sendHtmlResponse(local, html, …)` — i.e. on the finalized HTML;
 *   - the `_cspNonceAttr` derivation from the per-request `_cspNonce`
 *     (#HDR16 — the injected <script> must carry the nonce under CSP).
 *
 * Plus a compact behavioural block driving the REAL release-banner module via
 * the exact specifier the delegates use — the instrument control that the
 * sibling require path resolves and its gate behaves (full behavioural
 * coverage of release-banner.js itself lives in render-nunjucks.test.js §09 /
 * render-swig.test.js §24; not duplicated here).
 */

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs   = require('node:fs');
var path = require('node:path');

var FW = require('../fw');
var SWIG_ASYNC = path.join(FW, 'core/controller/controller.render-swig-async.js');
var NUNJ_ASYNC = path.join(FW, 'core/controller/controller.render-nunjucks-async.js');
var BANNER     = path.join(FW, 'core/controller/release-banner.js');

function srcOf(p) { return fs.readFileSync(p, 'utf8'); }

var DELEGATES = [
    { name: 'render-swig-async',     file: SWIG_ASYNC },
    { name: 'render-nunjucks-async', file: NUNJ_ASYNC }
];

// ─── 01 — source pins: both async delegates carry the ported call ───────────
describe('01 - #RWATCH banner call is ported to both async delegates', function() {

    DELEGATES.forEach(function(d) {

        it(d.name + ' requires the release-banner injector at module scope', function() {
            assert.match(srcOf(d.file),
                /const\s+releaseBanner\s*=\s*require\('\.\/release-banner'\)/,
                "expected `const releaseBanner = require('./release-banner')` in " + d.name);
        });

        it(d.name + ' calls maybeInject exactly once, with (html, localOptions.conf, _cspNonceAttr)', function() {
            var s = srcOf(d.file);
            var calls = s.match(/releaseBanner\.maybeInject\(\s*html\s*,\s*localOptions\.conf\s*,\s*_cspNonceAttr\s*\)/g);
            assert.ok(calls && calls.length === 1,
                'expected exactly 1 releaseBanner.maybeInject(html, localOptions.conf, _cspNonceAttr) site in ' + d.name
                + ' (found ' + (calls ? calls.length : 0) + ')');
        });

        it(d.name + ' derives _cspNonceAttr from the per-request _cspNonce (#HDR16)', function() {
            assert.match(srcOf(d.file),
                /var\s+_cspNonceAttr\s*=\s*_cspNonce\s*\?\s*\(' nonce="' \+ _cspNonce \+ '"'\)\s*:\s*''/,
                'expected the nonce-attr derivation (same expression as the sync delegates) in ' + d.name);
        });

        it(d.name + ' splices AFTER the whisper pass and BEFORE sendHtmlResponse(local, html, …)', function() {
            var s = srcOf(d.file);
            var whisperIdx = s.indexOf('whisper(ginaLoaderDic, html');
            var injectIdx  = s.indexOf('releaseBanner.maybeInject(');
            // lastIndexOf — the bare needle also matches the sendHtmlResponse
            // DEFINITION (`function sendHtmlResponse(local, html, req, res)`),
            // which sits far above the call; the final-send CALL is the last
            // occurrence in both delegates.
            var sendIdx    = s.lastIndexOf('sendHtmlResponse(local, html');
            assert.ok(whisperIdx > -1, 'whisper anchor not found in ' + d.name);
            assert.ok(injectIdx  > -1, 'maybeInject call not found in ' + d.name);
            assert.ok(sendIdx    > -1, 'final sendHtmlResponse(local, html, …) not found in ' + d.name);
            assert.ok(whisperIdx < injectIdx,
                'the banner splice must come AFTER the gina-bootstrap whisper pass '
                + '(the snippet must never ride through the {{ }} whisper regex)');
            assert.ok(injectIdx < sendIdx,
                'the banner splice must come BEFORE the final send — it must ride the finalized HTML');
        });

        // The early empty-body send (`sendHtmlResponse(local, '', …)`) precedes the
        // whisper pass, so with exactly one call site placed after whisper the
        // empty-body path is banner-free by construction — pinned via ordering:
        it(d.name + ': the empty-body early send stays banner-free (ordering pin)', function() {
            var s = srcOf(d.file);
            var emptySendIdx = s.indexOf("sendHtmlResponse(local, '',");
            var injectIdx    = s.indexOf('releaseBanner.maybeInject(');
            assert.ok(emptySendIdx > -1, "empty-body send anchor (sendHtmlResponse(local, '',) not found in " + d.name);
            assert.ok(emptySendIdx < injectIdx,
                'the empty-body send must precede the single maybeInject site in ' + d.name);
        });
    });
});

// ─── 02 — behavioural instrument-control against the REAL module ────────────
//
// Drives release-banner.js through the same relative specifier the delegates
// bind, proving the require path resolves and the gate behaves. (A pin-only
// suite could go green on a typo'd sibling path; this cannot.)
describe('02 - the required release-banner module behaves (instrument control)', function() {

    var releaseBanner = require(BANNER);

    function setOrDel(k, v) { if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; } }
    function withGate(scopeLocal, envDev, fn) {
        var s = process.env.NODE_SCOPE_IS_LOCAL, d = process.env.NODE_ENV_IS_DEV;
        setOrDel('NODE_SCOPE_IS_LOCAL', scopeLocal);
        setOrDel('NODE_ENV_IS_DEV', envDev);
        try { return fn(); } finally { setOrDel('NODE_SCOPE_IS_LOCAL', s); setOrDel('NODE_ENV_IS_DEV', d); }
    }
    var CONF_ON = { server: { releaseWatch: { enabled: true } } };
    var PAGE = '<!DOCTYPE html><html><head></head><body><div>PAGEBODY</div></body></html>';

    it('the delegate-relative specifier resolves to the shared injector', function() {
        // Same resolution the delegates perform: './release-banner' from core/controller/.
        var resolved = require.resolve(path.join(FW, 'core/controller', './release-banner'));
        assert.strictEqual(resolved, require.resolve(BANNER),
            'the sibling specifier must resolve to the shared release-banner module');
        assert.strictEqual(typeof require(resolved).maybeInject, 'function',
            'the resolved module must export maybeInject()');
    });

    it('gate ON (local + !dev + enabled): the banner is spliced before </body>', function() {
        var out = withGate('true', undefined, function() { return releaseBanner.maybeInject(PAGE, CONF_ON, ''); });
        assert.notStrictEqual(out, PAGE, 'the banner must be injected when the gate passes');
        assert.ok(out.indexOf(releaseBanner.MARKER) > -1, 'the MARKER token must be present');
        assert.strictEqual((out.match(/<\/body>/g) || []).length, 1, 'exactly one </body> (function replacer)');
        assert.strictEqual((out.match(/PAGEBODY/g) || []).length, 1, 'no page-body duplication ($-safe replacer)');
    });

    it('gate ON + nonce attr: the injected <script> carries the nonce (#HDR16)', function() {
        var out = withGate('true', undefined, function() {
            return releaseBanner.maybeInject(PAGE, CONF_ON, ' nonce="r4nd0m"');
        });
        assert.match(out, /<script nonce="r4nd0m">/,
            'the spliced <script> must carry the nonce attr the delegates derive from _cspNonce');
    });

    it('gate OFF (non-local scope): HTML byte-unchanged', function() {
        assert.strictEqual(
            withGate('false', undefined, function() { return releaseBanner.maybeInject(PAGE, CONF_ON, ''); }),
            PAGE);
    });

    it('double injection is a no-op (MARKER guard)', function() {
        var once  = withGate('true', undefined, function() { return releaseBanner.maybeInject(PAGE, CONF_ON, ''); });
        var twice = withGate('true', undefined, function() { return releaseBanner.maybeInject(once, CONF_ON, ''); });
        assert.strictEqual(twice, once, 'a second inject on already-bannered HTML must be a no-op');
    });
});
