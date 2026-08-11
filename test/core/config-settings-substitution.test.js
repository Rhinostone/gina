'use strict';
/**
 * #B257 — `getConfig().settings` must carry the SUBSTITUTED values, not the
 * pre-substitution copy.
 *
 * `core/config.js::loadBundleConfig` binds `conf[bundle][env].settings` to
 * `files['settings']` early, then later runs `files = whisper(reps, files)`
 * and binds `conf[bundle][env].content = files`. `whisper()` returns a NEW
 * object rather than mutating in place — a plain object's `constructor`
 * stringifies to '... [native code] ...', so whisper's in-place branch is
 * skipped and control falls to stringify → replace → `JSON.parse`. The early
 * binding therefore kept the ORIGINAL object and the two references diverged:
 * `.content.settings` had its tokens resolved, `.settings` did not.
 *
 * The divergence is specific to tokens that this pass is the FIRST to know —
 * `${bundlePath}`, `${libPath}`, `${publicPath}`, `${handlersPath}`,
 * `${mountPath}`, `${gina}`, `${project}`, `${root}`, `${source}`,
 * `${<name>Port}`, `${templates}`/`${html}`/`${theme}` and the scalar harvest.
 * An EARLIER pass already resolved `${homedir}` / `${scope}` / … in both
 * copies (so the widely-repeated "`.settings` is unsubstituted" rationale was
 * never accurate — see #B273), and `${secret:…}` is unaffected either way
 * because `secrets.resolve()` walks the config in place, reaching both
 * subtrees. The fix re-points `.settings` at the post-substitution object.
 *
 * §01 pins the source ordering (early bind BEFORE the whisper pass, re-bind
 * AFTER it, guard present). §02 executes the REAL extracted `whisper` bytes
 * over the same bind → whisper → re-bind sequence and asserts the resolved
 * VALUE — a source pin cannot do this, because the defect is a runtime value.
 * §03 is the subtract control: the identical harness with the re-bind removed
 * must reproduce the stale literal, proving the harness can fail. §04
 * validates the instrument itself in both directions.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var FW     = require('../fw');

var CONFIG_PATH  = path.join(FW, 'core', 'config.js');
var CONFIG_SRC   = fs.readFileSync(CONFIG_PATH, 'utf8');
var CONTEXT_PATH = path.join(FW, 'helpers', 'context.js');
var CONTEXT_SRC  = fs.readFileSync(CONTEXT_PATH, 'utf8');

var BIND      = "conf[bundle][env].settings = files['settings'];";
var WHISPER   = 'files = whisper(reps, files);';
var CONTENT   = 'conf[bundle][env].content   = files;';
var GUARD     = "if ( typeof(files['settings']) != 'undefined' ) {";

// ─── extraction: the real whisper bytes ─────────────────────────────────────

/**
 * Slice `global.whisper = function (...) {...}` out of helpers/context.js by
 * brace matching, so §02 drives the SHIPPED implementation rather than a
 * hand-written mirror of it.
 */
function extractWhisper(src) {
    var start = src.indexOf('global.whisper = function');
    assert.ok(start > -1, 'whisper anchor found in helpers/context.js');
    var depth = 0, end = -1;
    for (var p = src.indexOf('{', start); p < src.length; p++) {
        if (src[p] === '{') { depth++; }
        else if (src[p] === '}') { depth--; if (depth === 0) { end = p + 1; break; } }
    }
    assert.ok(end > start, 'whisper body braces balanced');
    return src.slice(start, end) + ';';
}

function buildWhisper(fnSrc) {
    // whisper reads getEnvVar only on its OS-environment branch, which these
    // fixtures never enter (no "$VAR" / "~/" shapes) — the stub keeps
    // compilation honest without pulling the framework bootstrap in.
    var factory = new Function('getEnvVar',
        'var global = {}; ' + fnSrc + ' return global.whisper;');
    return factory(function () { return undefined; });
}

var whisper = buildWhisper(extractWhisper(CONTEXT_SRC));

// ─── harness: config.js's bind → whisper → re-bind sequence ─────────────────

/**
 * Replays the three config.js statements §01 pins, against a settings object
 * carrying pass-2-only tokens. `applyFix=false` composes the PRE-fix shape.
 */
function runSequence(applyFix) {
    var reps  = { libPath: '/RESOLVED/lib', bundlePath: '/RESOLVED/bundle' };
    var conf  = {};   // stands in for conf[bundle][env]
    var files = {
        settings: {
            libDir    : '${libPath}/x',
            bundleDir : '${bundlePath}/y',
            plain     : 'no-token-here'
        }
    };

    conf.settings = files['settings'];      // config.js — pre-substitution bind
    files         = whisper(reps, files);   // config.js — the substitution pass
    conf.content  = files;                  // config.js — post-substitution bind

    if (applyFix && typeof(files['settings']) != 'undefined') {
        conf.settings = files['settings'];  // config.js — the #B257 re-bind
    }
    return conf;
}


describe('01 - source: the .settings alias is re-bound after the substitution pass', function () {

    it('binds .settings once before the whisper pass and once after the content bind', function () {
        var first   = CONFIG_SRC.indexOf(BIND);
        var whispAt = CONFIG_SRC.indexOf(WHISPER);
        var content = CONFIG_SRC.indexOf(CONTENT);
        var rebind  = CONFIG_SRC.lastIndexOf(BIND);

        assert.ok(first   > -1, 'the .settings binding statement is present');
        assert.ok(whispAt > -1, 'the `files = whisper(reps, files);` pass is present');
        assert.ok(content > -1, 'the `.content = files` binding is present');

        assert.notStrictEqual(first, rebind,
            'TWO distinct .settings bindings must exist — the pre-substitution one ' +
            'and the #B257 re-bind. One occurrence means the re-bind was removed.');

        assert.ok(first < whispAt,
            'the original binding stays BEFORE the whisper pass (it is what makes ' +
            '.settings available to anything reading it early)');
        assert.ok(whispAt < content,
            'the whisper pass runs BEFORE `.content` is bound');
        assert.ok(content < rebind,
            'the #B257 re-bind lands AFTER `.content = files` — binding it any ' +
            'earlier than the whisper pass is exactly the defect');
    });

    it('guards the re-bind against an undefined settings slot', function () {
        var rebind = CONFIG_SRC.lastIndexOf(BIND);
        var window = CONFIG_SRC.slice(Math.max(0, rebind - 400), rebind);
        assert.ok(window.indexOf(GUARD) > -1,
            'the re-bind is wrapped in a typeof guard — whisper returns the raw ' +
            'string when its JSON.parse throws, and overwriting a populated ' +
            '.settings with undefined would be a regression');
    });

    it('whisper still returns a new object rather than mutating in place', function () {
        // The whole defect rests on this. If whisper is ever changed to mutate
        // in place, the re-bind becomes a no-op and this test's premise dies
        // silently — so pin the branch guard that produces the new object.
        assert.ok(CONTEXT_SRC.indexOf('/\\[native code\\]/.test(replaceable.constructor)') > -1,
            'whisper still gates its in-place branch on the [native code] constructor ' +
            'test (which a plain object FAILS, sending it to the stringify branch)');
        assert.ok(CONTEXT_SRC.indexOf('return JSON.parse(processed);') > -1,
            'whisper still returns a JSON.parse product — i.e. a NEW object');
    });
});


describe('02 - runtime: .settings carries the substituted values', function () {

    it('resolves pass-2-only tokens in getConfig().settings', function () {
        var conf = runSequence(true);

        assert.strictEqual(conf.settings.libDir, '/RESOLVED/lib/x',
            '${libPath} must be resolved in .settings, not left literal');
        assert.strictEqual(conf.settings.bundleDir, '/RESOLVED/bundle/y',
            '${bundlePath} must be resolved in .settings, not left literal');
    });

    it('makes .settings and .content.settings the same resolved object', function () {
        var conf = runSequence(true);

        assert.strictEqual(conf.settings, conf.content.settings,
            'the two published references must not diverge');
        assert.deepStrictEqual(conf.settings, conf.content.settings);
    });

    it('carries token-free values through untouched', function () {
        var conf = runSequence(true);
        assert.strictEqual(conf.settings.plain, 'no-token-here');
    });
});


describe('03 - subtract control: the pre-fix sequence reproduces the defect', function () {

    it('leaves pass-2-only tokens literal in .settings without the re-bind', function () {
        var conf = runSequence(false);

        assert.strictEqual(conf.settings.libDir, '${libPath}/x',
            'PRE-FIX: .settings kept the unresolved token — if this ever reads as ' +
            'resolved, the harness is no longer able to detect the defect and §02 ' +
            'is passing vacuously');
        assert.strictEqual(conf.settings.bundleDir, '${bundlePath}/y');
    });

    it('diverges from .content.settings without the re-bind', function () {
        var conf = runSequence(false);

        assert.notStrictEqual(conf.settings, conf.content.settings,
            'PRE-FIX: the two references were distinct objects');
        assert.strictEqual(conf.content.settings.libDir, '/RESOLVED/lib/x',
            'PRE-FIX: .content.settings was already correct — only the alias was stale');
    });
});


describe('04 - instrument validation', function () {

    it('positive control: the extracted whisper actually substitutes', function () {
        var out = whisper({ libPath: '/P' }, { a: '${libPath}/q' });
        assert.strictEqual(out.a, '/P/q',
            'if this fails, every "resolved" assertion above proves nothing');
    });

    it('negative control: an unknown token survives verbatim', function () {
        var out = whisper({ libPath: '/P' }, { a: '${notInDictionary}/q' });
        assert.strictEqual(out.a, '${notInDictionary}/q',
            'whisper must not blanket-rewrite — a stuck-TRUE substituter would make ' +
            'the §02 assertions unfalsifiable');
    });

    it('the extraction produced a real function, not an empty stub', function () {
        assert.strictEqual(typeof whisper, 'function');
        assert.ok(extractWhisper(CONTEXT_SRC).length > 500,
            'extracted whisper body is substantial — a truncated slice that still ' +
            'compiled would silently weaken every arm above');
    });
});
