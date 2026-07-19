/**
 * validator-is-alias — numbered `is` aliases (`is0`, `is1`, …) install + apply (#B127).
 *
 * `checkFieldAgainstRules`'s per-rule loop guarded `typeof(d[field][rule]) != 'function'
 * -> continue` BEFORE the lazy alias installer, whose own gate requires
 * `typeof(d[field][rule]) == 'undefined'` — a logical contradiction: the loop skipped
 * exactly the state the installer needed, so the installer was unreachable and any
 * `is<N>` rule key was silently dropped (no warn) on BOTH the client and the server
 * auto path. The engine's fixed per-field set has no numbered names, so the aliases
 * exist ONLY via that installer.
 *
 * Fix, two coordinated parts:
 *  1. main.js — the installer is hoisted ABOVE the function typecheck, and its regex
 *     is anchored (`/^is\d+$/`): the old alternative was unanchored, so a name like
 *     `is0abc` would have matched and inherited from a nonexistent base rule.
 *  2. form-validator.js — `is()`'s alias read resolves its root window-first with a
 *     Node `global` fallback (`_aliasRoot`), so numbered aliases keep DISTINCT error
 *     keys on both sides. Server-side the old window-only read collapsed every alias
 *     to the shared key `is`, which made multi-`is<N>` lossy: a later PASSING alias
 *     deleted an earlier FAILING alias's error (the is() tail delete-on-pass) and the
 *     field validated clean.
 *  3. main.js (enabling guard) — validate()'s single-element live-check derivation
 *     called `$fields.count()` unguarded whenever the rules carried a `$` cross-field
 *     reference; the server auto path passes `$fields = null`, so ANY `$`-bearing rule
 *     set (plain `is` included — the alias family's whole point) crashed the server
 *     pass with `Cannot read properties of null (reading 'count')` before the rules
 *     ever ran. Guarded `$fields &&` first (the #B85 idiom); a server pass is a
 *     full-form pass by definition, never a single-element live-check.
 *
 * Shape: (a) source pins — install-before-typecheck ordering via structural slice
 * anchors, the anchored regex literal, whole-source negatives on both pre-fix shapes
 * (comment-stripped, so the `// was:` replace-code remnants can't trip them);
 * (b) behavioural runs of the REAL plugin over the server auto path (#B85 idiom) —
 * enforce / pass / two-alias matrix / the erase-loss arm / plain-`is` back-compat;
 * (c) a windowed-context arm proving the browser-shape handshake keys the numbered
 * alias; (d) pure-logic replicas with subtracts: the pre-fix loop-head order proves
 * the installer unreachable, and the collapsed-key is()-tail replica proves the
 * erase-loss the _aliasRoot fix removes.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, '../../utils/prototypes')); // Object.prototype.count() — backendInit needs it
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }
setContext('bundle', 'isaliasbundle');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var FV_PATH   = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var MAIN_SRC  = fs.readFileSync(MAIN_PATH, 'utf8');
var FV_SRC    = fs.readFileSync(FV_PATH, 'utf8');

// Comment-stripped (ACTIVE) forms — the replace-code convention keeps the pre-fix
// lines as `// was:` comments, which would otherwise trip the negative pins.
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}
var MAIN_ACTIVE = stripComments(MAIN_SRC);
var FV_ACTIVE   = stripComments(FV_SRC);

var Validator = require(MAIN_PATH); // ValidatorPlugin (the public gina.plugins.Validator)

describe('validator-is-alias §01 — source pins: installer placement + anchored regex (main.js)', function () {

    // Structural slice of the per-rule loop head: from the (unique) loop line to the
    // (unique) next-step comment — no byte windows.
    var loopStart = MAIN_SRC.indexOf('for (var rule in rules[field])');
    var loopEnd   = MAIN_SRC.indexOf('// check for rule params');

    it('01.1 - slice anchors resolve (control: the extraction can fail)', function () {
        assert.ok(loopStart > -1, 'loop-head anchor `for (var rule in rules[field])` not found');
        assert.ok(loopEnd > loopStart, 'end anchor `// check for rule params` not found after the loop head');
    });

    it('01.2 - the installer sits ABOVE the function typecheck (ordering, not a byte window)', function () {
        var block = stripComments(MAIN_SRC.substring(loopStart, loopEnd));
        var installIdx   = block.indexOf("/^is\\d+$/.test(rule)");
        var typecheckIdx = block.indexOf("typeof(d[field][rule]) != 'function'");
        assert.ok(installIdx > -1, 'anchored installer gate not found in the loop head');
        assert.ok(typecheckIdx > -1, 'function typecheck not found in the loop head');
        assert.ok(installIdx < typecheckIdx,
            'the alias installer must run BEFORE the typecheck `continue` (was unreachable below it)');
    });

    it('01.3 - the installer regex is the ANCHORED /^is\\d+$/ form', function () {
        assert.ok(
            MAIN_ACTIVE.indexOf("/^is\\d+$/.test(rule) && typeof(d[field][rule]) == 'undefined'") > -1,
            'expected the anchored installer gate'
        );
    });

    it('01.4 - the old unanchored contradiction shape is gone (whole-source negative, comment-stripped)', function () {
        assert.ok(
            MAIN_ACTIVE.indexOf('/^((is)\\d+|is$)/') < 0,
            'the pre-fix unanchored alias regex must not reappear in active code'
        );
    });

    it('01.5 - the alias still inherits from its digit-stripped base rule', function () {
        var block = MAIN_SRC.substring(loopStart, loopEnd);
        assert.ok(
            block.indexOf("inherits(d[field][rule], d[field][ rule.replace(/\\d+/, '') ])") > -1,
            'alias base derivation (is0 -> is) must be preserved'
        );
    });

    it('01.6 - the single-element live-check derivation is $fields-guarded (server passes null)', function () {
        assert.match(
            MAIN_ACTIVE,
            /isLiveCheckingOnASingleElement = \(\s*\$fields\s*&&/,
            'validate() must null-guard $fields before deriving single-element mode ($-bearing rules crashed the server pass)'
        );
    });
});

describe('validator-is-alias §02 — source pins: dual-env alias root (form-validator.js)', function () {

    it('02.1 - is() resolves the alias from _aliasRoot (window-first, Node global fallback)', function () {
        assert.ok(
            FV_ACTIVE.indexOf("var _aliasRoot") > -1
            && FV_ACTIVE.indexOf("typeof(_aliasRoot._currentValidatorAlias) != 'undefined'") > -1,
            'expected the _aliasRoot read'
        );
        assert.match(
            FV_ACTIVE,
            /_aliasRoot\s*=\s*\(\s*typeof\(window\) != 'undefined'\s*\)\s*\?\s*window\s*:\s*\(\s*\(\s*typeof\(global\) != 'undefined'\s*\)\s*\?\s*global\s*:\s*null\s*\)/,
            'alias root must prefer window and fall back to the Node global'
        );
    });

    it('02.2 - the delete fires through the same root (no window-gated stray global)', function () {
        assert.ok(
            FV_ACTIVE.indexOf('delete _aliasRoot._currentValidatorAlias') > -1,
            'the read-then-delete must go through _aliasRoot'
        );
    });

    it('02.3 - the old window-only read is gone (comment-stripped negative)', function () {
        assert.ok(
            FV_ACTIVE.indexOf('window._currentValidatorAlias ) ? window._currentValidatorAlias') < 0,
            'the pre-fix window-only alias read must not reappear in active code'
        );
        assert.ok(
            FV_ACTIVE.indexOf('delete window._currentValidatorAlias') < 0,
            'the pre-fix window-gated delete must not reappear in active code'
        );
    });
});

describe('validator-is-alias §03 — behavioural: server auto path enforces is<N> (REAL plugin)', function () {

    // Fresh rules per call — parseRules mutates its input. `isNumber` on every numeric
    // field makes getDynamisedRules splice RAW numeric operands into the condition
    // (without a casting rule the values are string-quoted and compare lexicographically).
    function singleAlias() {
        return {
            amount : { isNumber: true, is0: ['$amount <= $cap', 'too high'] },
            cap    : { isNumber: true }
        };
    }
    function twoAliases() {
        return {
            amount : {
                isNumber : true,
                is0      : ['$amount <= $cap',   'too high'],
                is1      : ['$amount >= $floor', 'too low']
            },
            cap    : { isNumber: true },
            floor  : { isNumber: true }
        };
    }

    it('03.1 - an over-cap value is REJECTED, error keyed by the numbered alias', function () {
        var res = Validator(singleAlias(), { amount: '150', cap: '100' }, 'is-alias-form');
        assert.equal(res.isValid(), false, 'over-cap must not validate (the pre-fix shape silently skipped the rule)');
        assert.ok(res.error && res.error.amount, 'errors keyed by field');
        assert.equal(res.error.amount.is0, 'too high', 'error keyed by the numbered alias, not the collapsed `is`');
    });

    it('03.2 - an in-range value validates clean', function () {
        var res = Validator(singleAlias(), { amount: '50', cap: '100' }, 'is-alias-form');
        assert.equal(res.isValid(), true);
        assert.deepEqual(res.error, {});
    });

    it('03.3 - two aliases on one field: the second enforces independently', function () {
        var res = Validator(twoAliases(), { amount: '5', cap: '100', floor: '10' }, 'is-alias-form');
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is1, 'too low');
        assert.equal(typeof res.error.amount.is0, 'undefined', 'the passing alias must not error');
    });

    it('03.4 - erase-loss arm: a later PASSING alias must NOT erase an earlier FAILING one', function () {
        // is0 fails (150 > 100), is1 passes (150 >= 10). With the collapsed server key
        // (pre-fix window-only alias read) is1's pass deleted errors['is'] and the field
        // validated clean — a silent bypass. Distinct keys keep the failure.
        var res = Validator(twoAliases(), { amount: '150', cap: '100', floor: '10' }, 'is-alias-form');
        assert.equal(res.isValid(), false, 'the failing is0 must survive the passing is1');
        assert.equal(res.error.amount.is0, 'too high');
        assert.equal(typeof res.error.amount.is1, 'undefined');
    });

    it('03.5 - both aliases failing -> both distinct error keys present', function () {
        var res = Validator(twoAliases(), { amount: '5', cap: '3', floor: '10' }, 'is-alias-form');
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is0, 'too high');
        assert.equal(res.error.amount.is1, 'too low');
    });

    it('03.6 - plain `is` back-compat: unchanged, error keyed `is` (also regression-proves the $fields guard)', function () {
        // Pre-fix, this arm crashed at validate()'s unguarded `$fields.count()` —
        // the server auto path could not run ANY `$`-bearing rule at all.
        var res = Validator({ amount: { isNumber: true, is: ['$amount <= $cap', 'too high'] },
            cap: { isNumber: true } },
            { amount: '150', cap: '100' }, 'is-alias-form');
        assert.equal(res.isValid(), false);
        assert.equal(res.error.amount.is, 'too high');
        assert.equal(typeof res.error.amount.is0, 'undefined');
    });
});

describe('validator-is-alias §04 — behavioural: windowed (browser-shape) alias handshake', function () {

    it('04.1 - with window planted (window === globalThis), the error keys the numbered alias', function () {
        // In a browser, window IS the global the installer IIFE writes to (sloppy-mode
        // `this`). Planting window = globalThis reproduces that shape so the
        // window-preferred branch of _aliasRoot is the one under test.
        global.window = globalThis;
        try {
            var res = Validator({ amount: { isNumber: true, is0: ['$amount <= $cap', 'too high'] },
                cap: { isNumber: true } },
                { amount: '150', cap: '100' }, 'is-alias-client-form');
            assert.equal(res.isValid(), false);
            assert.equal(res.error.amount.is0, 'too high');
        } finally {
            delete global.window;
            delete global._currentValidatorAlias;
        }
    });
});

describe('validator-is-alias §05 — replicas + subtracts (pre-fix shapes fail)', function () {

    // Loop-head replicas — mirror the shipped vs pre-fix control flow.
    function preFixLoopHead(d, field, rule) {
        // pre-fix order: typecheck first, installer below (the shipped bug)
        if ( typeof(d[field][rule]) != 'function' ) {
            return 'skipped';
        }
        if ( /^((is)\d+|is$)/.test(rule) && typeof(d[field][rule]) == 'undefined' ) {
            return 'installed';
        }
        return 'applied';
    }
    function fixedLoopHead(d, field, rule) {
        if ( /^is\d+$/.test(rule) && typeof(d[field][rule]) == 'undefined' ) {
            d[field][rule] = function () {};
        }
        if ( typeof(d[field][rule]) != 'function' ) {
            return 'skipped';
        }
        return 'applied';
    }

    it('05.1 - SUBTRACT: the pre-fix order silently skips is<N> (installer unreachable)', function () {
        var d = { amount: { is: function () {} } };
        assert.equal(preFixLoopHead(d, 'amount', 'is0'), 'skipped',
            'pre-fix: the typecheck continues on exactly the state the installer needs');
        assert.equal(typeof d.amount.is0, 'undefined', 'nothing was installed');
    });

    it('05.2 - fixed order installs then applies', function () {
        var d = { amount: { is: function () {} } };
        assert.equal(fixedLoopHead(d, 'amount', 'is0'), 'applied');
        assert.equal(typeof d.amount.is0, 'function', 'the alias was installed');
    });

    it('05.3 - anchored regex: `is0abc` no longer matches (would inherit a nonexistent base)', function () {
        var d = { amount: { is: function () {} } };
        assert.equal(fixedLoopHead(d, 'amount', 'is0abc'), 'skipped', 'non-alias names stay skipped');
        assert.equal(typeof d.amount.is0abc, 'undefined');
        // control: the OLD regex DID match it — the tighten is load-bearing
        assert.ok(/^((is)\d+|is$)/.test('is0abc'), 'control: the unanchored pre-fix regex matched is0abc');
    });

    it('05.4 - plain `is` takes neither install nor skip — applied directly', function () {
        var d = { amount: { is: function () {} } };
        assert.equal(fixedLoopHead(d, 'amount', 'is'), 'applied');
    });

    // is()-tail replica — the delete-on-pass interaction that made collapsed server
    // keys lossy (byte-faithful to the shipped tail's error bookkeeping).
    function isTailReplica(errors, alias, isValid, msg) {
        if (!isValid) {
            errors[alias] = msg;
        } else if ( isValid && typeof(errors[alias]) != 'undefined' ) {
            delete errors[alias];
        }
        return errors;
    }

    it('05.5 - SUBTRACT: collapsed alias key -> a later passing alias erases the earlier failure', function () {
        var errors = {};
        isTailReplica(errors, 'is', false, 'too high'); // is0 fails (server pre-fix key: `is`)
        isTailReplica(errors, 'is', true);              // is1 passes (same collapsed key)
        assert.equal(errors.count(), 0,
            'control: with the collapsed key the field ends clean despite a genuine failure');
    });

    it('05.6 - distinct alias keys survive the same pass/fail sequence', function () {
        var errors = {};
        isTailReplica(errors, 'is0', false, 'too high');
        isTailReplica(errors, 'is1', true);
        assert.equal(errors.count(), 1);
        assert.equal(errors.is0, 'too high');
    });
});

describe('validator-is-alias §06 — dist fidelity (minify-surviving tokens only)', function () {

    // Both validator sources are browser-bundled; a source-only fix that skips the
    // prod rebuild ships a stale client. Discriminators validated BOTH directions
    // against the pre-fix artifact (positive: 0 -> 1; negative: 1 -> 0). Local var
    // names (_aliasRoot) are Closure-renamed and deliberately NOT pinned.
    var DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');
    var DIST_SRC = fs.readFileSync(DIST, 'utf8');

    it('06.1 - the anchored installer regex reached the bundle', function () {
        assert.ok(DIST_SRC.indexOf('/^is\\d+$/') > -1, 'anchored /^is\\d+$/ must be in gina.min.js');
    });

    it('06.2 - the old unanchored alias regex is gone from the bundle', function () {
        assert.ok(DIST_SRC.indexOf('((is)\\d+|is$)') < 0, 'the pre-fix unanchored regex must not ship');
    });

    it('06.3 - the dual-env alias root reached the bundle (global identifiers survive minification)', function () {
        assert.ok(
            DIST_SRC.indexOf("window:typeof global!='undefined'?global:null") > -1,
            'the window-first / Node-global alias root must be in gina.min.js'
        );
    });
});
