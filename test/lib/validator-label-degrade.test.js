/**
 * validator-label-degrade — a bad error label must degrade, never take a form down.
 *
 * Fifth file in the `validator-label-*` family. The four siblings cover where a built-in
 * rule label COMES FROM (registry / server overlay / client whisper / runtime semantics).
 * This one covers what happens when whatever arrives is not a string.
 *
 * Four independent sources feed `replace()` (form-validator.js), and the framework
 * controls none of them:
 *
 *   1. a bundle catalog's `_validator.<rule>` label      — warned by the boot lint
 *   2. a `gina.validator.setErrorLabels()` override       — lint-blind (runtime)
 *   3. a rule's `errorMessage` argument                   — lint-blind (`is: ["cond", <x>]`)
 *   4. a per-field `error` (+ the query rule's            — lint-blind
 *      `systemError` / `optionError`)
 *
 * A non-string from any of them used to throw `TypeError: target.match is not a function`
 * at form-validator.js's `replace()`. That throw is unrecoverable: it escapes `validate()`,
 * so the submit-validation callback never runs and the form silently refuses to submit
 * (the submit trigger is never natively disabled — `updateSubmitTriggerState` only ever
 * clears `disabled` — so the user sees a live button that does nothing), and a boot-time
 * pass throws out of `bindForm` into an unguarded binding loop, leaving every later form
 * on the page unbound.
 *
 * The fix threads the rule name into `replace()` as an OPTIONAL third argument, so the one
 * place all four sources converge can fall back: resolved label -> English default -> ''.
 * Optional because `replace` is re-exported to app-defined validators through
 * `getValidationContext()`, which call it with two arguments.
 *
 * `compileError()` sits one line UPSTREAM of `replace()` on the query path and carried the
 * same class of defect — `error.match(/g)` returns `null`, not `[]`, when a backend field
 * error carries no `{{placeholder}}` (the common shape), so `varArr.length` threw before
 * the label could render. Guarded here too.
 *
 * Shape: sections 01-04 drive the REAL engine (with known-negative controls, so a passing
 * read cannot come from a stuck instrument, and a SUBTRACT proving the guard is
 * load-bearing). Section 05 is a drift pin over every `replace()` call site. Section 06
 * covers `compileError`, which is closure-private and unreachable from node — source pins
 * plus a pure-logic replica plus a subtract, NOT a claim that the real function was driven.
 * The `setErrorLabels()` registry layer (source 2) is `isGFFCtx`-gated and likewise
 * unreachable from node; it is covered at the chokepoint instead (section 02), which is
 * where it would arrive.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

process.env.NODE_ENV_IS_DEV = process.env.NODE_ENV_IS_DEV || 'false';
process.setMaxListeners(0);
require(path.join(FW, 'helpers'));
/* global getContext, setContext */
if (typeof getContext('gina') === 'undefined') { setContext('gina', { forms: null }); }

var ENGINE_PATH = path.join(FW, 'core/plugins/lib/validator/src/form-validator.js');
var ENGINE_SRC  = fs.readFileSync(ENGINE_PATH, 'utf8');

var FormValidator = require(ENGINE_PATH);

if (!process.gina) { process.gina = {}; }
process.gina._i18nCatalogs = process.gina._i18nCatalogs || {};

process.gina._i18nCatalogs.degradeok = {
    fr_FR: { _validator: {
        isRequired:        'Ne peut etre vide',
        isEmail:           'Le champ %n est invalide',
        isStringMinLength: 'Au moins %s caracteres',
        is:                'Condition non satisfaite'
    } }
};
process.gina._i18nCatalogs.degradebad = {
    fr_FR: { _validator: {
        isRequired:        { message: 'Requis' },   // object
        isStringMinLength: 42,                      // number
        isEmail:           'Le champ %n est invalide'
    } }
};

/** Capture console.warn across an async call; always restores. */
async function warnsDuring(fn) {
    var warns = [], original = console.warn;
    console.warn = function () { warns.push(Array.prototype.join.call(arguments, ' ')); };
    var value, err = null;
    try { value = await fn(); } catch (e) { err = e; } finally { console.warn = original; }
    return { warns: warns, value: value, err: err };
}

/** Run one failing rule through the REAL engine for `culture`; return the rendered label. */
async function render(bundle, rule, value, culture, errorKey, args) {
    setContext('bundle', bundle);
    var v = new FormValidator({ field: value }, undefined, undefined, undefined, culture);
    var res = await v.field[rule].apply(v.field, args || [{}, {}, {}, function () {}]);
    return res && res.errors ? res.errors[errorKey || rule] : undefined;
}

/** Source with `//` line comments and `*`-prefixed JSDoc lines removed. */
var CODE_LINES = ENGINE_SRC.split('\n').filter(function (l) {
    var t = l.trim();
    return t.indexOf('//') !== 0 && t.indexOf('*') !== 0 && t.indexOf('/*') !== 0;
});


// 01 — controls: nothing about the healthy path moved
describe('01 - CONTROLS: a healthy label still resolves and still interpolates', function () {

    it('a catalog label renders localized', async function () {
        assert.equal(await render('degradeok', 'isRequired', '', 'fr_FR'), 'Ne peut etre vide');
    });

    it('%n interpolates from a catalog label', async function () {
        assert.equal(await render('degradeok', 'isEmail', 'nope', 'fr_FR'), 'Le champ field est invalide');
    });

    it('%s interpolates from a catalog label via an array-arg rule', async function () {
        var msg = await render('degradeok', 'isString', 'abc', 'fr_FR', 'isStringLength', [5]);
        assert.equal(msg, 'Au moins 5 caracteres');
    });

    it('KNOWN-NEGATIVE: an unseeded culture renders the English default', async function () {
        // If this ever localizes, the instrument is stuck and every reading here is void.
        assert.equal(await render('degradeok', 'isRequired', '', 'de_DE'), 'Cannot be left empty');
    });

    it('a healthy label emits NO degrade warning', async function () {
        var r = await warnsDuring(function () { return render('degradeok', 'isRequired', '', 'fr_FR'); });
        assert.deepEqual(r.warns, []);
    });
});


// 02 — source 1 (catalog) and the chokepoint that also catches sources 2 and 4
describe('02 - a non-string label degrades to the English default', function () {

    it('a non-string CATALOG label -> English default, no throw, one warn', async function () {
        var r = await warnsDuring(function () { return render('degradebad', 'isRequired', '', 'fr_FR'); });
        assert.equal(r.err, null, 'expected no throw, got ' + r.err);
        assert.equal(r.value, 'Cannot be left empty');
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /\[FormValidator\]/);
        assert.match(r.warns[0], /isRequired/);
        assert.match(r.warns[0], /must be a string/);
        assert.match(r.warns[0], /object/, 'expected the offending type in the warning');
    });

    it('the guard runs BEFORE token substitution: the English fallback still interpolates %s', async function () {
        // `isStringMinLength` is 42 in the bad catalog; the English default carries `%s`.
        var r = await warnsDuring(function () {
            return render('degradebad', 'isString', 'abc', 'fr_FR', 'isStringLength', [5]);
        });
        assert.equal(r.err, null);
        assert.equal(r.value, 'Should be at least 5 characters');
    });

    it('degradation is PER KEY: a sibling rule keeps its catalog label', async function () {
        var r = await warnsDuring(function () { return render('degradebad', 'isEmail', 'nope', 'fr_FR'); });
        assert.equal(r.value, 'Le champ field est invalide');
        assert.deepEqual(r.warns, []);
    });

    it('source 3 — a non-string `errorMessage` falls back to the RESOLVED (localized) label', async function () {
        // `is: ["$a === $b", <non-string>]` in a form-rule JSON. The boot lint never reads
        // form-rule JSON, so this is the chokepoint's job. The catalog label is intact here,
        // so step 1 of the chain wins over the English default.
        setContext('bundle', 'degradeok');
        var v = new FormValidator({ field: 'x' }, undefined, undefined, undefined, 'fr_FR');
        var r = await warnsDuring(function () { return v.field.is(false, { nope: 1 }); });
        assert.equal(r.err, null);
        assert.equal(v.field.errors.is, 'Condition non satisfaite');
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /`is`/);
    });

    it('source 4 — a non-string per-field `error` falls back to the resolved label', async function () {
        setContext('bundle', 'degradeok');
        var v = new FormValidator({ field: '' }, undefined, undefined, undefined, 'fr_FR');
        v.field.error = ['an', 'array'];
        var r = await warnsDuring(function () { return v.field.isRequired({}, {}, {}, function () {}); });
        assert.equal(r.err, null);
        assert.equal(v.field.errors.isRequired, 'Ne peut etre vide');
    });

    it('when BOTH the override and the catalog label are bad, English wins', async function () {
        setContext('bundle', 'degradebad');
        var v = new FormValidator({ field: '' }, undefined, undefined, undefined, 'fr_FR');
        v.field.error = { still: 'not a string' };
        var r = await warnsDuring(function () { return v.field.isRequired({}, {}, {}, function () {}); });
        assert.equal(r.err, null);
        assert.equal(v.field.errors.isRequired, 'Cannot be left empty');
    });

    it('SUBTRACT: the pre-fix expression on the same input still throws', function () {
        // Proves the guard is load-bearing rather than the input being harmless.
        var target = { message: 'Requis' };
        assert.throws(function () { target.match(/%[a-z]+/gi); }, /match is not a function/);
    });
});


// 03 — warn hygiene: a mistyped label must not spam one warning per keystroke
describe('03 - one warning per rule per engine instance', function () {

    it('two fields failing the same bad rule warn once', async function () {
        setContext('bundle', 'degradebad');
        var v = new FormValidator({ a: '', b: '' }, undefined, undefined, undefined, 'fr_FR');
        var r = await warnsDuring(async function () {
            await v.a.isRequired({}, {}, {}, function () {});
            await v.b.isRequired({}, {}, {}, function () {});
        });
        assert.equal(r.warns.length, 1);
    });

    it('a FRESH engine warns again (the cache is per-instance, not module-scoped)', async function () {
        // Module-scoped would suppress a second bundle's warning on the server, where the
        // module is shared across bundles and requests.
        setContext('bundle', 'degradebad');
        var r1 = await warnsDuring(function () {
            var v = new FormValidator({ field: '' }, undefined, undefined, undefined, 'fr_FR');
            return v.field.isRequired({}, {}, {}, function () {});
        });
        var r2 = await warnsDuring(function () {
            var v = new FormValidator({ field: '' }, undefined, undefined, undefined, 'fr_FR');
            return v.field.isRequired({}, {}, {}, function () {});
        });
        assert.equal(r1.warns.length, 1);
        assert.equal(r2.warns.length, 1);
    });

    it('source: the warn cache is declared inside the constructor, not at module scope', function () {
        var ctorIdx  = ENGINE_SRC.indexOf('function FormValidatorUtil(');
        var cacheIdx = ENGINE_SRC.indexOf('var _labelWarnings = {};');
        assert.ok(cacheIdx > ctorIdx, 'expected _labelWarnings inside FormValidatorUtil');
    });
});


// 04 — the public 2-arg `replace` contract used by app-defined validators
describe('04 - replace()\'s third argument is OPTIONAL (getValidationContext contract)', function () {

    function ctx() {
        setContext('bundle', 'degradeok');
        var v = new FormValidator({ field: 'x' }, undefined, undefined, undefined, undefined);
        return v.field.getValidationContext();
    }

    it('getValidationContext still exposes replace', function () {
        assert.equal(typeof ctx().replace, 'function');
    });

    it('a 2-arg call on a good string is unchanged', function () {
        assert.equal(ctx().replace('Must have %s characters', { size: 3 }), 'Must have 3 characters');
    });

    it('a 2-arg call on a non-string yields an empty message, warns, and does not throw', async function () {
        var c = ctx();
        var r = await warnsDuring(function () { return c.replace({ bad: 1 }, { size: 3 }); });
        assert.equal(r.err, null);
        assert.equal(r.value, '');
        assert.equal(r.warns.length, 1);
        assert.match(r.warns[0], /unknown rule/);
    });

    it('a 3-arg call with an unknown rule also yields an empty message', async function () {
        var c = ctx();
        var r = await warnsDuring(function () { return c.replace(7, {}, 'someUserValidator'); });
        assert.equal(r.value, '');
        assert.match(r.warns[0], /someUserValidator/);
    });

    it('source: replace still reaches app validators through getValidationContext', function () {
        assert.ok(ENGINE_SRC.indexOf("'replace'   : replace") >= 0);
        assert.ok(ENGINE_SRC.indexOf('replace = validationContext.replace;') >= 0);
    });
});


// 05 — DRIFT PIN over every replace() call site
describe('05 - every replace() call site passes the label key it resolves', function () {

    var CALL_RE = /[^.\w$]replace\(/;

    function callSites() {
        return CODE_LINES.filter(function (l) {
            return CALL_RE.test(l) && l.indexOf('var replace = function') < 0;
        });
    }

    it('there are exactly 26 live call sites', function () {
        // A new call site must be threaded too; this trips when one is added unthreaded.
        assert.equal(callSites().length, 26);
    });

    it('each site passes, as its 3rd argument, the same key it reads from local.errorLabels', function () {
        // Guards the one mistake a mechanical edit invites: `local.errorLabels['isNumberMinLength']`
        // paired with `'isNumberLength'` (the errors[] key), which would silently pick the
        // wrong English default.
        var pairRe = /local\.errorLabels\[(?:'(\w+)'|(alias))\][^)]*?,\s*_?this,\s*(?:'(\w+)'|(alias))\s*\)/;
        callSites().forEach(function (l) {
            var m = l.match(pairRe);
            assert.ok(m, 'call site missing a 3rd argument: ' + l.trim());
            var labelKey = m[1] || m[2];
            var ruleArg  = m[3] || m[4];
            assert.equal(ruleArg, labelKey, 'rule arg must equal the label key: ' + l.trim());
        });
    });

    it('every label key used at a call site has an English default', function () {
        // This is what makes "degrade to the English default" true at 26/26 sites rather
        // than merely usual. `alias` is excluded: it resolves to 'is', which IS a default.
        var defaults = ENGINE_SRC
            .slice(ENGINE_SRC.indexOf('var _defaultErrorLabels = {'), ENGINE_SRC.indexOf("'isInList': 'Must be one of: %s'"))
            .match(/'(\w+)':/g)
            .map(function (m) { return m.replace(/'|:/g, ''); })
            .concat(['isInList']);

        var used = [];
        callSites().forEach(function (l) {
            var m = l.match(/local\.errorLabels\['(\w+)'\]/);
            if (m) { used.push(m[1]); }
        });
        assert.ok(used.length >= 25, 'expected the literal-key sites, got ' + used.length);
        used.forEach(function (k) {
            assert.ok(defaults.indexOf(k) >= 0, 'no English default for label key `' + k + '`');
        });
        assert.ok(defaults.indexOf('is') >= 0, "`alias` degrades to the 'is' default");
    });

    it('source: the guard sits ABOVE the token scan, and the scan line is untouched', function () {
        var guardIdx = ENGINE_SRC.indexOf("if ( typeof(target) !== 'string' ) {");
        var scanIdx  = ENGINE_SRC.indexOf('var keys = target.match(/%[a-z]+/gi);');
        assert.ok(guardIdx >= 0, 'expected the non-string guard');
        assert.ok(scanIdx > guardIdx, 'the guard must run before the token scan');
    });

    it('source: the fallback chain is resolved-label -> English default -> empty', function () {
        var block = ENGINE_SRC.slice(
            ENGINE_SRC.indexOf('var replace = function(target, fieldObj, rule)'),
            ENGINE_SRC.indexOf('var keys = target.match(/%[a-z]+/gi);')
        );
        var localIdx   = block.indexOf("typeof(local.errorLabels[rule]) === 'string'");
        var defaultIdx = block.indexOf("typeof(_defaultErrorLabels[rule]) === 'string'");
        assert.ok(localIdx >= 0 && defaultIdx > localIdx, 'resolved label must be tried before the default');
        assert.ok(block.indexOf("''") > defaultIdx, 'empty message must be the last resort');
    });
});


// 06 — compileError: closure-private, so source pins + replica + subtract (NOT driven)
describe('06 - compileError no longer dies on a placeholder-less backend error', function () {

    it('source: the !varArr guard exists and precedes the length read', function () {
        var matchIdx  = ENGINE_SRC.indexOf('var varArr = error.match(/\\{\\{([^{{}}]+)\\}\\}/g );');
        var guardIdx  = ENGINE_SRC.indexOf('if (!varArr) {', matchIdx);
        var lengthIdx = ENGINE_SRC.indexOf('vLen=varArr.length', matchIdx);
        assert.ok(matchIdx >= 0, 'expected the compileError match');
        assert.ok(guardIdx > matchIdx, 'expected the null guard after the match');
        assert.ok(lengthIdx > guardIdx, 'the guard must precede varArr.length');
    });

    it('source: the query call site only compiles a string', function () {
        assert.ok(ENGINE_SRC.indexOf("if ( typeof(errorFields[_this.name]) === 'string' ) {") >= 0);
    });

    it('source: the outer `!= undefined` branch is preserved (else-if routing unchanged)', function () {
        // Narrowing the OUTER test to `=== 'string'` would reroute a non-string field error
        // into the systemError branch. It must stay `!= 'undefined'`.
        assert.ok(ENGINE_SRC.indexOf("if ( typeof(errorFields[_this.name]) != 'undefined') {") >= 0);
    });

    it('replica: `String.match` with a /g regex returns null, not [], when nothing matches', function () {
        assert.equal('Already taken'.match(/\{\{([^{{}}]+)\}\}/g), null);
    });

    it('replica: the guarded shape returns the error verbatim; the pre-fix shape throws', function () {
        var error = 'Already taken';

        var fixed = function () {
            var varArr = error.match(/\{\{([^{{}}]+)\}\}/g);
            if (!varArr) { return error; }
            return 'compiled';
        };
        assert.equal(fixed(), 'Already taken');

        // SUBTRACT — remove the guard and the same input throws, as it did before the fix.
        var prefix = function () {
            var varArr = error.match(/\{\{([^{{}}]+)\}\}/g);
            for (var v = 0, vLen = varArr.length; v < vLen; v++) { /* unreachable */ }
            return 'compiled';
        };
        assert.throws(prefix, /Cannot read properties of null/);
    });

    it('replica: a placeholder-bearing error is still compiled (the guard is not a bypass)', function () {
        var error = 'Value {{data[name]}} is taken';
        var varArr = error.match(/\{\{([^{{}}]+)\}\}/g);
        assert.ok(varArr, 'a {{placeholder}} must still match');
        assert.equal(varArr.length, 1);
    });
});
