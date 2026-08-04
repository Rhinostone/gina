'use strict';
/**
 * #B206 — the scaffolded bundle template taught an impossible session-store
 * re-key, and four store-factory JSDoc blocks taught the same.
 *
 * `session.name` is express-session's FUNCTION name: `Function.prototype.name`
 * is writable:false (assignment is a silent no-op in sloppy mode, a TypeError
 * under strict mode), so `expressSession.name = 'myRedis'` can never select a
 * connectors.json entry — the SessionStore dispatcher always resolves the
 * literal 'session' key (`conf.content.connectors[session.name]`). The
 * boilerplate shipped by every `bundle:add` told users to do the impossible
 * re-key, against example entries named "myRedis"/"myDb" that the dispatcher
 * can never look up (the factory then throws `[SessionStore] Could not be
 * loaded` at boot).
 *
 * These are deliberately COMMENT/doc pins on RAW source (no comment
 * stripping): the defect lives in comments, and the public sessions guide
 * already documents the literal-"session" contract — these pins keep the
 * shipped template and factory docs from regressing to the impossible advice.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var TEMPLATE = path.join(FW, 'core/template/boilerplate/bundle/index.js');

var FACTORIES = {
    redis    : path.join(FW, 'core/connectors/redis/lib/session-store.js'),
    sqlite   : path.join(FW, 'core/connectors/sqlite/lib/session-store.js'),
    mongodb  : path.join(FW, 'core/connectors/mongodb/lib/session-store.js'),
    scylladb : path.join(FW, 'core/connectors/scylladb/lib/session-store.js')
};

var DISPATCHER = path.join(FW, 'lib/session-store.js');

/**
 * Drop full-line comments — used ONLY for the mechanism control (§03), which
 * must anchor on code, never on the reworded docs.
 *
 * @param   {string} src
 * @returns {string}
 * @inner
 */
function stripComments(src) {
    return src.split('\n').filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    }).join('\n');
}

var SRC = {};
before(function () {
    SRC.template   = fs.readFileSync(TEMPLATE, 'utf8');
    SRC.dispatcher = fs.readFileSync(DISPATCHER, 'utf8');
    Object.keys(FACTORIES).forEach(function (name) {
        SRC[name] = fs.readFileSync(FACTORIES[name], 'utf8');
    });
});


// ─── 01 — the mechanism (environment-independent, behavioral) ────────────────

describe('01 - #B206 Function.prototype.name cannot be re-pointed', function () {

    it('sloppy-mode assignment is a silent no-op', function () {
        var d = Object.getOwnPropertyDescriptor(function session() {}, 'name');
        assert.equal(d.writable, false);
        var fixture = new Function('function session(){} session.name = "myRedis"; return session.name;');
        assert.equal(fixture(), 'session');
    });

    it('strict-mode assignment throws TypeError', function () {
        var fixture = new Function('"use strict"; function session(){} session.name = "myRedis";');
        assert.throws(fixture, TypeError);
    });
});


// ─── 02 — the shipped boilerplate teaches the possible shape ─────────────────

describe('02 - #B206 boilerplate bundle template', function () {

    it('the impossible re-key is gone', function () {
        assert.ok(SRC.template.indexOf('expressSession.name =') < 0,
            'the template must not teach assigning to expressSession.name');
    });

    it('the never-resolvable example entry names are gone', function () {
        assert.ok(SRC.template.indexOf('"myRedis"') < 0, 'no "myRedis" entry example');
        assert.ok(SRC.template.indexOf('"myDb"') < 0, 'no "myDb" entry example');
    });

    it('both backend samples use the literal "session" entry', function () {
        var m = SRC.template.match(/\{ "session": \{ "connector":/g) || [];
        assert.equal(m.length, 2, 'redis + sqlite samples, both keyed "session"');
    });

    it('the template explains WHY the entry must be named "session"', function () {
        assert.match(SRC.template, /read-only/);
        assert.match(SRC.template, /MUST be named "session"/);
    });
});


// ─── 03 — the four factory docs no longer teach the re-key ───────────────────

describe('03 - #B206 store-factory JSDoc', function () {

    Object.keys(FACTORIES).forEach(function (name) {
        it(name + ': the "caller sets session.name" teaching is gone; the mechanism is unchanged', function () {
            assert.ok(SRC[name].indexOf('The caller sets') < 0,
                'the re-key teaching must not survive in ' + name);
            assert.ok(stripComments(SRC[name]).indexOf('var connName = session.name;') >= 0,
                'the resolution mechanism itself is untouched (control)');
        });
    });

    it('redis: the "(e.g. \\"myRedis\\")" inline example is gone', function () {
        assert.ok(SRC.redis.indexOf('"myRedis"') < 0);
    });
});


// ─── 04 — the dispatcher doc stays the accurate reference (control) ──────────

describe('04 - #B206 dispatcher JSDoc control', function () {

    it("lib/session-store.js documents the function-name resolution and the literal 'session' key", function () {
        assert.match(SRC.dispatcher, /function name/);
        assert.match(SRC.dispatcher, /"session"/);
    });
});
