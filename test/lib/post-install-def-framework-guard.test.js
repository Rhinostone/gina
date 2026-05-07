/**
 * Source-structure pins for the def_framework "never regress" guard
 * added to script/post_install.js as Path 2c (root cause fix for the
 * v0.3.10 stable publish drift).
 *
 * Pure regression coverage on top of test/lib/version-compare.test.js:
 * the comparator's logic is tested there; this file pins that
 * post_install.js actually wires the comparator into the def_framework
 * write path. Without these pins, a future maintainer could remove the
 * `isStrictlyOlder` guard while leaving the comparator in place, and
 * the regression would resurface silently — the defensive gate at
 * script/check_def_framework_consistency.js would still abort the next
 * publish, but the trigger would be back.
 */

'use strict';

var fs = require('fs');
var nodePath = require('path');
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');

var POST_INSTALL_PATH = nodePath.resolve(__dirname, '..', '..', 'script', 'post_install.js');

var SRC = '';
before(function () {
    SRC = fs.readFileSync(POST_INSTALL_PATH, 'utf8');
});


// ---------------------------------------------------------------------------
// 01 — module wiring: version_compare is required and the comparator called
// ---------------------------------------------------------------------------

describe('01 - post_install requires version_compare', function () {

    it('requires script/version_compare.js inside the def_framework guard block', function () {
        assert.match(SRC, /require\(['"]\.\/version_compare['"]\)/,
            'post_install.js must require ./version_compare from the def_framework guard');
    });

    it('calls isStrictlyOlder with (self.version, _mainData.def_framework)', function () {
        // The order of args is load-bearing: candidate first (the version
        // being installed), current second (what's already pinned). Reversing
        // them would invert the guard and let regressions through.
        assert.match(SRC,
            /isStrictlyOlder\s*\(\s*self\.version\s*,\s*_mainData\.def_framework\s*\)/,
            'post_install.js must call isStrictlyOlder(self.version, _mainData.def_framework) — argument order matters');
    });
});


// ---------------------------------------------------------------------------
// 02 — guard semantics: write only proceeds when NOT a regression
// ---------------------------------------------------------------------------

describe('02 - guard wraps the def_framework write', function () {

    it('the def_framework assignment is gated by !_isRegression', function () {
        // The write `_mainData.def_framework = self.version` must be inside
        // a branch that requires _isRegression to be falsy.
        assert.match(SRC,
            /if\s*\(\s*_mainData\.def_framework\s*!==\s*self\.version\s*&&\s*!_isRegression\s*\)/,
            'post_install.js must gate the def_framework assignment behind !_isRegression');
    });

    it('on regression: still updates the frameworks list (additive-only)', function () {
        // Even when regressing, push self.version into the frameworks list
        // so the operator can see the historic install. This matches the
        // forensic shape: the v0.3.10 backup had alpha.1 and alpha.2 in
        // the frameworks list (from prior installs) while the scalar
        // remained pinned.
        var elseBranch = SRC.match(/else\s+if\s*\(\s*_isRegression\s*\)\s*\{[\s\S]+?\}\s*\}/);
        assert.ok(elseBranch, 'post_install.js must have an else-if (_isRegression) branch');
        assert.match(elseBranch[0], /_mainData\.frameworks\[self\.shortVersion\]\.push\(self\.version\)/,
            'regression branch must still push self.version into the frameworks list');
    });

    it('on regression: emits a console.info explaining the skip', function () {
        // Operators reading post_install output need to see why
        // def_framework wasn't bumped. The skip is intentional, not a bug
        // — the message must say so.
        assert.match(SRC,
            /Skipping def_framework update[\s\S]+strictly older[\s\S]+preserving newer state/,
            'post_install.js regression branch must log a "Skipping def_framework update" message');
    });
});


// ---------------------------------------------------------------------------
// 03 — JSDoc / comment trail explaining the guard rationale
// ---------------------------------------------------------------------------

describe('03 - intent is documented inline', function () {

    it('comment trail mentions "Never regress" and the v0.3.10 precedent', function () {
        assert.match(SRC, /[Nn]ever regress/,
            'post_install.js comment trail must mention "Never regress" so future maintainers do not strip the guard');
        assert.match(SRC, /v0\.3\.10/,
            'post_install.js comment trail must reference v0.3.10 precedent for traceability');
    });
});
