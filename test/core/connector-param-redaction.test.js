'use strict';
/**
 * #B350 — bound query parameter values must not reach dev/instrumentation
 * sinks by default (gina-io/gina#61).
 *
 * The connectors capture queries into the per-request Inspector query log and
 * print dev console lines under the dev-OR-instrumentation-window gate. Bound
 * parameter VALUES (positional bind arrays) — and value-bearing statement
 * bodies (a document database's resolved body, a bulk insert's inlined
 * records) — are secrets to the calling application, and the key-based
 * redact library cannot cover them (a positional array has no key names).
 * The fix routes every such sink through core/connectors/param-redact.js:
 * redacted-by-default (count + type markers), with real values restored only
 * when `settings.inspector.queries.captureValues` is true (boot-seeded onto
 * process.gina._inspectorQueryCaptureValues, fail-closed).
 *
 * Strategy:
 *   §01  behavioral — the real param-redact module (real bytes, no replica):
 *        type markers, console form, payload form, deep body redaction.
 *   §02  behavioral — the captureValues() gate against a toggled slot.
 *   §03  behavioral replica of the one-line gated payload expression the
 *        connectors carry, driven with the REAL module both gate states
 *        (anti-drift: §04's positive pins assert the files carry exactly
 *        this expression shape).
 *   §04  per-connector source pins — positive: every value sink is routed
 *        through the gate; negative: the raw pre-fix forms are gone. Needles
 *        chosen so the post-fix line does NOT contain the pre-fix needle
 *        (validated red-first against the pre-fix blobs — see the harness
 *        note in the ledger entry).
 *   §05  gna.js boot-seed pins (fail-closed, `=== true` coercion).
 *   §06  boundary — the AI connector stays on its own captureText contract.
 */
var { describe, it, beforeEach, afterEach, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var paramRedact = require(path.join(FW, 'core/connectors/param-redact'));

/** Read a connector source file once. */
function readConnector(name) {
    return fs.readFileSync(path.join(FW, 'core/connectors/' + name + '/index.js'), 'utf8');
}

// ─── 01 — the real module: markers and redacted forms ────────────────────────
describe('01 - param-redact: type markers and redacted forms (real bytes)', function() {

    it('typeMarker classifies every bind-value family without echoing the value', function() {
        assert.equal(paramRedact.typeMarker('tok'), '[string]');
        assert.equal(paramRedact.typeMarker(42), '[number]');
        assert.equal(paramRedact.typeMarker(true), '[boolean]');
        assert.equal(paramRedact.typeMarker(null), '[null]');
        assert.equal(paramRedact.typeMarker(undefined), '[undefined]');
        assert.equal(paramRedact.typeMarker(10n), '[bigint]');
        assert.equal(paramRedact.typeMarker(function(){}), '[function]');
        assert.equal(paramRedact.typeMarker(Symbol('s')), '[symbol]');
        assert.equal(paramRedact.typeMarker([1]), '[array]');
        assert.equal(paramRedact.typeMarker(new Date()), '[date]');
        assert.equal(paramRedact.typeMarker(Buffer.from('x')), '[buffer]');
        assert.equal(paramRedact.typeMarker({a:1}), '[object]');
    });

    it('describeParams renders the console form: count + type list, zero value bytes', function() {
        var secret = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6';
        var out = paramRedact.describeParams([secret, 7, secret]);
        assert.equal(out, '3 [string, number, string]');
        assert.ok(out.indexOf(secret) < 0, 'the value must not appear in the description');
        assert.equal(paramRedact.describeParams([]), '0 []');
        assert.equal(paramRedact.describeParams(null), '0 []');
    });

    it('summarize is length-preserving and carries zero value bytes', function() {
        var secret = 'sess-9f8e7d6c5b4a';
        var out = paramRedact.summarize([secret, 42, null]);
        assert.deepEqual(out, ['[string]', '[number]', '[null]']);
        assert.equal(out.length, 3, 'arity survives for the Inspector params table');
        assert.equal(JSON.stringify(out).indexOf(secret), -1);
        assert.deepEqual(paramRedact.summarize('not-an-array'), []);
    });

    it('redactValuesDeep keeps keys + nesting, masks every primitive leaf', function() {
        var body = { filter: { token: 'abc', n: 5 }, opts: { arr: [1, 's'] }, d: new Date(), nul: null };
        var out = paramRedact.redactValuesDeep(body);
        assert.deepEqual(Object.keys(out), ['filter', 'opts', 'd', 'nul']);
        assert.equal(out.filter.token, '[string]');
        assert.equal(out.filter.n, '[number]');
        assert.deepEqual(out.opts.arr, ['[number]', '[string]']);
        assert.equal(out.d, '[date]');
        assert.equal(out.nul, '[null]');
        // never mutates the input
        assert.equal(body.filter.token, 'abc');
    });

    it('redactValuesDeep is circular-safe and depth-capped', function() {
        var circ = { a: 1 };
        circ.self = circ;
        var out = paramRedact.redactValuesDeep(circ);
        assert.equal(out.a, '[number]');
        assert.equal(out.self, '[circular]');

        var deep = {}, cur = deep;
        for (var i = 0; i < 20; i++) { cur.next = {}; cur = cur.next; }
        cur.leaf = 'v';
        var red = JSON.stringify(paramRedact.redactValuesDeep(deep));
        assert.ok(red.indexOf('[deep]') > -1, 'over-deep tails collapse to a marker');
        assert.equal(red.indexOf('"v"'), -1, 'the deep leaf value never rides');
    });
});

// ─── 02 — the opt-in gate ─────────────────────────────────────────────────────
describe('02 - param-redact: captureValues() reads the boot-seeded slot, fail-closed', function() {

    var savedGina;
    beforeEach(function() { savedGina = process.gina; });
    afterEach(function()  { process.gina = savedGina; });

    it('absent process.gina -> false (fail-closed)', function() {
        process.gina = undefined;
        assert.equal(paramRedact.captureValues(), false);
    });

    it('absent slot -> false; seeded true -> true; seeded false -> false', function() {
        process.gina = {};
        assert.equal(paramRedact.captureValues(), false);
        process.gina = { _inspectorQueryCaptureValues: true };
        assert.equal(paramRedact.captureValues(), true);
        process.gina = { _inspectorQueryCaptureValues: false };
        assert.equal(paramRedact.captureValues(), false);
    });
});

// ─── 03 — behavioral replica of the gated payload expression ─────────────────
//
// The exact one-line expression the connectors carry for the query-log entry's
// `params` field (couchbase substitutes its `queryParams` local for `args`).
// Kept in sync with the real files by §04's positive pins.
function gatedParamsField(args) {
    return args.length > 0 ? (paramRedact.captureValues() ? args.slice() : paramRedact.summarize(args)) : [];
}

describe('03 - gated payload expression (real module, both gate states)', function() {

    var savedGina;
    beforeEach(function() { savedGina = process.gina; });
    afterEach(function()  { process.gina = savedGina; });

    it('gate CLOSED (default) -> markers ride, values do not [the fix]', function() {
        process.gina = {}; // no slot seeded — the shipped default
        var secret = 'one-time-64hex-credential-value';
        var out = gatedParamsField([secret, 9]);
        assert.deepEqual(out, ['[string]', '[number]']);
        assert.equal(JSON.stringify(out).indexOf(secret), -1);
    });

    it('gate OPEN (operator opt-in) -> real values ride, as before the fix', function() {
        process.gina = { _inspectorQueryCaptureValues: true };
        var out = gatedParamsField(['tok', 9]);
        assert.deepEqual(out, ['tok', 9]);
    });

    it('empty bind array -> [] either way', function() {
        process.gina = {};
        assert.deepEqual(gatedParamsField([]), []);
        process.gina = { _inspectorQueryCaptureValues: true };
        assert.deepEqual(gatedParamsField([]), []);
    });
});

// ─── 04 — per-connector source pins ───────────────────────────────────────────
describe('04 - every connector value sink is capture-gated (source pins)', function() {

    // The five positional-bind connectors share the same three shapes:
    // the require line, the gated console line, the gated payload field.
    ['postgresql', 'mysql', 'sqlite', 'duckdb', 'scylladb'].forEach(function(name) {
        describe(name, function() {
            var src;
            before(function() { src = readConnector(name); });

            it('requires the shared param-redact sibling', function() {
                assert.ok(src.indexOf("require('./../param-redact')") > -1);
            });

            it('console params line is gated (values only via captureValues())', function() {
                assert.ok(
                    src.indexOf("params: ' + (paramRedact.captureValues() ? JSON.stringify(args) : paramRedact.describeParams(args))") > -1,
                    name + ': gated console form present');
                // negative — the raw pre-fix form is gone (the gated line does not
                // contain this needle: after the quote-plus comes the gate paren)
                assert.equal(src.indexOf("params: ' + JSON.stringify(args));"), -1,
                    name + ': ungated console form gone');
            });

            it('query-log params field is gated (length-preserving markers by default)', function() {
                assert.ok(
                    src.indexOf('args.length > 0 ? (paramRedact.captureValues() ? args.slice() : paramRedact.summarize(args)) : []') > -1,
                    name + ': gated payload form present');
                assert.equal(src.indexOf('args.length > 0 ? args.slice() : []'), -1,
                    name + ': ungated payload form gone');
            });
        });
    });

    describe('couchbase (three sinks: console line, payload field, bulkInsert statement)', function() {
        var src;
        before(function() { src = readConnector('couchbase'); });

        it('requires the shared param-redact sibling', function() {
            assert.ok(src.indexOf("require('./../param-redact')") > -1);
        });

        it('the reported console line (gina-io/gina#61) is gated', function() {
            assert.ok(
                src.indexOf("Found query params: '+ (paramRedact.captureValues() ? queryParams : paramRedact.describeParams(queryParams))") > -1,
                'gated Found-query-params line present');
            assert.equal(src.indexOf("Found query params: '+ queryParams)"), -1,
                'ungated Found-query-params line gone');
        });

        it('query-log params field is gated', function() {
            assert.ok(
                src.indexOf('queryParams.length > 0 ? (paramRedact.captureValues() ? queryParams.slice() : paramRedact.summarize(queryParams)) : []') > -1);
            assert.equal(src.indexOf('queryParams.length > 0 ? queryParams.slice() : []'), -1);
        });

        it('bulkInsert statement (inlined document values) is gated on both sinks', function() {
            var declIdx = src.indexOf('var _biStatementForLog = paramRedact.captureValues()');
            assert.ok(declIdx > -1, 'gated bulk statement local present');
            assert.ok(src.indexOf("record(s) [values redacted]") > -1,
                'redacted bulk form carries op + record count');
            // both bulk sinks read the gated local: the console line and the
            // query-log entry's statement field, in that order after the decl
            var consoleIdx = src.indexOf("'+_biStatementForLog)", declIdx);
            var fieldIdx   = src.indexOf('String(_biStatementForLog)', declIdx);
            assert.ok(consoleIdx > declIdx, 'bulk console line reads the gated local');
            assert.ok(fieldIdx > consoleIdx, 'bulk query-log statement reads the gated local');
            // direction pin — the ternary spans lines, so unlike the single-line
            // sinks its main needle does not encode which arm is which: assert
            // capture-ON yields the real statement (the `? statement` arm comes
            // FIRST, the redacted literal is the default arm)
            var onArmIdx  = src.indexOf('? statement', declIdx);
            var offArmIdx = src.indexOf("record(s) [values redacted]", declIdx);
            assert.ok(onArmIdx > declIdx && onArmIdx < consoleIdx, 'capture-on arm present in the decl');
            assert.ok(offArmIdx > onArmIdx, 'redacted literal is the default (second) arm');
            // negative — the pre-fix bulk console form (no space after the quote-plus,
            // which distinguishes it from the main query path's statement line) is gone
            assert.equal(src.indexOf("'+statement)"), -1, 'ungated bulk console form gone');
            // scope control — the main query path's statement line (placeholders only,
            // deliberately NOT a value sink) is still logged un-gated
            assert.ok(src.indexOf("'+ statement)") > -1, 'main statement line (placeholder-safe) untouched');
        });
    });

    describe('mongodb (three sinks: console body line, statement field, params field)', function() {
        var src;
        before(function() { src = readConnector('mongodb'); });

        it('requires the shared param-redact sibling', function() {
            assert.ok(src.indexOf("require('./../param-redact')") > -1);
        });

        it('console body line is gated (structure-preserving deep redaction)', function() {
            assert.ok(
                src.indexOf("body=' + JSON.stringify(paramRedact.captureValues() ? resolvedBody : paramRedact.redactValuesDeep(resolvedBody))") > -1);
        });

        it('query-log statement + params fields are gated; raw stringify is gone', function() {
            assert.ok(
                src.indexOf("op + ' ' + JSON.stringify(paramRedact.captureValues() ? resolvedBody : paramRedact.redactValuesDeep(resolvedBody))") > -1);
            assert.ok(
                src.indexOf('args.length > 0 ? (paramRedact.captureValues() ? args.slice() : paramRedact.summarize(args)) : []') > -1);
            // negative — no remaining unconditional stringify of the resolved body
            assert.equal(src.indexOf('JSON.stringify(resolvedBody)'), -1,
                'every stringify of the body now routes through the gate');
            assert.equal(src.indexOf('args.length > 0 ? args.slice() : []'), -1);
        });
    });
});

// ─── 05 — the boot seed (gna.js) ──────────────────────────────────────────────
describe('05 - gna.js seeds inspector.queries.captureValues fail-closed', function() {

    var src;
    before(function() {
        src = fs.readFileSync(path.join(FW, 'core/gna.js'), 'utf8');
    });

    it('seeds the slot from settings with strict === true coercion', function() {
        assert.ok(
            src.indexOf('process.gina._inspectorQueryCaptureValues = (_qInspConf.captureValues === true)') > -1,
            'strict-boolean seed present');
        assert.ok(
            /_qInspSettings\.inspector\.queries/.test(src),
            'reads the settings.inspector.queries block');
    });

    it('fail-closed catch arm forces the slot to false', function() {
        var seedIdx  = src.indexOf('process.gina._inspectorQueryCaptureValues = (_qInspConf.captureValues === true)');
        var catchIdx = src.indexOf('process.gina._inspectorQueryCaptureValues = false', seedIdx);
        assert.ok(catchIdx > seedIdx, 'the catch arm follows the seed and closes the gate');
    });

    it('mirrors the sibling capture opt-in seeds (ai captureText / events captureArgs)', function() {
        // structural: all three opt-ins live in the same boot region, each fail-closed
        var aiIdx = src.indexOf('process.gina._inspectorAiCaptureText = (_aiInspConf.captureText === true)');
        var evIdx = src.indexOf('process.gina._inspectorEventsCaptureArgs = (_evInspConf.captureArgs === true)');
        var qIdx  = src.indexOf('process.gina._inspectorQueryCaptureValues = (_qInspConf.captureValues === true)');
        assert.ok(aiIdx > -1 && evIdx > -1 && qIdx > -1, 'all three capture opt-ins seeded');
        assert.ok(qIdx > evIdx, 'the queries seed sits with its siblings (after the events seed)');
    });
});

// ─── 06 — boundary: the AI connector keeps its own contract ──────────────────
describe('06 - ai connector stays on its captureText contract (no param-redact)', function() {

    it('ai/index.js does not require param-redact — its value-class capture is already gated', function() {
        var src = readConnector('ai');
        assert.equal(src.indexOf("require('./../param-redact')"), -1);
        assert.ok(src.indexOf('_inspectorAiCaptureText') > -1, 'control: its own gate is present');
    });
});
