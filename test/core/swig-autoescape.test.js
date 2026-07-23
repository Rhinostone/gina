'use strict';
/**
 * Swig auto-escape reachable flag (stage 1 — XSS defense opt-in; default UNCHANGED).
 *
 * Gina initialises swig by calling swig.setDefaults(...), which resets swig's
 * effective auto-escape to OFF unless `autoescape: true` is passed — so the
 * default engine rendered `{{ userInput }}` raw, while nunjucks defaults ON.
 * Before this change no config surface could turn swig escaping on. Stage 1
 * gives swig the exact key shape nunjucks already has:
 * `settings.swig.autoescape` (boolean). ABSENT ⇒ false (zero behaviour change
 * for every existing 0.5.x bundle); `true` ⇒ swig HTML-escapes variable
 * output. A non-boolean value refuses the boot (a security toggle must never
 * be silently mis-typed — the strictly-boolean-toggle rule). Stage 2 (a
 * separate, operator-gated 0.6.0 item) flips the default to true; these tests
 * LOCK the current default so that flip is deliberate and visible.
 *
 * Two server-side sites carry the resolution (neither builder is
 * browser-bundled — no dist pins):
 *   - server.js initSwigEngine: the boot default + the non-boolean boot-lint;
 *     `_swigSettings` is guarded to {}, then a strict `=== true` select.
 *   - controller.js per-render setDefaults: the GOVERNING site for default
 *     (no-loader) bundles — re-applied every request, so it reads the same
 *     bundle setting through the SAME `|| {}` guard + strict `=== true` select,
 *     yielding a real boolean (an `undefined` would be dropped by the
 *     JSON.clone'd copy that swig.getOptions() feeds to server.js url/assets
 *     compiles).
 *   - the async delegate inherits the boot default via the initSwigEngine stash.
 *
 * Suites:
 *   00 — the source-pin instrument (stripComments) is validated on a fixture.
 *   01 — server.js source pins: `_swigSettings.autoescape === true` resolution,
 *        the `must be a boolean` boot-lint, and the old `conf.autoescape`
 *        ternary gone from active code (comment-stripped negative).
 *   02 — controller.js source pins: the `content.settings.swig` read guarded to
 *        {}, the strict `=== true` select into `_swigAutoescape`, and the old
 *        `local.options.autoescape` ternary gone from active code.
 *   03 — behavioural through the REAL fork: constructor arms discriminate
 *        (`{autoescape:true}` escapes, `{autoescape:false}` raw); and through
 *        gina's actual API (setDefaults) — true ⇒ escaped, false/absent ⇒ raw
 *        (the raw arms LOCK the current default; absent-key raw proves the
 *        setDefaults-resets-to-off mechanism).
 *   04 — pure resolution replica: the boot gate (server.js) throws on a defined
 *        non-boolean else strict-selects; the per-request path (controller.js)
 *        strict-selects through a `|| {}` guard and never throws — both yield
 *        real booleans, absent ⇒ false.
 *   05 — schema: `settings.swig.autoescape` {boolean, default false},
 *        `settings.nunjucks.autoescape` stays {boolean, default true}
 *        (asymmetry preserved), and `settings.template.swig` (the loader
 *        namespace) never gains an autoescape key.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var SRV_SRC  = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var CTRL_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var SCHEMA   = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema/settings.json'), 'utf8'));

// the real fork (the template-loaders.test.js pattern)
var SWIG_PATH = path.join(FW, 'node_modules/@rhinostone/swig');
var swig      = require(SWIG_PATH);

// a pristine swig singleton per case — setDefaults mutates the shared module,
// so re-require fresh to observe each option shape in isolation.
function freshSwig() {
    delete require.cache[require.resolve(SWIG_PATH)];
    return require(SWIG_PATH);
}

// comment-stripped views for negative pins (the replace-code convention keeps
// the old shape as a `// was:` record; a negative pin must only see ACTIVE code)
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

// ---------------------------------------------------------------------------
// 00 - source-pin instrument validation
// ---------------------------------------------------------------------------
describe('00 - source-pin instrument (stripComments) validation', function () {
    it('removes commented lines but keeps active code', function () {
        var fixture = 'active(1);\n    // was: dead(2);\n/* block */\n * jsdoc line\nkeep(3);';
        var out = stripComments(fixture);
        assert.ok(out.indexOf('active(1)') >= 0, 'active code kept');
        assert.ok(out.indexOf('keep(3)')   >= 0, 'active code kept');
        assert.ok(out.indexOf('dead(2)')   <  0, 'line comment removed');
        assert.ok(out.indexOf('block')     <  0, 'block-comment line removed');
        assert.ok(out.indexOf('jsdoc')     <  0, 'jsdoc-star line removed');
    });
});

// ---------------------------------------------------------------------------
// 01 - server.js source pins (initSwigEngine)
// ---------------------------------------------------------------------------
describe('01 - server.js source pins (initSwigEngine)', function () {

    var SRV_ACTIVE = stripComments(SRV_SRC);

    it('resolves autoescape from settings.swig via strict `=== true`', function () {
        assert.ok(
            SRV_ACTIVE.indexOf('(_swigSettings.autoescape === true)') >= 0,
            'active swigOptions.autoescape reads _swigSettings.autoescape === true'
        );
    });

    it('refuses boot on a non-boolean settings.swig.autoescape', function () {
        assert.ok(
            SRV_ACTIVE.indexOf("typeof(_swigSettings.autoescape) != 'boolean'") >= 0,
            'non-boolean boot-lint condition present'
        );
        assert.ok(
            SRV_ACTIVE.indexOf('settings.swig.autoescape must be a boolean') >= 0,
            'boot-lint throw message present'
        );
    });

    it('the old `conf.autoescape` ternary is gone from active code (survives only as a was-record)', function () {
        // control (anti-typo / anti-stuck-false): the token IS in the file as the was-record
        assert.ok(SRV_SRC.indexOf('typeof(conf.autoescape)') >= 0, 'was-record present in raw source');
        // the pin: absent from active (comment-stripped) code
        assert.ok(SRV_ACTIVE.indexOf('typeof(conf.autoescape)') < 0, 'gone from active code');
    });
});

// ---------------------------------------------------------------------------
// 02 - controller.js source pins (per-render setDefaults)
// ---------------------------------------------------------------------------
describe('02 - controller.js source pins (per-render setDefaults)', function () {

    var CTRL_ACTIVE = stripComments(CTRL_SRC);

    it('reads the bundle swig settings via content.settings.swig, guarded to {}', function () {
        assert.ok(CTRL_ACTIVE.indexOf('.content.settings.swig') >= 0, 'reads getConfig()[...].content.settings.swig');
        // the `|| {}` guard mirrors server.js's `_swigSettings` guard and is what
        // yields a real boolean (absent ⇒ false, never undefined)
        assert.ok(CTRL_ACTIVE.indexOf('.content.settings.swig ) || {}') >= 0, 'settings.swig read is guarded to {}');
    });

    it('selects autoescape with strict `=== true` into the per-render options', function () {
        assert.ok(CTRL_ACTIVE.indexOf('_tSwig.autoescape === true') >= 0, 'strict === true select');
        assert.match(CTRL_ACTIVE, /autoescape\s+:\s+_swigAutoescape/, 'threaded into swigOptions.autoescape');
    });

    it('the old `local.options.autoescape` ternary is gone from active code (survives only as a was-record)', function () {
        assert.ok(CTRL_SRC.indexOf('typeof(local.options.autoescape)') >= 0, 'was-record present in raw source');
        assert.ok(CTRL_ACTIVE.indexOf('typeof(local.options.autoescape)') < 0, 'gone from active code');
    });
});

// ---------------------------------------------------------------------------
// 03 - behavioural through the real @rhinostone/swig fork
// ---------------------------------------------------------------------------
describe('03 - behavioural through the real @rhinostone/swig fork', function () {

    // constructor arms — the fork's own escaping discriminates
    it('constructor {autoescape:true} HTML-escapes variable output', function () {
        var out = new swig.Swig({ autoescape: true }).render('{{ x }}', { locals: { x: '<b>xss</b>' } });
        assert.equal(out, '&lt;b&gt;xss&lt;/b&gt;');
    });

    it('constructor {autoescape:false} renders variable output raw', function () {
        var out = new swig.Swig({ autoescape: false }).render('{{ x }}', { locals: { x: '<b>xss</b>' } });
        assert.equal(out, '<b>xss</b>');
    });

    // setDefaults arms — gina's ACTUAL consumption path (server.js/controller.js
    // both call swig.setDefaults(swigOptions)). Proves the resolved boolean
    // drives escaping, and that calling setDefaults resets escaping OFF unless
    // `true` is passed (why the default is off today).
    it('setDefaults {autoescape:true} ⇒ escaped', function () {
        var s = freshSwig(); s.setDefaults({ autoescape: true, cache: false });
        assert.equal(s.render('{{ x }}', { locals: { x: '<b>xss</b>' } }), '&lt;b&gt;xss&lt;/b&gt;');
    });

    it('setDefaults {autoescape:false} ⇒ raw (LOCKS the current 0.5.x default)', function () {
        var s = freshSwig(); s.setDefaults({ autoescape: false, cache: false });
        assert.equal(s.render('{{ x }}', { locals: { x: '<b>xss</b>' } }), '<b>xss</b>');
    });

    it('setDefaults with the autoescape key ABSENT ⇒ raw (setDefaults resets escaping off)', function () {
        var s = freshSwig(); s.setDefaults({ cache: false });
        assert.equal(s.render('{{ x }}', { locals: { x: '<b>xss</b>' } }), '<b>xss</b>');
    });
});

// ---------------------------------------------------------------------------
// 04 - resolution replica
// ---------------------------------------------------------------------------
describe('04 - resolution replica', function () {

    // Faithful replica of server.js initSwigEngine's BOOT resolution: `|| {}`
    // guard, a defined non-boolean refuses the boot, otherwise strict `=== true`.
    function resolveBoot(swigSettings) {
        var s = swigSettings || {};
        if (typeof s.autoescape != 'undefined' && typeof s.autoescape != 'boolean') {
            throw new Error('[ SWIG ] settings.swig.autoescape must be a boolean (got: ' + JSON.stringify(s.autoescape) + ')');
        }
        return (s.autoescape === true);
    }

    it('boot: absent ⇒ false (unchanged 0.5.x behaviour)', function () { assert.equal(resolveBoot({}), false); });
    it('boot: undefined settings ⇒ false', function () { assert.equal(resolveBoot(undefined), false); });
    it('boot: true ⇒ true',  function () { assert.equal(resolveBoot({ autoescape: true }),  true); });
    it('boot: false ⇒ false', function () { assert.equal(resolveBoot({ autoescape: false }), false); });
    it('boot: non-boolean string ⇒ throws (boot refusal)', function () {
        assert.throws(function () { resolveBoot({ autoescape: 'yes' }); }, /must be a boolean/);
    });
    it('boot: non-boolean number ⇒ throws (boot refusal)', function () {
        assert.throws(function () { resolveBoot({ autoescape: 1 }); }, /must be a boolean/);
    });

    // Faithful replica of controller.js's per-request resolution: `|| {}` guard,
    // strict `=== true`, inside a try/catch — a non-boolean can't reach here
    // (boot already gated it), and any surprise ⇒ false, never a thrown request.
    function resolvePerRequest(tSwig) {
        try { var s = tSwig || {}; return (s.autoescape === true); } catch (e) { return false; }
    }

    it('per-request: undefined settings ⇒ false', function () { assert.equal(resolvePerRequest(undefined), false); });
    it('per-request: {} ⇒ false',  function () { assert.equal(resolvePerRequest({}), false); });
    it('per-request: true ⇒ true', function () { assert.equal(resolvePerRequest({ autoescape: true }), true); });
    it('per-request: false ⇒ false', function () { assert.equal(resolvePerRequest({ autoescape: false }), false); });
    it('per-request: non-boolean ⇒ false (never throws — boot already gated it)', function () {
        assert.equal(resolvePerRequest({ autoescape: 'yes' }), false);
    });

    // both sites yield a strict boolean for the reachable inputs
    it('both replicas return a strict boolean for absent settings', function () {
        assert.equal(typeof resolveBoot({}), 'boolean');
        assert.equal(typeof resolvePerRequest(undefined), 'boolean');
    });
});

// ---------------------------------------------------------------------------
// 05 - schema/settings.json
// ---------------------------------------------------------------------------
describe('05 - schema/settings.json', function () {

    it('settings.swig.autoescape is boolean, default false', function () {
        var ae = SCHEMA.properties.swig.properties.autoescape;
        assert.ok(ae, 'settings.swig.autoescape present');
        assert.equal(ae.type, 'boolean');
        assert.equal(ae.default, false);
    });

    it('settings.nunjucks.autoescape stays boolean, default true (asymmetry preserved)', function () {
        var nae = SCHEMA.properties.nunjucks.properties.autoescape;
        assert.equal(nae.type, 'boolean');
        assert.equal(nae.default, true);
    });

    it('settings.template.swig (the async-loader namespace) never gains an autoescape key', function () {
        assert.equal(SCHEMA.properties.template.properties.swig.properties.autoescape, undefined);
    });
});
