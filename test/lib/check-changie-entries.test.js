/**
 * script/check_changie_entries.js — behavioural tests.
 *
 * Covers each safe body shape (single-quoted, double-quoted, block scalar)
 * and each rejection pattern (unquoted, missing kind/body/time,
 * unescaped apostrophe inside single-quoted, unterminated single quote,
 * double-quoted body without a closing quote). Runs the script via
 * child_process.spawnSync against tempdir fixtures so the full CLI path
 * (argv handling + exit code + stderr messaging) is exercised.
 */

'use strict';

var fs       = require('fs');
var os       = require('os');
var nodePath = require('path');
var { spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var SCRIPT = nodePath.join(__dirname, '..', '..', 'script', 'check_changie_entries.js');
var CHECK  = require(SCRIPT); // also exercise the pure helpers directly

var ROOT = nodePath.join(os.tmpdir(), 'gina-check-changie-test-' + Date.now());

/** Write `content` to <ROOT>/<name> and return the absolute path. */
function write(name, content) {
    var p = nodePath.join(ROOT, name);
    fs.writeFileSync(p, content);
    return p;
}

/** Run the script with the given file paths; returns { status, stderr }. */
function run() {
    var args = Array.prototype.slice.call(arguments);
    var r = spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

before(function () {
    fs.mkdirSync(ROOT, { recursive: true });
    ROOT = fs.realpathSync(ROOT);
});

after(function () {
    fs.rmSync(ROOT, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// 01 — module shape
// ---------------------------------------------------------------------------

describe('01 - module shape', function () {

    it('exports validate', function () {
        assert.equal(typeof CHECK.validate, 'function');
    });

    it('exports validateSingleQuotedBody', function () {
        assert.equal(typeof CHECK.validateSingleQuotedBody, 'function');
    });

    it('exports doubleQuoteTerminates', function () {
        assert.equal(typeof CHECK.doubleQuoteTerminates, 'function');
    });
});


// ---------------------------------------------------------------------------
// 02 — happy paths: all three safe body shapes accept
// ---------------------------------------------------------------------------

describe('02 - happy paths', function () {

    it('single-quoted body passes', function () {
        var f = write('ok-single.yaml', [
            'kind: Added',
            "body: 'single-quoted body is always safe'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 0, r.stderr);
    });

    it('single-quoted body with escaped apostrophes passes', function () {
        var f = write('ok-apostrophes.yaml', [
            'kind: Added',
            "body: 'connector''s contract — don''t break it'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 0);
    });

    it('double-quoted body passes', function () {
        var f = write('ok-double.yaml', [
            'kind: Added',
            'body: "double-quoted body with \\"escaped\\" quotes"',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 0);
    });

    it('block scalar with >- passes', function () {
        var f = write('ok-block-folded.yaml', [
            'kind: Added',
            'body: >-',
            '  block-folded scalar',
            '  no escaping needed at all',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 0);
    });

    it('block scalar with |- passes', function () {
        var f = write('ok-block-literal.yaml', [
            'kind: Added',
            'body: |-',
            '  literal block scalar',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 0);
    });

    it('all Kind enum values accepted', function () {
        ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'].forEach(function (kind) {
            var f = write('ok-' + kind + '.yaml', [
                'kind: ' + kind,
                "body: 'valid body'",
                'time: 2026-04-22T12:00:00Z',
                ''
            ].join('\n'));
            assert.equal(run(f).status, 0, 'kind=' + kind);
        });
    });

    it('multiple valid files pass in one invocation', function () {
        var a = write('multi-a.yaml', [
            'kind: Added',
            "body: 'A'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var b = write('multi-b.yaml', [
            'kind: Fixed',
            "body: 'B'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(a, b).status, 0);
    });
});


// ---------------------------------------------------------------------------
// 03 — rejected unquoted bodies (the three failure modes from lesson #66)
// ---------------------------------------------------------------------------

describe('03 - unquoted bodies are rejected', function () {

    it('rejects an unquoted body with `:` (EINVAL-style mapping-values hazard)', function () {
        var f = write('bad-colon.yaml', [
            'kind: Fixed',
            'body: Bundle no longer crashes with EINVAL: invalid argument',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /unquoted/);
    });

    it('rejects an unquoted body with " #" (YAML comment hazard)', function () {
        var f = write('bad-hash.yaml', [
            'kind: Added',
            'body: Feature shipped (#M8 / #AI3) — description continues here',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 1);
    });

    it('rejects an unquoted plain body even when content looks "safe"', function () {
        // This locks in the strict rule from lesson #66: unquoted bodies
        // are NEVER allowed, even when the current text has no hazards —
        // a future edit might add one.
        var f = write('bad-plain.yaml', [
            'kind: Added',
            'body: This body happens to have no colons or hashes — but still unquoted',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        assert.equal(run(f).status, 1);
    });
});


// ---------------------------------------------------------------------------
// 04 — rejected single-quoted bodies
// ---------------------------------------------------------------------------

describe('04 - single-quoted rejection paths', function () {

    it('rejects an unescaped `\'` inside a single-quoted body', function () {
        var f = write('bad-sq-unescaped.yaml', [
            'kind: Added',
            "body: 'resolver's cache — unescaped apostrophe'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /unescaped/);
    });

    it('rejects an unterminated single-quoted body', function () {
        var f = write('bad-sq-unterminated.yaml', [
            'kind: Added',
            "body: 'this body never closes before the time key",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /never terminates|missing closing/);
    });
});


// ---------------------------------------------------------------------------
// 05 — rejected double-quoted bodies
// ---------------------------------------------------------------------------

describe('05 - double-quoted rejection paths', function () {

    it('rejects an unterminated double-quoted body', function () {
        var f = write('bad-dq-unterminated.yaml', [
            'kind: Added',
            'body: "body opens but never closes',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not terminate/);
    });
});


// ---------------------------------------------------------------------------
// 06 — missing fields
// ---------------------------------------------------------------------------

describe('06 - missing fields', function () {

    it('rejects a file with no kind field', function () {
        var f = write('bad-no-kind.yaml', [
            "body: 'orphan body'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /missing `kind:`/);
    });

    it('rejects a file with unknown kind', function () {
        var f = write('bad-kind-enum.yaml', [
            'kind: Unknown',
            "body: 'wrong kind value'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /not one of/);
    });

    it('rejects a file with no body field', function () {
        var f = write('bad-no-body.yaml', [
            'kind: Added',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /missing `body:`/);
    });

    it('rejects a file with no time field', function () {
        var f = write('bad-no-time.yaml', [
            'kind: Added',
            "body: 'no time'",
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /missing `time:`|ISO-8601/);
    });

    it('rejects a file with empty body value', function () {
        var f = write('bad-empty-body.yaml', [
            'kind: Added',
            'body:',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /empty/);
    });

    it('rejects a file where time appears before body', function () {
        var f = write('bad-field-order.yaml', [
            'kind: Added',
            'time: 2026-04-22T12:00:00Z',
            "body: 'reverse order'",
            ''
        ].join('\n'));
        var r = run(f);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /field order/);
    });
});


// ---------------------------------------------------------------------------
// 07 — batch behaviour: ALL files are checked, not just the first
// ---------------------------------------------------------------------------

describe('07 - batch behaviour', function () {

    it('reports every failing file in one pass', function () {
        var a = write('batch-a.yaml', [
            'kind: Added',
            "body: 'OK entry'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var b = write('batch-b.yaml', [
            'kind: Added',
            'body: Unquoted',
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var c = write('batch-c.yaml', [
            'kind: Bad',
            "body: 'OK body'",
            'time: 2026-04-22T12:00:00Z',
            ''
        ].join('\n'));
        var r = run(a, b, c);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /batch-b\.yaml/);
        assert.match(r.stderr, /batch-c\.yaml/);
        // batch-a must NOT appear in the failure list
        assert.doesNotMatch(r.stderr, /batch-a\.yaml:/);
    });

    it('no args → exit 0 (nothing staged to check)', function () {
        var r = run();
        assert.equal(r.status, 0);
    });

    it('missing file path → reported, exits 1', function () {
        var r = run(nodePath.join(ROOT, 'does-not-exist.yaml'));
        assert.equal(r.status, 1);
        assert.match(r.stderr, /cannot read file/);
    });
});
