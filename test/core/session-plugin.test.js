'use strict';
/**
 * Session plugin (#CSRF1) tests
 *
 * Strategy — mirrors the #SCS campaign shape:
 *  - Source-inspection guards that pin the key patterns in src/main.js.
 *  - Behavioural unit tests on the internal helpers (_mergeCookie, _assertInvariant,
 *    _resolveSettingsDefaults) — no framework boot required.
 *  - End-to-end tests through a stub `express-session` function to verify the
 *    wrap-and-merge contract.
 *  - Negative-invariant lock: `SameSite=None` without `Secure` must throw at
 *    factory call time.
 */

var { describe, it, before, after, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var PLUGIN = path.join(FW, 'core/plugins/lib/session/src/main.js');

var Session;
var originalGetContext;
var originalGetConfig;

before(function () {
    // The plugin reads `getContext()` + `getConfig()` from the global scope.
    // Stub them so the module can be required in isolation.
    originalGetContext = global.getContext;
    originalGetConfig  = global.getConfig;
    global.getContext = function () { return { bundle: 'test', env: 'dev' }; };
    global.getConfig  = function () { return { test: { dev: { content: { settings: {} } } } }; };
    Session = require(PLUGIN);
});

after(function () {
    global.getContext = originalGetContext;
    global.getConfig  = originalGetConfig;
});


// ─── 01 — Source inspection: the hardening pattern is in the file ────────────

describe('01 - source inspection: hardened-cookie patterns are present', function () {

    var src;
    before(function () { src = fs.readFileSync(PLUGIN, 'utf8'); });

    it('#CSRF1 marker is present', function () {
        assert.ok(src.indexOf('#CSRF1') > -1, 'expected #CSRF1 marker for traceability');
    });

    it('reads settings.json > session.cookie.* via content.settings.session.cookie', function () {
        assert.ok(
            /content\.settings[^\n]*\n[\s\S]*settings\.session[\s\S]*session\.cookie/.test(src),
            'expected content.settings → session → cookie read chain'
        );
    });

    it('validates sameSite against ALLOWED_SAMESITE enum', function () {
        assert.ok(
            /ALLOWED_SAMESITE\s*=\s*\[\s*'lax'\s*,\s*'strict'\s*,\s*'none'\s*\]/.test(src),
            'expected ALLOWED_SAMESITE = [lax, strict, none]'
        );
        assert.ok(
            /ALLOWED_SAMESITE\.indexOf\(s\)\s*<\s*0/.test(src),
            'expected unknown sameSite values to be rejected'
        );
    });

    it('validates secure against true | false | "auto"', function () {
        assert.ok(
            /cookieConf\.secure\s*!==\s*true[\s\S]*!==\s*false[\s\S]*!==\s*'auto'/.test(src),
            'expected secure to be validated against true | false | "auto"'
        );
    });

    it('caller cookie options win over framework defaults (mergeCookie)', function () {
        assert.ok(
            /hasOwnProperty\.call\(caller,\s*'sameSite'\)/.test(src)
            && /hasOwnProperty\.call\(caller,\s*'httpOnly'\)/.test(src)
            && /hasOwnProperty\.call\(caller,\s*'secure'\)/.test(src),
            'expected merge to gate each default on hasOwnProperty'
        );
    });

    it('assertInvariant rejects SameSite=None without Secure', function () {
        assert.ok(
            /sameSite\s*===\s*'none'\s*&&\s*cookie\.secure\s*!==\s*true/.test(src),
            'expected the SameSite=None/Secure invariant check'
        );
        assert.ok(
            /invariant violation[^\n]*SameSite=None/.test(src),
            'expected a clear invariant-violation error message'
        );
    });

    it('preserves express-session static surface (Store, MemoryStore, …)', function () {
        assert.ok(
            /for\s*\(\s*var\s+k\s+in\s+expressSession\s*\)/.test(src),
            'expected static properties to be copied onto the wrapped function'
        );
    });

    it('default values are SameSite=Lax, HttpOnly=true, Secure="auto"', function () {
        assert.ok(
            /defaults\s*=\s*\{\s*sameSite:\s*'lax',\s*httpOnly:\s*true,\s*secure:\s*'auto'\s*\}/.test(src),
            'expected defaults { sameSite: lax, httpOnly: true, secure: auto }'
        );
    });

    it('rejects non-function first argument', function () {
        assert.ok(
            /typeof\s+expressSession\s*!==\s*'function'/.test(src),
            'expected a type guard on the first argument'
        );
    });

});


// ─── 02 — mergeCookie: defaults applied, caller-supplied values win ─────────

describe('02 - mergeCookie: caller options always win', function () {

    var defaults = { sameSite: 'lax', httpOnly: true, secure: 'auto' };

    it('applies all defaults when caller passes nothing', function () {
        var out = Session._mergeCookie(undefined, defaults);
        assert.equal(out.sameSite, 'lax');
        assert.equal(out.httpOnly, true);
        assert.equal(out.secure, 'auto');
    });

    it('applies defaults when caller passes an empty object', function () {
        var out = Session._mergeCookie({}, defaults);
        assert.equal(out.sameSite, 'lax');
        assert.equal(out.httpOnly, true);
        assert.equal(out.secure, 'auto');
    });

    it('caller httpOnly=false is preserved (intentional choice wins)', function () {
        var out = Session._mergeCookie({ httpOnly: false }, defaults);
        assert.equal(out.httpOnly, false, 'caller explicit false must not be overridden');
    });

    it('caller sameSite="strict" is preserved', function () {
        var out = Session._mergeCookie({ sameSite: 'strict' }, defaults);
        assert.equal(out.sameSite, 'strict');
    });

    it('caller secure=true is preserved', function () {
        var out = Session._mergeCookie({ secure: true }, defaults);
        assert.equal(out.secure, true);
    });

    it('non-cookie-flag caller keys pass through (maxAge, domain, etc.)', function () {
        var out = Session._mergeCookie({ maxAge: 86400000, domain: '.example.com' }, defaults);
        assert.equal(out.maxAge, 86400000);
        assert.equal(out.domain, '.example.com');
        assert.equal(out.sameSite, 'lax', 'defaults still fill missing flags');
        assert.equal(out.httpOnly, true);
        assert.equal(out.secure, 'auto');
    });

});


// ─── 03 — assertInvariant: SameSite=None requires Secure=true ───────────────

describe('03 - assertInvariant: browser-parity lock', function () {

    it('SameSite=None + Secure=true — allowed', function () {
        assert.doesNotThrow(function () {
            Session._assertInvariant({ sameSite: 'none', secure: true });
        });
    });

    it('SameSite=None + Secure=false — rejected', function () {
        assert.throws(function () {
            Session._assertInvariant({ sameSite: 'none', secure: false });
        }, /SameSite=None cookies require Secure=true/);
    });

    it('SameSite=None + Secure="auto" — rejected (auto ≠ guaranteed Secure)', function () {
        assert.throws(function () {
            Session._assertInvariant({ sameSite: 'none', secure: 'auto' });
        }, /SameSite=None cookies require Secure=true/);
    });

    it('SameSite=None + Secure undefined — rejected', function () {
        assert.throws(function () {
            Session._assertInvariant({ sameSite: 'none' });
        }, /SameSite=None/);
    });

    it('case-insensitive: SameSite="None" — rejected without Secure', function () {
        assert.throws(function () {
            Session._assertInvariant({ sameSite: 'None', secure: false });
        }, /SameSite=None/);
    });

    it('SameSite=Lax + Secure=false — allowed', function () {
        assert.doesNotThrow(function () {
            Session._assertInvariant({ sameSite: 'lax', secure: false });
        });
    });

    it('SameSite=Strict + Secure=false — allowed', function () {
        assert.doesNotThrow(function () {
            Session._assertInvariant({ sameSite: 'strict', secure: false });
        });
    });

});


// ─── 04 — resolveSettingsDefaults: reads settings.json > session.cookie.* ───

describe('04 - resolveSettingsDefaults: reads settings.json', function () {

    var savedGetConfig;
    beforeEach(function () { savedGetConfig = global.getConfig; });
    afterEach(function () { global.getConfig = savedGetConfig; });

    it('returns safe defaults when settings.json has no session block', function () {
        global.getConfig = function () { return { test: { dev: { content: { settings: {} } } } }; };
        var d = Session._resolveSettingsDefaults();
        assert.equal(d.sameSite, 'lax');
        assert.equal(d.httpOnly, true);
        assert.equal(d.secure, 'auto');
    });

    it('returns safe defaults when context is not ready (getContext throws)', function () {
        var savedGetContext = global.getContext;
        global.getContext = function () { throw new Error('not ready'); };
        try {
            var d = Session._resolveSettingsDefaults();
            assert.equal(d.sameSite, 'lax');
            assert.equal(d.httpOnly, true);
            assert.equal(d.secure, 'auto');
        } finally {
            global.getContext = savedGetContext;
        }
    });

    it('honours settings.json > session.cookie.sameSite="strict"', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { session: { cookie: { sameSite: 'strict' } } } } } } };
        };
        var d = Session._resolveSettingsDefaults();
        assert.equal(d.sameSite, 'strict');
    });

    it('honours settings.json > session.cookie.httpOnly=false', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { session: { cookie: { httpOnly: false } } } } } } };
        };
        var d = Session._resolveSettingsDefaults();
        assert.equal(d.httpOnly, false);
    });

    it('honours settings.json > session.cookie.secure=true', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { session: { cookie: { secure: true } } } } } } };
        };
        var d = Session._resolveSettingsDefaults();
        assert.equal(d.secure, true);
    });

    it('rejects unknown sameSite values', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { session: { cookie: { sameSite: 'always' } } } } } } };
        };
        assert.throws(function () { Session._resolveSettingsDefaults(); }, /sameSite must be one of/);
    });

    it('rejects unknown secure values', function () {
        global.getConfig = function () {
            return { test: { dev: { content: { settings: { session: { cookie: { secure: 'maybe' } } } } } } };
        };
        assert.throws(function () { Session._resolveSettingsDefaults(); }, /secure must be true, false, or "auto"/);
    });

});


// ─── 05 — Session() factory: end-to-end through a stub express-session ──────

describe('05 - Session(): end-to-end wrap', function () {

    // Minimal stub: records the options it was called with and exposes the
    // same static surface as the real express-session module.
    function makeStub() {
        function stub(options) { stub.lastOptions = options; return function mw() {}; }
        stub.lastOptions = null;
        stub.Store       = function Store() {};
        stub.MemoryStore = function MemoryStore() {};
        stub.Session     = function Session() {};
        stub.Cookie      = function Cookie() {};
        return stub;
    }

    it('rejects non-function first argument', function () {
        assert.throws(function () { Session({}); }, /expected the express-session module/);
        assert.throws(function () { Session(null); }, /expected the express-session module/);
        assert.throws(function () { Session(undefined); }, /expected the express-session module/);
    });

    it('wrapped function forwards to express-session with merged cookie', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        wrapped({ name: 'sessionid' });
        assert.deepEqual(stub.lastOptions.cookie, {
            sameSite: 'lax',
            httpOnly: true,
            secure:   'auto'
        });
        assert.equal(stub.lastOptions.name, 'sessionid');
    });

    it('wrapped function preserves caller cookie options', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        wrapped({ cookie: { httpOnly: false, maxAge: 1000 } });
        assert.equal(stub.lastOptions.cookie.httpOnly, false, 'caller httpOnly=false wins');
        assert.equal(stub.lastOptions.cookie.maxAge, 1000);
        assert.equal(stub.lastOptions.cookie.sameSite, 'lax', 'default fills missing sameSite');
        assert.equal(stub.lastOptions.cookie.secure, 'auto', 'default fills missing secure');
    });

    it('static surface (Store, MemoryStore, …) is copied onto the wrapped fn', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        assert.equal(wrapped.Store, stub.Store);
        assert.equal(wrapped.MemoryStore, stub.MemoryStore);
        assert.equal(wrapped.Session, stub.Session);
        assert.equal(wrapped.Cookie, stub.Cookie);
    });

    it('preserves expressSession.name (drop-in identity, no clobber)', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        assert.equal(wrapped.name, stub.name, 'wrapper.name must match upstream — bundles sniffing session.name === "session" should not see "ginaSession"');
    });

    it('keeps ginaSessionDispatch visible in stack traces (gina layer detectable)', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        try {
            wrapped({ cookie: { sameSite: 'none', secure: false } });
            assert.fail('expected the SameSite=None/secure=false invariant to throw');
        } catch (e) {
            assert.match(e.stack, /ginaSessionDispatch/, 'gina layer must remain visible in stack traces via the inner dispatch fn');
        }
    });

    it('invariant enforced at session() call: SameSite=None + secure=false throws', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        assert.throws(function () {
            wrapped({ cookie: { sameSite: 'none', secure: false } });
        }, /SameSite=None cookies require Secure=true/);
        assert.equal(stub.lastOptions, null, 'express-session must not have been called');
    });

    it('invariant allows SameSite=None + secure=true (cross-site cookie use case)', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        assert.doesNotThrow(function () {
            wrapped({ cookie: { sameSite: 'none', secure: true } });
        });
        assert.equal(stub.lastOptions.cookie.sameSite, 'none');
        assert.equal(stub.lastOptions.cookie.secure, true);
    });

    it('accepts options==undefined (caller passes nothing)', function () {
        var stub = makeStub();
        var wrapped = Session(stub);
        assert.doesNotThrow(function () { wrapped(); });
        assert.ok(stub.lastOptions.cookie, 'cookie block is created');
        assert.equal(stub.lastOptions.cookie.sameSite, 'lax');
    });

});


// ─── 06 — Plugin registration: plugins.Session is exported by plugins/index ─

describe('06 - plugin is registered in core/plugins/index.js', function () {

    var src;
    before(function () {
        src = fs.readFileSync(path.join(FW, 'core/plugins/index.js'), 'utf8');
    });

    it('plugins registry exports Session', function () {
        assert.ok(
            /Session\s*:\s*_require\(\s*['"]\.\/lib\/session['"]\s*\)/.test(src),
            'expected Session: _require("./lib/session") in plugins/index.js'
        );
    });

    it('#CSRF1 marker is in the plugins registry comment', function () {
        assert.ok(src.indexOf('#CSRF1') > -1, 'expected #CSRF1 marker in plugins/index.js');
    });

});


// ─── 07 — settings.json template carries the new session.cookie defaults ────

describe('07 - settings.json template advertises session.cookie defaults', function () {

    var src;
    before(function () {
        src = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');
    });

    it('template has the session.cookie block', function () {
        assert.ok(/"session"\s*:\s*\{[\s\S]*"cookie"\s*:\s*\{/.test(src),
            'expected session.cookie block in settings.json template');
    });

    it('template documents the invariant', function () {
        assert.ok(/sameSite[^\n]*"none"[^\n]*requires[^\n]*secure=true/i.test(src),
            'expected invariant documented in settings.json comments');
    });

    it('default values match the plugin defaults', function () {
        assert.ok(/"sameSite"\s*:\s*"lax"/.test(src), 'expected sameSite: "lax" default');
        assert.ok(/"httpOnly"\s*:\s*true/.test(src), 'expected httpOnly: true default');
        assert.ok(/"secure"\s*:\s*"auto"/.test(src), 'expected secure: "auto" default');
    });

});
