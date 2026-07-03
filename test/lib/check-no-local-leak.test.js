/**
 * script/check_no_local_leak.js — source-structure pin (#R5).
 *
 * The prepack hook's path-level scan (PATH_PATTERN) catches forbidden
 * filenames in the tarball listing, and the content-level scan
 * (scanContent → CONTENT_TOKENS) catches private-token literals
 * (phone/email/legal-name) in file contents. #R5 added a second
 * content-level sub-axis: ATTRIBUTION_LEAK_RE catches file content
 * embedding local-tool path literals + AI-attribution footers,
 * stripped against ATTRIBUTION_EXCEPTION_RE to allow legitimate
 * vendor-functionality references (AI-connector protocols, vendor
 * SDK names, env-var names).
 *
 * These pins lock the regex shape + scanContent integration + the
 * SELF_EXCLUDE entry that prevents the loader's own JSDoc from
 * self-matching. Without them a future refactor could silently drop
 * the attribution check and reintroduce the #R5 gap.
 */

'use strict';

var nodePath = require('path');
var fs = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var SOURCE = nodePath.join(__dirname, '..', '..', 'script', 'check_no_local_leak.js');
var SRC = fs.readFileSync(SOURCE, 'utf8');


describe('01 - check_no_local_leak.js declares ATTRIBUTION_LEAK_RE (#R5)', function () {

    it('declares ATTRIBUTION_LEAK_RE as a module-level const', function () {
        assert.ok(
            SRC.indexOf('var ATTRIBUTION_LEAK_RE = ') > -1,
            "expected `var ATTRIBUTION_LEAK_RE = ` declaration — #R5 leak regex missing"
        );
    });

    it('captures the bare CLAUDE.md filename literal via \\bCLAUDE\\.md\\b', function () {
        assert.ok(
            SRC.indexOf('\\bCLAUDE\\.md\\b') > -1,
            "expected `\\bCLAUDE\\.md\\b` in ATTRIBUTION_LEAK_RE — the 0.3.15 sidecar leak literal must be caught in content"
        );
    });

    it('captures .claude* directory/file path references via \\.claude[a-z]*', function () {
        assert.ok(
            SRC.indexOf('\\.claude[a-z]*') > -1,
            "expected `\\.claude[a-z]*` in ATTRIBUTION_LEAK_RE — must catch .claude/, .claudeignore, .claude/conventions.md, etc. in content"
        );
    });

    it('captures the claude.ai AI-tool URL', function () {
        assert.ok(
            SRC.indexOf('claude\\.ai') > -1,
            "expected `claude\\.ai` in ATTRIBUTION_LEAK_RE — AI-tool URL leakage must be caught"
        );
    });

    it('captures the claude.com/claude-code AI-tool URL', function () {
        assert.ok(
            SRC.indexOf('claude\\.com\\/claude-code') > -1,
            "expected `claude\\.com\\/claude-code` in ATTRIBUTION_LEAK_RE — AI-tool URL leakage must be caught"
        );
    });

    it('captures Co-Authored-By attribution footers (Claude or Anthropic)', function () {
        assert.ok(
            SRC.indexOf('Co-Authored-By:?') > -1,
            "expected `Co-Authored-By:?` in ATTRIBUTION_LEAK_RE — co-author footers are a documented HARD-RULE leak shape"
        );
    });

    it('captures Generated-by-Claude attribution footers', function () {
        assert.ok(
            SRC.indexOf('Generated (?:by|with)') > -1,
            "expected `Generated (?:by|with)` in ATTRIBUTION_LEAK_RE — Generated-by attribution footers are a documented HARD-RULE leak shape"
        );
    });

    it('captures noreply@anthropic.com author-line leak', function () {
        assert.ok(
            SRC.indexOf('noreply@anthropic\\.com') > -1,
            "expected `noreply@anthropic\\.com` in ATTRIBUTION_LEAK_RE — sentinel email from auto-generated commits"
        );
    });

    it('uses the case-insensitive /i flag on the leak regex', function () {
        var declIdx = SRC.indexOf('var ATTRIBUTION_LEAK_RE = ');
        assert.ok(declIdx > -1, 'ATTRIBUTION_LEAK_RE declaration not found');
        var lineEnd = SRC.indexOf('\n', declIdx);
        var line = SRC.substring(declIdx, lineEnd);
        assert.ok(
            /\/i;?\s*$/.test(line),
            'expected ATTRIBUTION_LEAK_RE to use case-insensitive /i flag — needed to catch claude/CLAUDE/Claude variants uniformly'
        );
    });

});


describe('02 - check_no_local_leak.js declares ATTRIBUTION_EXCEPTION_RE for vendor-functionality strip (#R5)', function () {

    it('declares ATTRIBUTION_EXCEPTION_RE as a module-level const', function () {
        assert.ok(
            SRC.indexOf('var ATTRIBUTION_EXCEPTION_RE = ') > -1,
            "expected `var ATTRIBUTION_EXCEPTION_RE = ` declaration — vendor-functionality strip missing"
        );
    });

    it('exempts the anthropic:// AI-connector protocol identifier', function () {
        assert.ok(
            SRC.indexOf('anthropic:\\/\\/') > -1,
            "expected `anthropic:\\/\\/` in ATTRIBUTION_EXCEPTION_RE — AI-connector protocol identifier is product-functionality, must be allowlisted"
        );
    });

    it('exempts the @anthropic-ai/sdk vendor SDK package name', function () {
        assert.ok(
            SRC.indexOf('@anthropic-ai\\/sdk') > -1,
            "expected `@anthropic-ai\\/sdk` in ATTRIBUTION_EXCEPTION_RE — the vendor SDK package name the AI connector imports must be allowlisted"
        );
    });

    it('exempts ANTHROPIC_API_KEY canonical env-var name', function () {
        assert.ok(
            SRC.indexOf('ANTHROPIC_API_KEY') > -1,
            "expected `ANTHROPIC_API_KEY` in ATTRIBUTION_EXCEPTION_RE — canonical env-var name must be allowlisted"
        );
    });

    it('exempts OPENAI_API_KEY canonical env-var name (sibling allowlist)', function () {
        assert.ok(
            SRC.indexOf('OPENAI_API_KEY') > -1,
            "expected `OPENAI_API_KEY` in ATTRIBUTION_EXCEPTION_RE — allowlist is multi-vendor by design, sibling env-var pinned for completeness"
        );
    });

    it('uses the global + case-insensitive /gi flags on the exception regex', function () {
        var declIdx = SRC.indexOf('var ATTRIBUTION_EXCEPTION_RE = ');
        assert.ok(declIdx > -1, 'ATTRIBUTION_EXCEPTION_RE declaration not found');
        var lineEnd = SRC.indexOf('\n', declIdx);
        var line = SRC.substring(declIdx, lineEnd);
        assert.ok(
            /\/gi;?\s*$/.test(line),
            'expected ATTRIBUTION_EXCEPTION_RE to use /gi flags — global so all vendor refs are stripped, case-insensitive for robustness'
        );
    });

});


describe('03 - scanContent integrates the AI-attribution leak check (#R5)', function () {

    it('strips ATTRIBUTION_EXCEPTION_RE matches into a local `stripped` var', function () {
        assert.ok(
            SRC.indexOf("content.replace(ATTRIBUTION_EXCEPTION_RE, '')") > -1,
            "expected `content.replace(ATTRIBUTION_EXCEPTION_RE, '')` inside scanContent — exception strip missing"
        );
    });

    it('tests the stripped content against ATTRIBUTION_LEAK_RE', function () {
        assert.ok(
            SRC.indexOf('ATTRIBUTION_LEAK_RE.test(stripped)') > -1,
            "expected `ATTRIBUTION_LEAK_RE.test(stripped)` inside scanContent — leak test missing"
        );
    });

    it("pushes 'AI-attribution leak' to the hits array on regex match", function () {
        assert.ok(
            SRC.indexOf("hits.push('AI-attribution leak')") > -1,
            "expected `hits.push('AI-attribution leak')` inside scanContent — hit accumulation missing"
        );
    });

    it('attribution check fires AFTER the CONTENT_TOKENS loop (private tokens scanned first)', function () {
        var tokenLoopIdx = SRC.indexOf('for (var i = 0; i < CONTENT_TOKENS.length;');
        var attrCheckIdx = SRC.indexOf('ATTRIBUTION_LEAK_RE.test(stripped)');
        assert.ok(tokenLoopIdx > -1, 'CONTENT_TOKENS loop not found');
        assert.ok(attrCheckIdx > -1, 'attribution check not found');
        assert.ok(
            attrCheckIdx > tokenLoopIdx,
            'attribution check should run AFTER the CONTENT_TOKENS loop — preserves existing scan order, keeps the new axis additive'
        );
    });

    it('exception-strip statement appears BEFORE the leak test', function () {
        var stripIdx  = SRC.indexOf("content.replace(ATTRIBUTION_EXCEPTION_RE, '')");
        var leakIdx   = SRC.indexOf('ATTRIBUTION_LEAK_RE.test(stripped)');
        assert.ok(stripIdx > -1 && leakIdx > -1);
        assert.ok(
            stripIdx < leakIdx,
            'expected exception-strip to precede the leak test — must run on the stripped copy, not raw content'
        );
    });

});


describe('04 - SELF_EXCLUDE adds _load_private_tokens.js (#R5)', function () {

    it("SELF_EXCLUDE includes 'script/_load_private_tokens.js': true", function () {
        assert.ok(
            SRC.indexOf("'script/_load_private_tokens.js': true") > -1,
            "expected `'script/_load_private_tokens.js': true` in SELF_EXCLUDE — its JSDoc references the HARD-RULE patterns literally and would trip ATTRIBUTION_LEAK_RE"
        );
    });

    it('retains the existing scanner-script exclusions', function () {
        assert.ok(
            SRC.indexOf("'script/check_no_local_leak.js'") > -1,
            "expected `'script/check_no_local_leak.js'` retained in SELF_EXCLUDE"
        );
        assert.ok(
            SRC.indexOf("'script/prepare_version.js'") > -1,
            "expected `'script/prepare_version.js'` retained in SELF_EXCLUDE"
        );
    });

});


describe('05 - content-leak error header generalised to surface both leak classes', function () {

    it('error header is the generic "Leaks in pack contents:" form', function () {
        assert.ok(
            SRC.indexOf('[prepack] ERROR: Leaks in pack contents:') > -1,
            "expected the generic 'Leaks in pack contents:' header — attribution + private-token hits flow through the same accumulator"
        );
    });

    it('does NOT carry the prior narrow "Private tokens in pack contents:" form', function () {
        assert.equal(
            SRC.indexOf('Private tokens in pack contents:'),
            -1,
            "expected the prior 'Private tokens in pack contents:' header to be gone — was too narrow once the AI-attribution axis joined the accumulator"
        );
    });

});

// 06 — npm 12 pack-JSON dual shape + zero-files fail-closed guard.
// npm <= 11 emits `npm pack --json` as an ARRAY of pack entries; npm 12 emits
// an OBJECT keyed by package name. The pre-fix `parsed.length` loop iterated
// ZERO times over the object shape, so the scan reported a clean pack without
// scanning anything — a vacuous pass on this security gate. The fix normalizes
// both shapes AND fails closed when zero files were recognized, so no future
// shape change can vacuously pass again.
describe('06 - npm 12 pack-JSON dual shape + fail-closed guard', function () {

    it('normalizes both the array (npm <= 11) and object-keyed (npm 12) shapes', function () {
        assert.ok(SRC.indexOf('Array.isArray(parsed)') > -1,
            'expected the Array.isArray(parsed) shape test');
        assert.ok(/Object\.keys\(parsed\)\.map\(function\s*\(k\)\s*\{\s*return parsed\[k\];\s*\}\)/.test(SRC),
            'expected the object-keyed shape to be mapped to an entries array');
        assert.ok(/for\s*\(var i = 0; i < entries\.length; i\+\+\)/.test(SRC),
            'the scan loop must iterate the NORMALIZED entries, not the raw parse');
    });

    it('fails closed when zero files were recognized (exit 1 before any OK)', function () {
        var gIdx = SRC.indexOf('if (totalFiles === 0) {');
        assert.ok(gIdx > -1, 'expected the totalFiles === 0 fail-closed guard');
        var window = SRC.substring(gIdx, gIdx + 400);
        assert.ok(/process\.exit\(1\)/.test(window),
            'the zero-files guard must process.exit(1)');
        var okIdx = SRC.indexOf('[prepack] OK:');
        assert.ok(okIdx > gIdx, 'the fail-closed guard must sit BEFORE the OK exit');
    });

    it('pure-logic replica: both shapes normalize identically; unknown shapes trip the guard; the pre-fix loop was vacuous on the npm 12 shape', function () {
        var normalize = function (parsed) {
            return Array.isArray(parsed)
                ? parsed
                : ( (parsed && typeof parsed === 'object')
                    ? Object.keys(parsed).map(function (k) { return parsed[k]; })
                    : [] );
        };
        var countFiles = function (entries) {
            var total = 0;
            for (var i = 0; i < entries.length; i++) {
                total += (entries[i].files || []).length;
            }
            return total;
        };
        var files = [{ path: 'a.js' }, { path: 'b.js' }, { path: 'CLAUDE.md' }];
        var arrShape = [{ id: 'x@1.0.0', files: files }];          // npm <= 11
        var objShape = { x: { id: 'x@1.0.0', files: files } };     // npm 12

        assert.equal(countFiles(normalize(arrShape)), 3);
        assert.equal(countFiles(normalize(objShape)), 3);
        assert.deepEqual(
            normalize(objShape)[0].files.map(function (f) { return f.path; }),
            normalize(arrShape)[0].files.map(function (f) { return f.path; }),
            'both shapes must yield the same scanned paths'
        );

        // Unknown shapes -> zero files -> the guard fires (fail closed).
        assert.equal(countFiles(normalize(null)), 0);
        assert.equal(countFiles(normalize(42)), 0);
        assert.equal(countFiles(normalize('str')), 0);

        // Subtract: the PRE-FIX loop indexed the raw parse — over the npm 12
        // object shape `parsed.length` is undefined, the loop body never ran,
        // and the scan passed vacuously (zero files looked, zero leaks found).
        var preFixIterations = 0;
        var parsed = objShape;
        for (var i = 0; i < parsed.length; i++) { preFixIterations++; }
        assert.equal(preFixIterations, 0,
            'premise: the pre-fix loop is a no-op on the npm 12 shape — the defect the guard now blocks');
    });

});
