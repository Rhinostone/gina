/**
 * validator-checkbox-rule-injection — the forced-rule injection ORDER (#49 follow-up).
 *
 * getFormValidationInfos self-injects `isBoolean` + `isRequired` onto a
 * boolean-classified checkbox whose declared rule lacks `isBoolean` (and the
 * legacy value branch does the same for boolean-valued radios). Rules are
 * applied in key insertion order (the per-field `for..in` dispatch), and the
 * engine's isBoolean rescue — which clears the isRequired error a real boolean
 * `false` records (`false` reads as empty under the engine's loose `!= ''`
 * emptiness check) — only fires for an error recorded BEFORE it runs. The
 * injection therefore appends `isRequired` BEFORE `isBoolean`; the reverse
 * append order leaves the isRequired error standing, so an unchecked box whose
 * rule declared neither key failed validation with "Cannot be left empty".
 *
 * Shape: (a) source pins locking the isRequired-then-isBoolean append at BOTH
 * injection sites (and the reverse order globally absent), (b) behavioural
 * runs of the REAL plugin over the server auto path — the same per-field rule
 * dispatch loop and the same engine rule functions the client uses — proving
 * the order is load-bearing: the shipped order validates an unchecked (false)
 * box, the pre-fix order fails it (subtract control).
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
setContext('bundle', 'ckbinjbundle');

var MAIN_PATH = path.join(FW, 'core/plugins/lib/validator/src/main.js');
var mainSrc   = fs.readFileSync(MAIN_PATH, 'utf8');

var Validator = require(MAIN_PATH); // ValidatorPlugin (the public gina.plugins.Validator)


describe('validator-checkbox-rule-injection §01 — injection-order source pins', function () {

    it('01.1 - both injection sites append isRequired BEFORE isBoolean', function () {
        // Anchor each site on its else-if condition (the two collector injections
        // are the only occurrences of this exact clause in the file), then require
        // the isRequired append to precede the isBoolean append within the block.
        var re = /typeof\(rules\[name\]\.isBoolean\) == 'undefined' \) \{[\s\S]{0,600}?rules\[name\]\.isRequired = true;\s*\n\s*rules\[name\]\.isBoolean = true;/g;
        var m = mainSrc.match(re);
        assert.ok(m && m.length === 2,
            'expected the isRequired-then-isBoolean append at exactly the two injection sites, got ' + (m ? m.length : 0));
    });

    it('01.2 - the pre-fix append order (isBoolean first) is globally absent', function () {
        // Window-independent negative pin: nowhere in the file may an isBoolean
        // append be followed by an isRequired append.
        assert.equal(mainSrc.match(/rules\[name\]\.isBoolean = true;[\s\S]{0,200}?rules\[name\]\.isRequired = true;/), null,
            'no site may append isBoolean before isRequired');
    });
});


describe('validator-checkbox-rule-injection §02 — the order is load-bearing (real dispatch + engine)', function () {

    it('02.1 - isRequired-first + isBoolean validates an unchecked (false) box (the engine rescue)', function () {
        var rule = {};
        rule.isRequired = true;
        rule.isBoolean  = true;
        var res = Validator({ myconsent: rule }, { myconsent: false }, 'ckb-inj-form');
        assert.equal(res.isValid(), true,
            'a real boolean false is a valid required boolean when isRequired records first');
    });

    it('02.2 - the reverse order (isBoolean first) leaves the isRequired error standing (order-sensitivity control)', function () {
        var rule = {};
        rule.isBoolean  = true;
        rule.isRequired = true;
        var res = Validator({ myconsent: rule }, { myconsent: false }, 'ckb-inj-form');
        assert.equal(res.isValid(), false,
            'the isBoolean rescue cannot clear an isRequired error recorded after it ran');
        assert.ok(res.error && res.error.myconsent
            && typeof res.error.myconsent.isRequired === 'string'
            && res.error.myconsent.isRequired.length > 0,
            'the surviving error must be isRequired');
    });

    it('02.3 - the SHIPPED injection order onto a rule lacking both keys validates an unchecked box', function () {
        // Mirrors the collectors' else-if append onto e.g. an exclude-only rule —
        // the exact membership the widened injection now reaches (a valueless or
        // boolean-classified checkbox with a rule that declared neither key).
        var rule = { exclude: false };
        rule.isRequired = true; // appended first — the shipped order
        rule.isBoolean  = true;
        var res = Validator({ myconsent: rule }, { myconsent: false }, 'ckb-inj-form');
        assert.equal(res.isValid(), true,
            'an unchecked optional checkbox must not fail "Cannot be left empty"');
    });

    it('02.4 - subtract: the PRE-fix append order fails the same unchecked box', function () {
        var rule = { exclude: false };
        rule.isBoolean  = true; // pre-fix appended isBoolean first
        rule.isRequired = true;
        var res = Validator({ myconsent: rule }, { myconsent: false }, 'ckb-inj-form');
        assert.equal(res.isValid(), false,
            'the pre-fix order left the isRequired error standing — proves the swap is load-bearing');
        assert.ok(res.error && res.error.myconsent
            && typeof res.error.myconsent.isRequired === 'string',
            'the failure must be the standing isRequired error');
    });

    it('02.5 - a checked (true) box validates in the injected shape regardless of order', function () {
        var rule = { exclude: false };
        rule.isRequired = true;
        rule.isBoolean  = true;
        var res = Validator({ myconsent: rule }, { myconsent: true }, 'ckb-inj-form');
        assert.equal(res.isValid(), true, 'true passes isRequired directly — no rescue needed');
    });
});
