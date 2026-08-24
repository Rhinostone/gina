var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');
var CORE_SRC    = path.join(FW, 'core/asset/plugin/src/vendor/gina/core.js');
var DIST_JS     = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');

var _coreSrc, _distSrc, _distMinSrc;
function getCoreSrc()    { return _coreSrc    || (_coreSrc    = fs.readFileSync(CORE_SRC, 'utf8')); }
function getDistSrc()    { return _distSrc    || (_distSrc    = fs.readFileSync(DIST_JS, 'utf8')); }
function getDistMinSrc() { return _distMinSrc || (_distMinSrc = fs.readFileSync(DIST_MIN_JS, 'utf8')); }

// ── Client validator auto-boot ────────────────────────────────────────────────
//
// The gina client bundle loads the `gina/validator` AMD module at boot but, before
// this change, never CONSTRUCTED it — so a form declaring `data-gina-form-rule` +
// a matching `gina.forms.rules` entry did NOT validate until bundle code ran
// `new (require('gina/validator'))(gina.forms.rules).on('ready', fn)`. That left the
// declarative `data-gina-form-rule` API a silent footgun, and asymmetric with the
// popin `data-gina-dialog` API (which core.js already auto-boots via bootPopinHandler).
//
// core.js now boots the validator in the SAME plugin-loading require([...]) callback:
// bootValidator() polls isFrameworkLoaded, returns early if gina.hasValidator is
// already set (idempotent — a later explicit `new gina.validator()` merges into it),
// gates on a NON-EMPTY gina.forms.rules (pages with no rules stay byte-identical), and
// constructs `new Validator(gina.forms.rules).on('ready', fn)` — the `.on('ready')`
// registration is what fires the validator `init` self-fire (events.js) that scans/binds
// the forms and publishes gina.validator. Mirrors bootPopinHandler exactly.
//
// A node:test source pin cannot drive the real boot wiring (that needs a rendered gina
// bundle in a browser — verified end-to-end via the daemonless render smoke:
// gina.hasValidator===true + $forms bound + live-check gate toggles, all with NO app JS,
// and a later explicit construction's ready handler still fires with the form still
// bound). These guard the source structure + served-bundle freshness + a pure-logic
// replica of the boot-gate decision.

describe('01 - core.js boots the validator in the require([...]) callback', function () {

    it('source: bootValidator lives in the plugin-loading require([...]) callback', function () {
        var src = getCoreSrc();
        assert.ok(/require\(\s*\[[\s\S]*?\]\s*,\s*function/.test(src),
            'expected a callback on the plugin-loading require([...])');
        assert.ok(src.indexOf('var bootValidator = function') > -1,
            'expected a bootValidator() function');
        // both the popin AND the validator boot run in the callback
        assert.ok(src.indexOf('bootPopinHandler();') > -1 && src.indexOf('bootValidator();') > -1,
            'both bootPopinHandler() and bootValidator() must be invoked at boot');
    });

    it('source: bootValidator is idempotent (returns early on gina.hasValidator)', function () {
        var src = getCoreSrc();
        var fn = src.substring(src.indexOf('var bootValidator = function'), src.indexOf('bootValidator();'));
        assert.ok(fn.length > 0, 'bootValidator function body not found');
        assert.ok(/if\s*\(\s*window\['gina'\]\['hasValidator'\]\s*\)\s*\{\s*return;/.test(fn),
            'bootValidator must return early when gina.hasValidator is already set (idempotent re-construct)');
    });

    it('source: bootValidator gates on a NON-EMPTY gina.forms.rules', function () {
        var src = getCoreSrc();
        var fn = src.substring(src.indexOf('var bootValidator = function'), src.indexOf('bootValidator();'));
        assert.ok(/window\['gina'\]\['forms'\]/.test(fn),
            'bootValidator must read gina.forms');
        assert.ok(/Object\.keys\(\s*_rules\s*\)\.length/.test(fn),
            'bootValidator must gate on a non-empty rules object (Object.keys(_rules).length)');
        // ...and skip (return) when there is nothing to bind
        assert.ok(/if\s*\(\s*!_rules\s*\|\|\s*!Object\.keys\(\s*_rules\s*\)\.length\s*\)\s*\{\s*return;/.test(fn),
            'bootValidator must return early when there are no rules (no scan, no publish)');
    });

    it('source: bootValidator constructs + fires the ready self-fire', function () {
        var src = getCoreSrc();
        var fn = src.substring(src.indexOf('var bootValidator = function'), src.indexOf('bootValidator();'));
        assert.ok(/require\(\s*'gina\/validator'\s*\)/.test(fn),
            'bootValidator must require the gina/validator module synchronously (it is a boot dependency)');
        assert.ok(/new\s+Validator\(\s*_rules\s*\)\.on\(\s*'ready'/.test(fn),
            'expected new Validator(gina.forms.rules).on("ready", …) — the .on() fires the init self-fire that binds forms');
    });

    it('source: bootValidator defers on isFrameworkLoaded AND depsSettled with a bounded poll', function () {
        var src = getCoreSrc();
        var fn = src.substring(src.indexOf('var bootValidator = function'), src.indexOf('bootValidator();'));
        assert.ok(/window\['gina'\]\['isFrameworkLoaded'\]/.test(fn),
            'bootValidator must wait for isFrameworkLoaded (gina.forms is whispered by onGinaLoaded, which sets isFrameworkLoaded first)');
        // #B414 — a form rule may name a route (the `query` rule), which
        // evaluates at bind: the gate must also wait for the routing fetch to
        // SETTLE (loaded or failed), or the instance constructs against {}.
        assert.ok(/!_ginaDepsSettled/.test(fn),
            'bootValidator must also wait for the routing dependency to settle (#B414)');
        assert.ok(/_validatorBootTries\+\+\s*<\s*100/.test(fn),
            'the poll must stay bounded (<= 100 tries), mirroring the popin boot');
    });

    it('freshness: served gina.min.js carries the boot — rebuilt from source', function () {
        // '[gina] validator boot failed' is a quoted string literal → survives Closure
        // SIMPLE minification (unlike the renamed bootValidator identifier), so it is the
        // stable marker proving the boot code shipped into the served bundle.
        assert.ok(getDistMinSrc().indexOf('validator boot failed') > -1,
            'served gina.min.js is missing the validator boot — the bundle was not rebuilt from source');
        // the un-minified gina.js retains the source identifier
        assert.ok(getDistSrc().indexOf('bootValidator') > -1,
            'gina.js must carry the bootValidator source marker');
    });

    it('logic: boot-gate decides poll / skip / construct correctly', function () {
        // Pure-logic replica of bootValidator's decision (matches the source guards).
        // #B414 added the depsSettled dimension: framework-loaded-but-deps-pending
        // POLLS (it used to construct — the race). `depsSettled: true` is the
        // default in these fixtures so the pre-#B414 cases keep their meaning.
        function decide(state) {
            var settled = ( typeof state.depsSettled == 'undefined' ) ? true : state.depsSettled;
            if ( !state.gina || !state.gina.isFrameworkLoaded || !settled ) { return 'poll'; }
            if ( state.gina.hasValidator ) { return 'skip'; }
            var forms = state.gina.forms;
            var rules = ( forms && forms.rules ) ? forms.rules : null;
            if ( !rules || !Object.keys(rules).length ) { return 'skip'; }
            return 'construct';
        }

        // framework not loaded yet → keep polling
        assert.equal(decide({ gina: null }), 'poll');
        assert.equal(decide({ gina: { isFrameworkLoaded: false } }), 'poll');
        // #B414 — framework loaded but the routing fetch not yet settled → POLL
        // (this exact state used to CONSTRUCT: the deployed-tier race window)
        assert.equal(decide({ depsSettled: false, gina: { isFrameworkLoaded: true, hasValidator: false, forms: { rules: { signup: { fieldA: {} } } } } }), 'poll');
        // …and settling (loaded OR failed both settle) releases the same state
        assert.equal(decide({ depsSettled: true,  gina: { isFrameworkLoaded: true, hasValidator: false, forms: { rules: { signup: { fieldA: {} } } } } }), 'construct');
        // already booted (idempotent) → skip
        assert.equal(decide({ gina: { isFrameworkLoaded: true, hasValidator: true, forms: { rules: { signup: {} } } } }), 'skip');
        // loaded, not booted, but NO rules → skip (byte-identical to pre-change)
        assert.equal(decide({ gina: { isFrameworkLoaded: true, hasValidator: false, forms: { rules: {} } } }), 'skip');
        assert.equal(decide({ gina: { isFrameworkLoaded: true, hasValidator: false, forms: {} } }), 'skip');
        assert.equal(decide({ gina: { isFrameworkLoaded: true, hasValidator: false } }), 'skip');
        // loaded, not booted, rules present → construct
        assert.equal(decide({ gina: { isFrameworkLoaded: true, hasValidator: false, forms: { rules: { signup: { fieldA: {} } } } } }), 'construct');

        // subtract: each guard is load-bearing — flipping any one away from the construct
        // state must NOT yield 'construct'.
        assert.notEqual(decide({ gina: { isFrameworkLoaded: false, hasValidator: false, forms: { rules: { signup: {} } } } }), 'construct');
        assert.notEqual(decide({ gina: { isFrameworkLoaded: true,  hasValidator: true,  forms: { rules: { signup: {} } } } }), 'construct');
        assert.notEqual(decide({ gina: { isFrameworkLoaded: true,  hasValidator: false, forms: { rules: {} } } }), 'construct');
    });
});
