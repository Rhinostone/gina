/**
 * script/version_compare.js — behavioural tests.
 *
 * Covers `isStrictlyOlder()` and `comparePrerelease()` against the
 * semver spec § 11 ordering rules. Pure unit tests — no fs, no network.
 *
 * The "never regress" guard at `script/post_install.js:822` depends on
 * `isStrictlyOlder()` to reject older-version reinstalls (the trigger
 * for the v0.3.10 stable publish def_framework drift).
 */

'use strict';

var nodePath = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT  = nodePath.join(__dirname, '..', '..', 'script', 'version_compare.js');
var COMPARE = require(SCRIPT);


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports isStrictlyOlder', function () {
        assert.equal(typeof COMPARE.isStrictlyOlder, 'function');
    });

    it('exports comparePrerelease', function () {
        assert.equal(typeof COMPARE.comparePrerelease, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — isStrictlyOlder: missing / unparseable / equal inputs
// ---------------------------------------------------------------------------

describe('02 - isStrictlyOlder: indeterminate inputs return false', function () {

    it('returns false when candidate is null', function () {
        assert.equal(COMPARE.isStrictlyOlder(null, '0.3.10'), false);
    });

    it('returns false when current is null', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', null), false);
    });

    it('returns false when candidate is undefined', function () {
        assert.equal(COMPARE.isStrictlyOlder(undefined, '0.3.10'), false);
    });

    it('returns false when current is empty string', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', ''), false);
    });

    it('returns false when candidate is unparseable garbage', function () {
        assert.equal(COMPARE.isStrictlyOlder('garbage', '0.3.10'), false);
    });

    it('returns false when current is unparseable garbage', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', 'garbage'), false);
    });

    it('returns false when both versions are equal', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10', '0.3.10'), false);
    });

    it('returns false when both pre-release versions are equal', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.2', '0.3.10-alpha.2'), false);
    });
});


// ---------------------------------------------------------------------------
// 03 — isStrictlyOlder: major / minor / patch numeric ordering
// ---------------------------------------------------------------------------

describe('03 - isStrictlyOlder: numeric core ordering', function () {

    it('older patch is older', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', '0.3.10'), true);
    });

    it('newer patch is not older', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.11', '0.3.10'), false);
    });

    it('older minor is older', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.2.99', '0.3.0'), true);
    });

    it('older major is older', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.99.99', '1.0.0'), true);
    });

    it('newer major beats lots of newer minor on the older side', function () {
        assert.equal(COMPARE.isStrictlyOlder('1.0.0', '0.99.99'), false);
    });

    it('strips a leading "v" from candidate', function () {
        assert.equal(COMPARE.isStrictlyOlder('v0.3.9', '0.3.10'), true);
    });

    it('strips a leading "v" from current', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', 'v0.3.10'), true);
    });
});


// ---------------------------------------------------------------------------
// 04 — isStrictlyOlder: pre-release vs stable (semver § 11.4)
// ---------------------------------------------------------------------------

describe('04 - isStrictlyOlder: pre-release vs stable', function () {

    it('alpha of patch X is older than stable patch X (semver § 11.3)', function () {
        // The exact case Gina's release flow walks through: alphas of 0.3.10
        // lead up to 0.3.10 stable. A reinstall of 0.3.10 over a def_framework
        // pinned at an alpha SHOULD advance.
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.5', '0.3.10'), true);
    });

    it('stable patch X is not older than alpha of patch X', function () {
        // The reverse: pinned at 0.3.10 stable, installing 0.3.10-alpha.5 must
        // not regress.
        assert.equal(COMPARE.isStrictlyOlder('0.3.10', '0.3.10-alpha.5'), false);
    });

    it('alpha of older patch is older than stable of newer patch', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.5', '0.3.11'), true);
    });

    it('alpha of newer patch is not older than stable of older patch', function () {
        // The "next alpha cycle" case: 0.3.11-alpha.1 supersedes 0.3.10 stable.
        assert.equal(COMPARE.isStrictlyOlder('0.3.11-alpha.1', '0.3.10'), false);
    });
});


// ---------------------------------------------------------------------------
// 05 — isStrictlyOlder: pre-release vs pre-release (semver § 11.4)
// ---------------------------------------------------------------------------

describe('05 - isStrictlyOlder: pre-release vs pre-release', function () {

    it('alpha.4 is older than alpha.5', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.4', '0.3.10-alpha.5'), true);
    });

    it('alpha.5 is not older than alpha.4', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.5', '0.3.10-alpha.4'), false);
    });

    it('alpha.10 is newer than alpha.9 (numeric, not lexical)', function () {
        // Lexically "alpha.10" < "alpha.9" by ASCII; numerically alpha.10 > alpha.9.
        // The comparator must use numeric ordering for purely-numeric identifiers.
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.10', '0.3.10-alpha.9'), false);
    });

    it('alpha.9 is older than alpha.10 (numeric)', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.9', '0.3.10-alpha.10'), true);
    });

    it('alpha is older than alpha.1 (shorter pre-release list, semver § 11.4.4)', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha', '0.3.10-alpha.1'), true);
    });

    it('beta.1 is newer than alpha.5 (lexical compare on identifier prefix)', function () {
        assert.equal(COMPARE.isStrictlyOlder('0.3.10-alpha.5', '0.3.10-beta.1'), true);
    });
});


// ---------------------------------------------------------------------------
// 06 — comparePrerelease: numeric vs identifier ordering
// ---------------------------------------------------------------------------

describe('06 - comparePrerelease', function () {

    it('numeric beats non-numeric on identifier vs identifier (semver § 11.4.3)', function () {
        // "alpha.5" vs "alpha.beta": numeric "5" is older than non-numeric "beta"
        // per spec — numeric identifiers always have lower precedence.
        assert.equal(COMPARE.comparePrerelease('alpha.5', 'alpha.beta'), -1);
    });

    it('non-numeric beats numeric (reverse)', function () {
        assert.equal(COMPARE.comparePrerelease('alpha.beta', 'alpha.5'), 1);
    });

    it('numeric vs numeric uses numeric ordering', function () {
        assert.equal(COMPARE.comparePrerelease('alpha.10', 'alpha.9'), 1);
    });

    it('returns 0 on identical inputs', function () {
        assert.equal(COMPARE.comparePrerelease('alpha.5', 'alpha.5'), 0);
    });

    it('shorter is older when prefix matches', function () {
        assert.equal(COMPARE.comparePrerelease('alpha', 'alpha.1'), -1);
    });
});


// ---------------------------------------------------------------------------
// 07 — Gina-specific scenarios — the exact v0.3.10 forensic shape
// ---------------------------------------------------------------------------

describe('07 - Gina release-flow scenarios', function () {

    it('replays the v0.3.10 forensic case: 0.3.9 reinstall over alpha.X must be rejected', function () {
        // pre-state: def_framework = 0.3.10-alpha.2 (the latest alpha that bumpVersion wrote)
        // trigger: `npm install -g gina@0.3.9` runs post_install with self.version = "0.3.9"
        // expected: guard rejects the write — 0.3.9 is strictly older than 0.3.10-alpha.2
        assert.equal(COMPARE.isStrictlyOlder('0.3.9', '0.3.10-alpha.2'), true);
    });

    it('alpha-to-stable transition advances correctly', function () {
        // Operator manually publishes 0.3.10 stable after alpha.2 cycle.
        // npm install -g gina@0.3.10 fires post_install with self.version = "0.3.10".
        // _mainData.def_framework was at 0.3.10-alpha.2 (or 0.3.11-alpha.1 if bumpVersion
        // already ran and shifted to next alpha cycle — see ranking below).
        assert.equal(COMPARE.isStrictlyOlder('0.3.10', '0.3.10-alpha.2'), false);
    });

    it('next-alpha-cycle advancement after stable', function () {
        // After 0.3.10 stable publish, post_publish.bumpVersion sets def_framework to 0.3.11-alpha.1.
        // Reinstalling gina@0.3.10 (the just-published stable) at this point would have
        // self.version = "0.3.10" but def_framework already at "0.3.11-alpha.1" — guard
        // rejects (0.3.10 is older than 0.3.11-alpha.1).
        assert.equal(COMPARE.isStrictlyOlder('0.3.10', '0.3.11-alpha.1'), true);
    });
});
