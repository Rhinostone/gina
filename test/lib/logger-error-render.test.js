'use strict';
/**
 * Error rendering in the logger (#B434) — an `Error` passed as a log argument
 * keeps its message, stack, own properties and cause chain.
 *
 * Both stdout writers routed any `instanceof Object` argument through a
 * property walk that sees ENUMERABLE own props only — `write()` via its
 * custom `parse()`, the raw `console.log` path via `JSON.stringify` — and
 * `Error.prototype.message` / `.stack` are non-enumerable, so a bare Error
 * rendered as `{}` (or `{"code": "…"}` when it carried an enumerable prop),
 * silently dropping the one thing the line was written to report. The fix
 * special-cases errors at every site that type-switches on an argument and
 * renders them with `util.inspect()` — Node's own `console.error` shape.
 *
 * Covered (all BEHAVIORAL — the real singleton is driven; a source pin would
 * have ratified the `{}`):
 *   01  levelled writer: a bare Error carries message + stack + own props
 *   02  levelled writer: mixed string + Error keeps the string prefix
 *   03  levelled writer: an Error nested in an object / array is rendered too
 *   04  levelled writer: an Error's `cause` chain is rendered
 *   05  raw console.log path: a bare Error carries message + stack + own props
 *   06  raw console.log path: an Error nested in an object is rendered too
 *   07  controls: every non-Error argument renders byte-identically to before
 *   08  ordering: a rendered Error still passes the #B433 redaction seam
 *   09  a cross-realm Error (not `instanceof Error` here) is still detected
 *
 * The real lib/logger is required with GINA_LOG_STDOUT=true set BEFORE the
 * require (its module-level init dials the MQ speaker otherwise) and
 * GINA_LOG_FORMAT=text so the raw path writes the plain content. node --test
 * runs each file in its own process, so the singleton state cannot leak.
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var vm     = require('vm');

var FRAMEWORK  = path.resolve(require('../fw'));
var MAIN_SRC   = path.join(FRAMEWORK, 'lib/logger/src/main.js');
var REDACT_SRC = path.join(FRAMEWORK, 'lib/logger/src/redact.js');

var M = require(REDACT_SRC).MARKER;

var logger;
var frames = [];

before(function () {
    process.env.GINA_LOG_STDOUT = 'true';   // strips the mq flow before init
    process.env.GINA_LOG_FORMAT = 'text';   // raw path writes the plain content
    logger = require(MAIN_SRC);
    process.on('logger#default', function (p) { frames.push(JSON.parse(p)); });
});
after(function () {
    process.removeAllListeners('logger#default');
    delete process.env.GINA_LOG_STDOUT;
    delete process.env.GINA_LOG_FORMAT;
});

/** Content of the last levelled frame whose content carries `needle`. */
function levelled(needle) {
    var f = frames.filter(function (x) { return x.content.indexOf(needle) > -1; });
    return f.length ? f[f.length - 1].content : null;
}

/** Run `fn` with process.stdout captured; return everything it wrote. */
function rawOutput(fn) {
    var captured = [];
    var saved = process.stdout.write;
    process.stdout.write = function (s) { captured.push(String(s)); return true; };
    try { fn(); } finally { process.stdout.write = saved; }
    return captured.join('');
}

function boom(tag) {
    var err = new Error('boom ' + tag);
    err.code = 'E_BOOM';
    return err;
}

// A stack frame line: `    at <something>` — the tell that `.stack` was rendered.
var FRAME = /\n {4}at /;


// ─── 01  levelled: bare Error ────────────────────────────────────────────────
describe('01 - levelled writer: a bare Error carries message, stack and own props', function () {
    it('console.error(err) renders util.inspect(err), not the enumerable-props walk', function () {
        logger.error(boom('b434-01'));
        var c = levelled('b434-01');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('Error: boom b434-01') > -1, 'message present: ' + JSON.stringify(c));
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
        assert.ok(c.indexOf("code: 'E_BOOM'") > -1, 'own enumerable prop present: ' + JSON.stringify(c));
        assert.ok(c.indexOf('{"code": "E_BOOM"}') < 0, 'the pre-fix shape is gone: ' + JSON.stringify(c));
    });

    it('a plain Error with no own props renders its stack (was `{}`)', function () {
        logger.warn(new Error('plain b434-01b'));
        var c = levelled('b434-01b');
        assert.ok(c, 'the frame reached logger#default');
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
        assert.ok(c.indexOf('{}') < 0, 'no `{}` rendering: ' + JSON.stringify(c));
    });
});


// ─── 02  levelled: mixed arguments ───────────────────────────────────────────
describe('02 - levelled writer: mixed string + Error keeps the string prefix', function () {
    it('console.error("ctx", err) renders the prefix then the inspected Error', function () {
        logger.error('b434-02 failed:', boom('b434-02'));
        var c = levelled('b434-02 failed:');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('b434-02 failed: Error: boom b434-02') > -1, 'prefix then message: ' + JSON.stringify(c));
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
    });
});


// ─── 03  levelled: nested ────────────────────────────────────────────────────
describe('03 - levelled writer: an Error nested in an object or array is rendered', function () {
    it('console.error({ err }) renders the Error under its key with its stack', function () {
        logger.error({ tag: 'b434-03', err: boom('b434-03') });
        var c = levelled('b434-03');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('"err": Error: boom b434-03') > -1, 'nested Error rendered: ' + JSON.stringify(c));
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
        assert.ok(c.indexOf('"err": {') < 0, 'the pre-fix nested `{…}` shape is gone: ' + JSON.stringify(c));
    });

    it('console.error([ err ]) renders the Error element with its stack (was message-only)', function () {
        logger.error(['b434-03b', boom('b434-03b')]);
        var c = levelled('b434-03b');
        assert.ok(c, 'the frame reached logger#default');
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
    });
});


// ─── 04  levelled: cause chain ───────────────────────────────────────────────
describe('04 - levelled writer: the cause chain is rendered', function () {
    it('console.error(new Error("outer", { cause })) shows [cause]', function () {
        logger.error(new Error('outer b434-04', { cause: new Error('root b434-04') }));
        var c = levelled('b434-04');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('Error: outer b434-04') > -1, 'outer message: ' + JSON.stringify(c));
        assert.ok(c.indexOf('[cause]: Error: root b434-04') > -1, 'cause rendered: ' + JSON.stringify(c));
    });
});


// ─── 05  raw path: bare Error ────────────────────────────────────────────────
describe('05 - raw console.log path: a bare Error carries message, stack and own props', function () {
    it('console.log(err) renders util.inspect(err) (was the JSON.stringify `{}`)', function () {
        var line = rawOutput(function () { logger.log(boom('b434-05')); });
        assert.ok(line.indexOf('Error: boom b434-05') > -1, 'message present: ' + JSON.stringify(line));
        assert.match(line, FRAME, 'a stack frame present: ' + JSON.stringify(line));
        assert.ok(line.indexOf("code: 'E_BOOM'") > -1, 'own enumerable prop present: ' + JSON.stringify(line));
        assert.ok(line.indexOf('"code": "E_BOOM"') < 0, 'the pre-fix JSON shape is gone: ' + JSON.stringify(line));
    });
});


// ─── 06  raw path: nested ────────────────────────────────────────────────────
describe('06 - raw console.log path: an Error nested in an object is rendered', function () {
    it('console.log({ err }) carries the inspected Error as the value', function () {
        var line = rawOutput(function () { logger.log({ tag: 'b434-06', err: boom('b434-06') }); });
        // JSON.stringify escapes the stack's newlines, so the frame tell is `\n    at ` literally
        assert.ok(line.indexOf('"err": "Error: boom b434-06') > -1, 'nested Error rendered: ' + JSON.stringify(line));
        assert.ok(line.indexOf('\\n    at ') > -1, 'a stack frame present (escaped): ' + JSON.stringify(line));
        assert.ok(line.indexOf('"err": {') < 0, 'the pre-fix nested `{…}` shape is gone: ' + JSON.stringify(line));
    });
});


// ─── 07  controls ────────────────────────────────────────────────────────────
describe('07 - controls: non-Error arguments render exactly as before', function () {
    it('levelled: a plain object still renders through parse()', function () {
        logger.error({ tag: 'b434-07a', a: 1 });
        assert.equal(levelled('b434-07a'), '{"tag": "b434-07a", "a": 1} ');
    });

    it('levelled: a string still renders verbatim (plus the trailing space)', function () {
        logger.error('b434-07b plain string');
        assert.equal(levelled('b434-07b'), 'b434-07b plain string ');
    });

    it('levelled: a function still renders via toString()', function () {
        logger.error(function b434_07c() { return 1; });
        var c = levelled('b434_07c');
        assert.ok(c && c.indexOf('function b434_07c()') === 0, JSON.stringify(c));
    });

    it('raw: a plain object still renders through JSON.stringify with tab indent', function () {
        var line = rawOutput(function () { logger.log({ tag: 'b434-07d', a: 1 }); });
        assert.equal(line, '{\n\t"tag": "b434-07d",\n\t"a": 1\n}\n');
    });

    it('raw: a string still renders verbatim', function () {
        var line = rawOutput(function () { logger.log('b434-07e plain string'); });
        assert.equal(line, 'b434-07e plain string\n');
    });
});


// ─── 08  ordering vs the #B433 redaction seam ────────────────────────────────
describe('08 - a rendered Error still passes the redaction seam (no bypass)', function () {
    it('a credential inside err.message is masked on the levelled path', function () {
        logger.setRedaction(undefined, { group: 'b434@test' });
        logger.error(new Error('b434-08 fetch failed for /r?token=abcdef123456'));
        var c = levelled('b434-08');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('token=' + M) > -1, 'masked: ' + JSON.stringify(c));
        assert.ok(c.indexOf('abcdef123456') < 0, 'no raw value survives: ' + JSON.stringify(c));
        assert.match(c, FRAME, 'and the stack is still there');
    });

    it('a credential inside err.message is masked on the raw path', function () {
        var line = rawOutput(function () { logger.log(new Error('b434-08b fetch failed for /r?token=abcdef123456')); });
        assert.ok(line.indexOf('token=' + M) > -1, 'masked: ' + JSON.stringify(line));
        assert.ok(line.indexOf('abcdef123456') < 0, 'no raw value survives: ' + JSON.stringify(line));
    });
});


// ─── 09  cross-realm ─────────────────────────────────────────────────────────
describe('09 - a cross-realm Error is detected (util.types.isNativeError, not only instanceof)', function () {
    it('an Error minted in a vm context is not `instanceof Error` here, and still renders its stack', function () {
        var foreign = vm.runInNewContext('new Error("cross-realm b434-09")');
        assert.equal(foreign instanceof Error, false, 'precondition: the control discriminates');
        logger.error(foreign);
        var c = levelled('b434-09');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('Error: cross-realm b434-09') > -1, 'message present: ' + JSON.stringify(c));
        assert.match(c, FRAME, 'a stack frame present: ' + JSON.stringify(c));
    });
});
