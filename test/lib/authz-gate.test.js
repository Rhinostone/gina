'use strict';
/**
 * lib/authz-gate — the #COMPLY1 default-on route authorization gate.
 *
 * A route opts in with `routing.json` `param.requireAuth`; core/server.js lints every
 * declared flag at BOOT and resolves the login-bounce target once onto
 * `process.gina._authConf`; core/router.js runs the gate before the DTO pipe and the
 * controller action at BOTH dispatch sites.
 *
 * Shape of this suite:
 *   §01 source pins — the two router.js call sites and, decisively, that each sits
 *       BEFORE its DTO-pipe call (401 must precede 422); the lib/index.js plain-require;
 *       the core/server.js boot lint + login-route resolve; the settings.json block.
 *   §02 no-op — a route without `param.requireAuth` is byte-identical to today, and a
 *       non-`true` flag never gates (+ a SUBTRACT proving a truthy-string gate would be
 *       silently OFF — the reason the boot lint rejects one).
 *   §03 authenticated — `req.session.user` is the contract; the action is reached.
 *   §04 unauthenticated, no bounce possible — a clean 401 (no loginRoute / XHR / no
 *       session), and never a redirect.
 *   §05 the login bounce — a forced 302 + the unconditional no-store set + the
 *       pauseRequest snapshot (+ a SUBTRACT proving redirect()'s shipped 301/gated
 *       no-store default would emit a CACHEABLE bounce: the login-loop this diverges from).
 *   §06 the boot lint — pure-logic replica of the server.js block (non-boolean flag,
 *       unknown rule name, parameterized target all refuse to boot).
 *   §07 login-route resolution — rule name -> the webroot-composed url config.js already
 *       built; absolute path verbatim.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var GATE_PATH    = path.join(FW, 'lib/authz-gate/src/main.js');
var gate         = require(GATE_PATH);

var GATE_SRC     = fs.readFileSync(GATE_PATH, 'utf8');
var ROUTER_SRC   = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var LIBIDX_SRC   = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SERVER_SRC   = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var SETTINGS_SRC = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');

/** A controller stub recording what the gate put on the wire. */
function ctl() {
    var c = { thrown: null, paused: null, pauseThrows: false };
    c.throwError   = function (errObj) { c.thrown = errObj; return false; };
    c.pauseRequest = function (data) {
        if (c.pauseThrows) { throw new Error('no requestStorage'); }
        c.paused = data;
        return {};
    };
    return c;
}
/** A response stub recording the emitted head/body. */
function res() {
    var r = { headersSent: false, code: null, head: null, body: null, ended: false };
    r.writeHead = function (code, head) { r.code = code; r.head = head; };
    r.end       = function (body) { r.body = body; r.ended = true; };
    return r;
}
/** A request shaped like the one router.js dispatches with. */
function req(opts) {
    opts = opts || {};
    var r = {
        method  : opts.method || 'GET',
        routing : { rule: opts.rule || 'account', param: opts.param || {} }
    };
    if (typeof opts.session   !== 'undefined') { r.session = opts.session; }
    if (typeof opts.isXhr     !== 'undefined') { r.isXMLRequest = opts.isXhr; }
    r[String(r.method).toLowerCase()] = opts.data || {};
    return r;
}
/** Run `fn` with `process.gina._authConf` set, restoring whatever was there. */
function withAuthConf(loginRoute, fn) {
    var had  = Object.prototype.hasOwnProperty.call(process, 'gina');
    var prev = had ? process.gina : undefined;
    process.gina = { _authConf: { loginRoute: loginRoute } };
    try { return fn(); }
    finally {
        if (had) { process.gina = prev; } else { delete process.gina; }
    }
}
/** Silence + capture the gate's access-log line. */
function captureInfo(fn) {
    var lines = [];
    var prevInfo = console.info, prevWarn = console.warn;
    console.info = function (m) { lines.push(String(m)); };
    console.warn = function () {};
    try { fn(); } finally { console.info = prevInfo; console.warn = prevWarn; }
    return lines;
}

describe('§01 — source pins: the gate is wired at both dispatch sites, before the DTO pipe', function () {

    it('01. router.js binds the plain-required gate from the lib registry', function () {
        assert.match(ROUTER_SRC, /authzGate\s*=\s*lib\.authzGate/);
    });

    it('02. router.js calls the gate exactly twice — once per dispatch site', function () {
        var calls = ROUTER_SRC.match(/authzGate\.authorizeRequest\(controller, request, response\)/g) || [];
        assert.equal(calls.length, 2, 'expected the with-middleware and no-middleware sites');
    });

    it('03. every gate call short-circuits the dispatch on a false return', function () {
        var guarded = ROUTER_SRC.match(/if \(\s*!authzGate\.authorizeRequest\(controller, request, response\) \)\s*\{\s*return;\s*\}/g) || [];
        assert.equal(guarded.length, 2);
    });

    it('04. DECISIVE — each gate call precedes its DTO-pipe call (401 before 422)', function () {
        var gateIdx = [], pipeIdx = [], m;
        var reGate = /authzGate\.authorizeRequest\(/g;
        var rePipe = /dtoPipe\.validateRequestPayload\(/g;
        while ((m = reGate.exec(ROUTER_SRC)) !== null) { gateIdx.push(m.index); }
        while ((m = rePipe.exec(ROUTER_SRC)) !== null) { pipeIdx.push(m.index); }
        assert.equal(gateIdx.length, 2);
        assert.equal(pipeIdx.length, 2);
        // Pairwise: the Nth gate call guards the Nth pipe call, and nothing sits between
        // a pipe call and the gate call that should precede it.
        assert.ok(gateIdx[0] < pipeIdx[0], 'with-middleware site: gate must precede the pipe');
        assert.ok(pipeIdx[0] < gateIdx[1], 'the first pipe call belongs to the first site');
        assert.ok(gateIdx[1] < pipeIdx[1], 'no-middleware site: gate must precede the pipe');
    });

    it('05. lib/index.js registers the gate with a PLAIN require (never _require)', function () {
        assert.match(LIBIDX_SRC, /authzGate\s*:\s*require\('\.\/authz-gate'\)/);
        assert.doesNotMatch(LIBIDX_SRC, /authzGate\s*:\s*_require\(/);
    });

    it('06. core/server.js lints the flag and resolves the login route at boot', function () {
        assert.match(SERVER_SRC, /param\.requireAuth` must be a boolean/);
        assert.match(SERVER_SRC, /process\.gina\._authConf\s*=\s*\{ loginRoute: _authzLoginRoute \}/);
    });

    it('07. the gate reads the boot-resolved conf — never a per-request config clone', function () {
        assert.match(GATE_SRC, /process\.gina\._authConf/);
        assert.doesNotMatch(GATE_SRC, /getConfig\(/);
        assert.doesNotMatch(GATE_SRC, /JSON\.clone\(/);
    });

    it('08. settings.json ships the auth block with a fail-closed null default', function () {
        var stripped = SETTINGS_SRC.split('\n').map(function (l) {
            return l.replace(/(^|\s)\/\/.*$/, '');
        }).join('\n');
        var o = JSON.parse(stripped);
        assert.ok(o.auth, 'settings.json > auth');
        assert.equal(o.auth.loginRoute, null, 'no bounce until a bundle configures one');
    });
});

describe('§02 — no-op: a route that declares nothing is untouched', function () {

    it('01. no routing / no param — continue', function () {
        assert.equal(gate.authorizeRequest(ctl(), {}, res()), true);
        assert.equal(gate.authorizeRequest(ctl(), { routing: {} }, res()), true);
    });

    it('02. a route without the flag never gates, even with no session at all', function () {
        var c = ctl(), r = res();
        assert.equal(gate.authorizeRequest(c, req({ param: { control: 'home' } }), r), true);
        assert.equal(c.thrown, null);
        assert.equal(r.code, null);
    });

    it('03. `requireAuth: false` never gates', function () {
        var c = ctl();
        assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: false } }), res()), true);
        assert.equal(c.thrown, null);
    });

    it('04. SUBTRACT — a truthy STRING flag does NOT gate (why the boot lint rejects one)', function () {
        var c = ctl();
        // The gate tests `=== true`, so a "true" string sails through. This is exactly the
        // silent-off failure the boot lint exists to make impossible: it is asserted here so
        // the two halves can never drift out of agreement.
        assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: 'true' } }), res()), true);
        assert.equal(c.thrown, null, 'a string flag is NOT enforced — the boot lint must reject it');
    });
});

describe('§03 — authenticated: `req.session.user` is the contract', function () {

    it('01. a session carrying a user reaches the action', function () {
        var c = ctl(), r = res();
        var out = gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: { user: { id: 1 } } }), r);
        assert.equal(out, true);
        assert.equal(c.thrown, null);
        assert.equal(r.code, null, 'no bounce for an authenticated caller');
    });

    it('02. the predicate is exported and reads session.user only', function () {
        assert.equal(gate.isAuthenticated({ session: { user: { id: 1 } } }), true);
        assert.equal(gate.isAuthenticated({ session: { user: null } }), false);
        assert.equal(gate.isAuthenticated({ session: {} }), false);
        assert.equal(gate.isAuthenticated({}), false);
    });

    it('03. an empty session is NOT authenticated (a session exists for every visitor)', function () {
        var c = ctl();
        withAuthConf(null, function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), res()), false);
        });
        assert.equal(c.thrown.status, 401);
    });
});

describe('§04 — unauthenticated with no bounce possible: a clean 401', function () {

    it('01. no auth.loginRoute configured -> 401, never a redirect', function () {
        var c = ctl(), r = res();
        withAuthConf(null, function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), r), false);
        });
        assert.deepEqual(c.thrown, { status: 401, error: 'Authentication required' });
        assert.equal(r.code, null);
        assert.equal(c.paused, null, 'nothing to replay — no snapshot taken');
    });

    it('02. an XHR gets the 401 even when a loginRoute IS configured', function () {
        var c = ctl(), r = res();
        withAuthConf('/login', function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {}, isXhr: true }), r), false);
        });
        assert.equal(c.thrown.status, 401);
        assert.equal(r.code, null, 'an XHR must never be handed a Location it follows transparently');
    });

    it('03. no session -> 401 (pauseRequest would 424 without one)', function () {
        var c = ctl(), r = res();
        withAuthConf('/login', function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true } }), r), false);
        });
        assert.equal(c.thrown.status, 401);
        assert.equal(c.paused, null);
        assert.equal(r.code, null);
    });

    it('04. the 401 body never discloses the gate\'s reasoning', function () {
        var c = ctl();
        withAuthConf(null, function () {
            gate.authorizeRequest(c, req({ rule: 'secret-admin-route', param: { requireAuth: true }, session: {} }), res());
        });
        assert.equal(c.thrown.error, 'Authentication required');
        assert.equal(typeof c.thrown.fields, 'undefined');
        assert.doesNotMatch(JSON.stringify(c.thrown), /secret-admin-route/);
    });

    it('05. process.gina._authConf absent entirely -> 401 (fail-closed, no crash)', function () {
        var had  = Object.prototype.hasOwnProperty.call(process, 'gina');
        var prev = had ? process.gina : undefined;
        process.gina = {};
        var c = ctl();
        try {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), res()), false);
        } finally {
            if (had) { process.gina = prev; } else { delete process.gina; }
        }
        assert.equal(c.thrown.status, 401);
    });
});

describe('§05 — the login bounce: a forced, non-cacheable 302', function () {

    function bounce(reqOpts) {
        var c = ctl(), r = res(), lines;
        withAuthConf('/login', function () {
            lines = captureInfo(function () {
                c.out = gate.authorizeRequest(c, req(reqOpts), r);
            });
        });
        return { c: c, r: r, lines: lines };
    }

    it('01. emits 302 to the configured route and short-circuits the dispatch', function () {
        var b = bounce({ param: { requireAuth: true }, session: {} });
        assert.equal(b.c.out, false);
        assert.equal(b.r.code, 302);
        assert.equal(b.r.head.location, '/login');
        assert.equal(b.r.ended, true);
        assert.equal(b.c.thrown, null, 'a bounce is not an error');
    });

    it('02. DECISIVE — 302, never redirect()\'s cacheable 301 default', function () {
        var b = bounce({ param: { requireAuth: true }, session: {} });
        assert.equal(b.r.code, 302);
        assert.notEqual(b.r.code, 301);
    });

    it('03. DECISIVE — the no-store set rides UNCONDITIONALLY (not dev-or-proxied gated)', function () {
        var b = bounce({ param: { requireAuth: true }, session: {} });
        assert.equal(b.r.head['cache-control'], 'no-cache, no-store, must-revalidate');
        assert.equal(b.r.head['pragma'], 'no-cache');
        assert.equal(b.r.head['expires'], '0');
    });

    it('04. SUBTRACT — redirect()\'s shipped default would emit a CACHEABLE bounce', function () {
        // The control: replicate redirect()'s own two decisions (controller.js — the status
        // is `req.routing.param.code || 301`, and the no-store set is folded in only when
        // `self.isCacheless() || isProxyHost`). On a direct production deployment both
        // answer "cacheable 301" — a login LOOP, since the browser replays the redirect for
        // the later, authenticated visit. This is what the gate deliberately diverges from.
        var redirectLike = function (route, isCachelessOrProxied) {
            var head = { 'location': '/login' };
            if (isCachelessOrProxied) {
                head['cache-control'] = 'no-cache, no-store, must-revalidate';
            }
            return { code: (route.param.code || 301), head: head };
        };
        var shipped = redirectLike({ param: {} }, false);
        assert.equal(shipped.code, 301, 'the trap: cacheable by default');
        assert.equal(typeof shipped.head['cache-control'], 'undefined', 'the trap: no no-store on a direct prod deployment');

        // ...and the gate's bounce is neither.
        var b = bounce({ param: { requireAuth: true }, session: {} });
        assert.equal(b.r.code, 302);
        assert.equal(b.r.head['cache-control'], 'no-cache, no-store, must-revalidate');
    });

    it('05. snapshots the request so the login action can replay it', function () {
        var b = bounce({ method: 'GET', param: { requireAuth: true }, session: {}, data: { ref: 'abc' } });
        assert.deepEqual(b.c.paused, { ref: 'abc' });
    });

    it('06. carries the {status, headers} body the inter-bundle query 3xx intercept replays', function () {
        var b = bounce({ param: { requireAuth: true }, session: {} });
        var parsed = JSON.parse(b.r.body);
        assert.equal(parsed.status, 302);
        assert.equal(parsed.headers.location, '/login');
    });

    it('07. logs the emitted Location (how a bounce is verified from pod logs)', function () {
        var b = bounce({ method: 'GET', param: { requireAuth: true }, session: {} });
        assert.ok(b.lines.some(function (l) { return l.indexOf('[302] /login') > -1; }), b.lines.join('|'));
    });

    it('08. a failed snapshot degrades to the bounce — never a 500', function () {
        var c = ctl(), r = res();
        c.pauseThrows = true;
        withAuthConf('/login', function () {
            captureInfo(function () {
                c.out = gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), r);
            });
        });
        assert.equal(c.out, false);
        assert.equal(r.code, 302, 'the user still gets to log in');
        assert.equal(c.thrown, null);
    });

    it('09. never double-sends when something already answered', function () {
        var c = ctl(), r = res();
        r.headersSent = true;
        withAuthConf('/login', function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), r), false);
        });
        assert.equal(r.code, null);
        assert.equal(r.ended, false);
    });
});

describe('§06 — the boot lint (pure-logic replica of the core/server.js block)', function () {

    // Mirrors the shipped block; §01/06 pins lock it against drift.
    function lint(routing) {
        var count = 0;
        for (var rule in routing) {
            var route = routing[rule];
            if (typeof route != 'object' || route === null || !route.param) { continue; }
            if (typeof route.param.requireAuth == 'undefined') { continue; }
            if (typeof route.param.requireAuth != 'boolean') {
                throw new Error('Route `' + rule + '`: `param.requireAuth` must be a boolean (got `' + typeof route.param.requireAuth + '`).');
            }
            if (route.param.requireAuth === true) { ++count; }
        }
        return count;
    }

    it('01. counts only the gated routes', function () {
        assert.equal(lint({
            home:    { param: { control: 'home' } },
            account: { param: { requireAuth: true } },
            login:   { param: { requireAuth: false } },
            admin:   { param: { requireAuth: true } }
        }), 2);
    });

    it('02. a truthy STRING flag refuses to boot (the §02.04 silent-off case)', function () {
        assert.throws(function () { lint({ a: { param: { requireAuth: 'true' } } }); }, /must be a boolean/);
    });

    it('03. a number / object flag refuses to boot', function () {
        assert.throws(function () { lint({ a: { param: { requireAuth: 1 } } }); }, /must be a boolean/);
        assert.throws(function () { lint({ a: { param: { requireAuth: {} } } }); }, /must be a boolean/);
    });

    it('04. a param-less or non-object route is skipped, never a crash', function () {
        assert.equal(lint({ a: {}, b: null, c: 'nope', d: { param: {} } }), 0);
    });
});

describe('§07 — login-route resolution (pure-logic replica of the core/server.js block)', function () {

    // Mirrors the shipped block. NOTE `routing[rule].url` is already webroot-composed by
    // core/config.js at normalisation — so a rule name needs no composition here, which is
    // exactly why it is the recommended form.
    function resolve(loginRoute, routing) {
        if (typeof loginRoute == 'undefined' || loginRoute === null || loginRoute === '') { return null; }
        if (typeof loginRoute != 'string') { throw new Error('`auth.loginRoute` must be a string'); }
        var p = loginRoute;
        if (p.charAt(0) !== '/') {
            var target = routing[p];
            if (!target) { throw new Error('`auth.loginRoute` names route `' + p + '`, which this bundle does not declare.'); }
            if (typeof target.url != 'string') { throw new Error('`auth.loginRoute` names route `' + p + '`, which does not resolve to a single url.'); }
            p = target.url;
        }
        if (/\:/.test(p)) { throw new Error('`auth.loginRoute` resolves to `' + p + '`, which is parameterized.'); }
        return p;
    }

    var ROUTING = {
        login:      { url: '/admin/login' },   // config.js already prefixed the webroot
        multi:      { url: ['/a', '/b'] },
        paramd:     { url: '/login/:token' }
    };

    it('01. null / absent -> no bounce configured', function () {
        assert.equal(resolve(null, ROUTING), null);
        assert.equal(resolve(undefined, ROUTING), null);
        assert.equal(resolve('', ROUTING), null);
    });

    it('02. a rule name resolves to the webroot-composed url config.js built', function () {
        assert.equal(resolve('login', ROUTING), '/admin/login');
    });

    it('03. an absolute path is used verbatim', function () {
        assert.equal(resolve('/login', ROUTING), '/login');
        assert.equal(resolve('/admin/sign-in', ROUTING), '/admin/sign-in');
    });

    it('04. an unknown rule name refuses to boot (a typo is not a silent no-bounce)', function () {
        assert.throws(function () { resolve('lgoin', ROUTING); }, /this bundle does not declare/);
    });

    it('05. a multi-url route refuses to boot', function () {
        assert.throws(function () { resolve('multi', ROUTING); }, /single url/);
    });

    it('06. a parameterized target refuses to boot', function () {
        assert.throws(function () { resolve('paramd', ROUTING); }, /parameterized/);
        assert.throws(function () { resolve('/login/:token', ROUTING); }, /parameterized/);
    });

    it('07. a non-string refuses to boot', function () {
        assert.throws(function () { resolve(42, ROUTING); }, /must be a string/);
    });
});
