/**
 * #B305 — `gina.setOptions()` must write the EXPOSED config (the object every
 * plugin and library reads as `gina.config.<key>`).
 *
 * Before the fix, `setOptions` merged its options into an orphan object nothing
 * ever read, so every documented key — `loadingAttribute` above all — was
 * silently ignored while the call reported nothing.
 *
 * Strategy (per the project's test conventions):
 *  - extract-and-execute: run the SHIPPED `setOptions` bytes (terminator-anchored
 *    slice + `new Function`) against the real `lib/merge` — no replica to drift;
 *  - source pins: structural locks on the new body, red-first validated against
 *    the pre-fix bytes;
 *  - premise pins: the two framework boot call sites pass the exposed config
 *    object itself (`options` IS `gina.config` at call time), which is what makes
 *    the identity guard a boot no-op by construction;
 *  - dist pins: the module is browser-bundled, so the built artifacts must carry
 *    the fixed shape (needles derived from the emitted bytes, not guessed).
 *
 * Usage: node --test test/core/gina-set-options.test.js
 */

'use strict';

var assert = require('node:assert');
var { describe, it } = require('node:test');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..', '..');
var pkg = require(path.join(ROOT, 'package.json'));
var FW = path.join(ROOT, 'framework', 'v' + pkg.version);

var MAIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'src', 'vendor', 'gina', 'main.js');
var CORE_PATH = path.join(FW, 'core', 'asset', 'plugin', 'src', 'vendor', 'gina', 'core.js');
var LOADER_PATH = path.join(FW, 'core', 'asset', 'plugin', 'src', 'vendor', 'gina', 'utils', 'loader.js');
var DIST_JS_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.js');
var DIST_MIN_PATH = path.join(FW, 'core', 'asset', 'plugin', 'dist', 'vendor', 'gina', 'js', 'gina.min.js');

var SRC = fs.readFileSync(MAIN_PATH, 'utf8');
var CORE_SRC = fs.readFileSync(CORE_PATH, 'utf8');
var LOADER_SRC = fs.readFileSync(LOADER_PATH, 'utf8');

var merge = require(path.join(FW, 'lib', 'merge'));

// ---------------------------------------------------------------------------
// Extraction — terminator-anchored slice (the body carries comments, so a bare
// brace count is not used; both anchors are uniqueness-guarded below).
// ---------------------------------------------------------------------------

var DECL = 'var setOptions = function(options) {';
var TERM = '// instance proto';

function extractSetOptions(src) {
    var declIdx = src.indexOf(DECL);
    var termIdx = src.indexOf(TERM);
    var slice = src.substring(declIdx, termIdx);
    // strip the `var setOptions = ` prefix and trailing whitespace so the
    // remainder is a bare function expression ending at its closing brace
    var fnSrc = slice.replace(/^var setOptions = /, '').replace(/\s+$/, '');
    return fnSrc;
}

/**
 * Builds a callable `setOptions` from the shipped bytes, closed over a fresh
 * `$instance` and the real `lib/merge`.
 */
function buildSetOptions($instance) {
    var fnSrc = extractSetOptions(SRC);
    return new Function('$instance', 'merge', 'return (' + fnSrc + ');')($instance, merge);
}

describe('#B305 extraction controls (an extraction that cannot fail is not a control)', function () {

    it('01 — the declaration anchor appears exactly once', function () {
        var first = SRC.indexOf(DECL);
        assert.ok(first > -1, 'setOptions declaration not found');
        assert.equal(SRC.indexOf(DECL, first + 1), -1, 'declaration anchor is not unique');
    });

    it('02 — the terminator anchor appears exactly once, after the declaration', function () {
        var declIdx = SRC.indexOf(DECL);
        var termIdx = SRC.indexOf(TERM);
        assert.ok(termIdx > declIdx, 'terminator must follow the declaration');
        assert.equal(SRC.indexOf(TERM, termIdx + 1), -1, 'terminator anchor is not unique');
    });

    it('03 — the slice is a complete function expression (ends at its closing brace)', function () {
        var fnSrc = extractSetOptions(SRC);
        assert.match(fnSrc, /^function\(options\) \{/);
        assert.match(fnSrc, /\}$/);
        // balanced braces — the body has no braces inside strings or comments
        var opens = fnSrc.split('{').length - 1;
        var closes = fnSrc.split('}').length - 1;
        assert.equal(opens, closes, 'unbalanced braces in the extracted slice');
    });
});

describe('#B305 behaviour — the shipped bytes against the real lib/merge', function () {

    it('04 — the headline: a documented key lands on the exposed config', function () {
        var $instance = { config: {} };
        var setOptions = buildSetOptions($instance);
        setOptions({ loadingAttribute: 'data-loading' });
        assert.equal($instance.config.loadingAttribute, 'data-loading');
    });

    it('05 — every key, not just loadingAttribute (the reporter\'s culture control, inverted)', function () {
        var $instance = { config: { culture: 'fr_FR' } };
        var setOptions = buildSetOptions($instance);
        setOptions({ culture: 'zz-ZZ-control' });
        assert.equal($instance.config.culture, 'zz-ZZ-control');
    });

    it('06 — the merge is applied in place: object identity is preserved for lazy readers', function () {
        var $instance = { config: { webroot: '/' } };
        var ref = $instance.config;
        var setOptions = buildSetOptions($instance);
        setOptions({ loadingAttribute: 'data-loading' });
        assert.equal($instance.config, ref, 'the exposed config object was replaced, not merged in place');
        assert.equal(ref.loadingAttribute, 'data-loading');
        assert.equal(ref.webroot, '/');
    });

    it('07 — the identity guard: passing the exposed config itself is a no-op (the boot shape)', function () {
        var $instance = { config: { webroot: '/', envIsDev: true, routing: { 'home@demo': { url: '/' } } } };
        var snapshot = JSON.stringify($instance.config);
        var ref = $instance.config;
        var setOptions = buildSetOptions($instance);
        setOptions($instance.config);
        assert.equal($instance.config, ref);
        assert.equal(JSON.stringify($instance.config), snapshot, 'the boot self-pass mutated the config');
    });

    it('08 — null, undefined and non-object inputs are no-ops and never throw', function () {
        var $instance = { config: { keep: 'me' } };
        var snapshot = JSON.stringify($instance.config);
        var setOptions = buildSetOptions($instance);
        setOptions(null);
        setOptions(undefined);
        setOptions('junk');
        setOptions(42);
        assert.equal(JSON.stringify($instance.config), snapshot);
    });

    it('09 — a top-level object merges one level deep instead of replacing', function () {
        var $instance = { config: { a11y: { waiting: 'y' } } };
        var setOptions = buildSetOptions($instance);
        setOptions({ a11y: { submitting: 'x' } });
        assert.equal($instance.config.a11y.submitting, 'x');
        assert.equal($instance.config.a11y.waiting, 'y', 'the existing sub-key was dropped — merge must not replace the object');
    });

    it('10 — keys absent from options are never removed', function () {
        var $instance = { config: { keep: 'me', routing: { 'a@b': { url: '/x' } } } };
        var setOptions = buildSetOptions($instance);
        setOptions({ other: 1 });
        assert.equal($instance.config.keep, 'me');
        assert.ok($instance.config.routing['a@b']);
        assert.equal($instance.config.other, 1);
    });

    it('11 — the boot sequence replica: pre-copy, wholesale replace, then the self-pass — byte-identical', function () {
        // replicates core.js / utils/loader.js: options is built, any existing
        // config is pre-copied into it, `gina.config = options`, then
        // `gina.setOptions(options)` — the identity guard makes the last call
        // a no-op, so boot behaviour is unchanged by construction.
        var $instance = { config: { routing: { 'home@demo': { url: '/' } } } };
        var setOptions = buildSetOptions($instance);
        var options = { env: 'dev', envIsDev: true, webroot: '/' };
        for (var prop in $instance.config) {
            options[prop] = $instance.config[prop];
        }
        $instance.config = options;
        var snapshot = JSON.stringify($instance.config);
        setOptions(options);
        assert.equal($instance.config, options, 'boot must keep the wholesale-assigned object');
        assert.equal(JSON.stringify($instance.config), snapshot, 'the boot self-pass must not alter the config');
    });

    it('12 — an early caller write survives the boot pre-copy + replacement', function () {
        // an external setOptions call landing BEFORE the loader replaces the
        // config survives, because both boot sites pre-copy existing config
        // props into the replacement object first.
        var $instance = { config: {} };
        var setOptions = buildSetOptions($instance);
        setOptions({ loadingAttribute: 'data-loading' });        // early call
        var options = { env: 'dev' };
        for (var prop in $instance.config) {                     // boot pre-copy
            options[prop] = $instance.config[prop];
        }
        $instance.config = options;                              // wholesale replace
        setOptions(options);                                     // boot self-pass
        assert.equal($instance.config.loadingAttribute, 'data-loading');
    });
});

describe('#B305 source pins — changed bucket (each validated red against the pre-fix bytes)', function () {

    it('13 — the identity guard exists and gates before the merge write', function () {
        var guardIdx = SRC.indexOf('options === $instance.config');
        var writeIdx = SRC.indexOf('$instance.config = merge($instance.config, options, true)');
        assert.ok(guardIdx > -1, 'identity guard not found');
        assert.ok(writeIdx > -1, 'exposed-config merge write not found');
        assert.ok(guardIdx < writeIdx, 'the guard must precede the merge write');
    });

    it('14 — the merge targets the exposed config with override semantics', function () {
        assert.match(SRC, /\$instance\.config = merge\(\$instance\.config, options, true\)/);
    });

    it('15 — the orphan target is globally gone (code AND comments)', function () {
        // whole-source negative, window-independent: the retired target must
        // appear ZERO times file-wide, prose included, so a reintroduction —
        // or a comment quoting it — fails here.
        assert.equal(SRC.indexOf("proto.config"), -1);
        assert.equal(SRC.indexOf("proto['config']"), -1);
    });
});

describe('#B305 premise pins — unchanged bucket (green before AND after the fix)', function () {

    it('16 — setOptions is published on the exposed instance', function () {
        assert.match(SRC, /'setOptions'\s*:\s*setOptions/);
    });

    it('17 — the exposed instance declares its own config slot', function () {
        assert.match(SRC, /'config'\s*:\s*\{\}/);
    });

    it('18 — core.js boot: the exposed config IS the options object when setOptions runs', function () {
        var assignIdx = CORE_SRC.indexOf("gina['config'] = options;");
        var callIdx = CORE_SRC.indexOf('gina["setOptions"](options);');
        assert.ok(assignIdx > -1, 'core.js wholesale config assignment not found');
        assert.ok(callIdx > -1, 'core.js boot setOptions call not found');
        assert.ok(assignIdx < callIdx, 'the assignment must precede the boot call');
    });

    it('19 — utils/loader.js boot: the exposed config IS the options object when setOptions runs', function () {
        var assignIdx = LOADER_SRC.indexOf("gina['config'] = options;");
        var callIdx = LOADER_SRC.indexOf('gina["setOptions"](options);');
        assert.ok(assignIdx > -1, 'loader.js wholesale config assignment not found');
        assert.ok(callIdx > -1, 'loader.js boot setOptions call not found');
        assert.ok(assignIdx < callIdx, 'the assignment must precede the boot call');
    });

    it('20 — both boot files pre-copy any existing config into options before replacing', function () {
        // the pre-copy loop is what lets an early external setOptions write
        // survive the wholesale replacement (behaviour test 12).
        assert.match(CORE_SRC, /options\[prop\] = gina\['config'\]\[prop\];/);
        assert.match(LOADER_SRC, /options\[prop\] = gina\['config'\]\[prop\];/);
    });
});

describe('#B305 dist pins — the browser bundle carries the fix', function () {

    it('21 — the unminified bundle carries the guarded shape (comments intact)', function () {
        var distJs = fs.readFileSync(DIST_JS_PATH, 'utf8');
        assert.ok(distJs.indexOf('options === $instance.config') > -1,
            'dist gina.js does not carry the identity guard — stale dist, rebuild required');
        assert.ok(distJs.indexOf('$instance.config = merge($instance.config, options, true)') > -1,
            'dist gina.js does not carry the exposed-config merge — stale dist, rebuild required');
    });

    it('22 — the minified bundle carries the fixed shape (needle derived from the emitted bytes)', function () {
        var distMin = fs.readFileSync(DIST_MIN_PATH, 'utf8');
        // identifier-agnostic, wrap-agnostic; backreferences require the SAME
        // renamed locals on both sides of the guard and the write:
        //   setOptions:function(P){ P && typeof P == "object" && P !== I.config && (I.config = M(I.config, P, !0)) }
        // (shape measured on the emitted artifact after the rebuild)
        var m = distMin.match(/setOptions:\s*function\((\w+)\)\s*\{\s*\1\s*&&\s*typeof\s+\1\s*==\s*=?\s*['"]object['"]\s*&&\s*\1\s*!==\s*(\w+)\.config\s*&&\s*\(\s*\2\.config\s*=\s*(\w+)\(\2\.config\s*,\s*\1\s*,\s*!0\)\s*\)/);
        assert.ok(m, 'gina.min.js does not carry the fixed setOptions shape — stale dist, rebuild required');
    });
});
