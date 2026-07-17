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
 *   §08 roles (slice 2) — ANY-of match, roles IMPLY authentication (401 before 403),
 *       the deliberately GENERIC 403 (+ a SUBTRACT proving a non-array `roles` would be
 *       silently OFF — the reason the boot lint rejects one).
 *   §09 the slice-2 boot lint — pure-logic replica of the FULL post-slice-2 server.js
 *       block (requireAuth + roles axes together; §06 keeps the slice-1 cases); every
 *       invalid DECLARED `roles` shape refuses to boot.
 *   §10 the client-blob strip — the boot-built client routing maps ship no
 *       authorization keys (source pins incl. the strip-before-#B66-derivation
 *       ordering, + a replica proving only the three keys are dropped).
 *   §11 the policy escape hatch (slice 3) — AND-composed AFTER roles; allow iff the
 *       policy returns a literal `true` (+ a SUBTRACT proving a truthy-allow gate
 *       would ALLOW an async policy that DENIED — the fail-OPEN the strictness
 *       closes); a throw / a non-boolean / an unregistered name all deny fail-closed;
 *       the 403 never echoes the policy name.
 *   §12 the policy registrar (slice 3) — `registerPolicy` against real files: a plain
 *       function registers, a missing file / non-function export is unresolved, an
 *       `async function` REFUSES the boot (+ the measurement showing a
 *       promise-returning plain function is boot-INVISIBLE, which is exactly why §11's
 *       allow test must be strict); + a pure-logic replica of the server.js lint.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW = require('../fw');

var GATE_PATH    = path.join(FW, 'lib/authz-gate/src/main.js');
var gate         = require(GATE_PATH);

var GATE_SRC     = fs.readFileSync(GATE_PATH, 'utf8');
var ROUTER_SRC   = fs.readFileSync(path.join(FW, 'core/router.js'), 'utf8');
var LIBIDX_SRC   = fs.readFileSync(path.join(FW, 'lib/index.js'), 'utf8');
var SERVER_SRC   = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var SETTINGS_SRC = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');
var ISAAC_SRC    = fs.readFileSync(path.join(FW, 'core/server.isaac.js'), 'utf8');

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
/** Silence + capture the gate's server-side denial detail (console.debug). */
function captureDebug(fn) {
    var lines = [];
    var prevDebug = console.debug;
    console.debug = function (m) { lines.push(String(m)); };
    try { fn(); } finally { console.debug = prevDebug; }
    return lines;
}
/** Run `fn` with a boot-registered policy map, restoring whatever was there. */
function withPolicies(map, fn) {
    var had  = Object.prototype.hasOwnProperty.call(process, 'gina');
    var prev = had ? process.gina : undefined;
    process.gina = { _policies: map };
    try { return fn(); }
    finally {
        if (had) { process.gina = prev; } else { delete process.gina; }
    }
}
/** Silence + capture the gate's policy-contract warning (console.warn). */
function captureWarn(fn) {
    var lines = [];
    var prevWarn = console.warn, prevDebug = console.debug;
    console.warn  = function (m) { lines.push(String(m)); };
    console.debug = function () {};
    try { fn(); } finally { console.warn = prevWarn; console.debug = prevDebug; }
    return lines;
}
/** Silence + capture the gate's policy-threw log (console.error). */
function captureError(fn) {
    var lines = [];
    var prevErr = console.error, prevDebug = console.debug;
    console.error = function (m) { lines.push(String(m)); };
    console.debug = function () {};
    try { fn(); } finally { console.error = prevErr; console.debug = prevDebug; }
    return lines;
}
/** Build a throwaway bundle src dir carrying `policies/<name>.js` files. */
function withPolicyFiles(files, fn) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-authz-policies-'));
    fs.mkdirSync(path.join(dir, 'policies'));
    Object.keys(files).forEach(function (name) {
        fs.writeFileSync(path.join(dir, 'policies', name + '.js'), files[name], 'utf8');
    });
    try { return fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

describe('§08 — roles (slice 2): ANY-of match, implied authentication, generic 403', function () {

    it('01. source pin — the gate authenticates BEFORE it matches roles (401 precedes 403)', function () {
        var authIdx  = GATE_SRC.indexOf('!isAuthenticated(req)');
        var rolesIdx = GATE_SRC.indexOf('hasAnyRole(req.session.user, param.roles)');
        assert.ok(authIdx > -1, 'the authN check');
        assert.ok(rolesIdx > -1, 'the roles check');
        assert.ok(authIdx < rolesIdx,
            'authN must run first: an unauthenticated caller must never learn the route is role-restricted');
    });

    it('02. source pin — roles IMPLY requireAuth via the non-empty-array derivation', function () {
        assert.match(GATE_SRC, /Array\.isArray\(param\.roles\) && param\.roles\.length > 0/);
    });

    it('03. a role-gated route WITHOUT requireAuth still authenticates first (roles imply auth)', function () {
        var c = ctl();
        withAuthConf(null, function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { roles: ['admin'] }, session: {} }), res()), false);
        });
        assert.equal(c.thrown.status, 401, 'unauthenticated -> 401, never a 403');
    });

    it('04. ANY-of: holding one of the required roles reaches the action', function () {
        var c = ctl(), r = res();
        var out = gate.authorizeRequest(c, req({
            param   : { roles: ['admin', 'editor'] },
            session : { user: { id: 7, roles: ['editor'] } }
        }), r);
        assert.equal(out, true);
        assert.equal(c.thrown, null);
        assert.equal(r.code, null);
    });

    it('05. holding none of the required roles -> a generic 403', function () {
        var c = ctl(), out;
        captureDebug(function () {
            out = gate.authorizeRequest(c, req({
                param   : { roles: ['admin'] },
                session : { user: { id: 7, roles: ['viewer'] } }
            }), res());
        });
        assert.equal(out, false);
        assert.deepEqual(c.thrown, { status: 403, error: 'Forbidden' });
    });

    it('06. absent / non-array / empty user.roles means NO roles -> 403', function () {
        [ { id: 1 },                       // no roles at all
          { id: 1, roles: 'admin' },       // a bare string is NOT a role list
          { id: 1, roles: { admin: 1 } },  // nor an object
          { id: 1, roles: [] }             // nor an empty list
        ].forEach(function (user) {
            var c = ctl();
            captureDebug(function () {
                assert.equal(gate.authorizeRequest(c, req({ param: { roles: ['admin'] }, session: { user: user } }), res()), false);
            });
            assert.equal(c.thrown.status, 403, JSON.stringify(user));
        });
    });

    it('07. requireAuth + roles compose: authenticated but role-less is a 403, never a 401', function () {
        var c = ctl();
        captureDebug(function () {
            assert.equal(gate.authorizeRequest(c, req({
                param   : { requireAuth: true, roles: ['admin'] },
                session : { user: { id: 7 } }
            }), res()), false);
        });
        assert.equal(c.thrown.status, 403);
    });

    it('08. DECISIVE — the 403 body never echoes the required roles, the user\'s roles or the rule', function () {
        var c = ctl();
        captureDebug(function () {
            gate.authorizeRequest(c, req({
                rule    : 'secret-admin-panel',
                param   : { roles: ['operators-tier-1', 'operators-tier-2'] },
                session : { user: { id: 7, roles: ['plain-user-role'] } }
            }), res());
        });
        var wire = JSON.stringify(c.thrown);
        assert.equal(c.thrown.error, 'Forbidden');
        assert.doesNotMatch(wire, /operators-tier/, 'the required roles must never reach the wire');
        assert.doesNotMatch(wire, /plain-user-role/, 'the user\'s roles must never reach the wire');
        assert.doesNotMatch(wire, /secret-admin-panel/, 'the rule name must never reach the wire');
        assert.equal(typeof c.thrown.fields, 'undefined');
    });

    it('09. ...but the denial IS observable server-side (the debug line names the rule)', function () {
        var c = ctl(), lines;
        lines = captureDebug(function () {
            gate.authorizeRequest(c, req({
                rule    : 'admin-panel',
                param   : { roles: ['admin'] },
                session : { user: { id: 7, roles: ['viewer'] } }
            }), res());
        });
        assert.ok(lines.some(function (l) { return l.indexOf('admin-panel') > -1; }), lines.join('|'));
    });

    it('10. an empty declared roles array does NOT gate (the boot lint refuses it — it must never HALF-gate)', function () {
        var c = ctl();
        assert.equal(gate.authorizeRequest(c, req({ param: { roles: [] } }), res()), true);
        assert.equal(c.thrown, null);
    });

    it('11. SUBTRACT — a non-array roles (a bare string) does NOT gate: the silent-off case the lint exists for', function () {
        var c = ctl();
        assert.equal(gate.authorizeRequest(c, req({ param: { roles: 'admin' } }), res()), true);
        assert.equal(c.thrown, null, 'a string roles is NOT enforced — the boot lint must reject it');
    });

    it('12. an authenticated, role-matched user passes the composed requireAuth + roles gate', function () {
        var c = ctl(), r = res();
        assert.equal(gate.authorizeRequest(c, req({
            param   : { requireAuth: true, roles: ['admin', 'editor'] },
            session : { user: { id: 7, roles: ['ops', 'admin'] } }
        }), r), true);
        assert.equal(c.thrown, null);
        assert.equal(r.code, null);
    });
});

describe('§09 — the slice-2 boot lint (pure-logic replica of the FULL core/server.js block)', function () {

    // Mirrors the post-slice-2 shipped block — the requireAuth AND roles axes together
    // (§06 keeps the slice-1 requireAuth-axis cases; its assertions still hold, this is
    // the full-block mirror). §01.06 + §09.01 pins lock the source against drift.
    function lint(routing) {
        var count = 0, rolesCount = 0;
        for (var rule in routing) {
            var route = routing[rule];
            if (typeof route != 'object' || route === null || !route.param) { continue; }
            var gated = false;
            if (typeof route.param.requireAuth != 'undefined') {
                if (typeof route.param.requireAuth != 'boolean') {
                    throw new Error('Route `' + rule + '`: `param.requireAuth` must be a boolean (got `' + typeof route.param.requireAuth + '`).');
                }
                if (route.param.requireAuth === true) { gated = true; }
            }
            if (typeof route.param.roles != 'undefined') {
                var roles = route.param.roles;
                if (!Array.isArray(roles) || roles.length === 0) {
                    throw new Error('Route `' + rule + '`: `param.roles` must be a non-empty array of role names.');
                }
                for (var i = 0; i < roles.length; ++i) {
                    if (typeof roles[i] != 'string' || roles[i] === '') {
                        throw new Error('Route `' + rule + '`: `param.roles` must contain only non-empty strings.');
                    }
                }
                gated = true;
                ++rolesCount;
            }
            if (gated) { ++count; }
        }
        return { count: count, rolesCount: rolesCount };
    }

    it('01. source pin — the shipped block lints the roles shape', function () {
        assert.match(SERVER_SRC, /param\.roles` must be a non-empty array of role names/);
        assert.match(SERVER_SRC, /param\.roles` must contain only non-empty strings/);
    });

    it('02. a valid roles array gates the route even without requireAuth', function () {
        assert.deepEqual(lint({ a: { param: { roles: ['admin'] } } }), { count: 1, rolesCount: 1 });
    });

    it('03. roles + requireAuth on one route counts ONCE', function () {
        assert.deepEqual(lint({ a: { param: { requireAuth: true, roles: ['admin'] } } }), { count: 1, rolesCount: 1 });
    });

    it('04. `roles: null` refuses to boot (typeof null is object — it would be silently ungated)', function () {
        assert.throws(function () { lint({ a: { param: { roles: null } } }); }, /non-empty array/);
    });

    it('05. a bare-string roles refuses to boot', function () {
        assert.throws(function () { lint({ a: { param: { roles: 'admin' } } }); }, /non-empty array/);
    });

    it('06. an empty roles array refuses to boot', function () {
        assert.throws(function () { lint({ a: { param: { roles: [] } } }); }, /non-empty array/);
    });

    it('07. a non-string member refuses to boot', function () {
        assert.throws(function () { lint({ a: { param: { roles: ['admin', 42] } } }); }, /non-empty strings/);
    });

    it('08. an empty-string member refuses to boot', function () {
        assert.throws(function () { lint({ a: { param: { roles: ['admin', ''] } } }); }, /non-empty strings/);
    });

    it('09. the requireAuth axis is unchanged (§06 parity against the restructured block)', function () {
        assert.deepEqual(lint({
            home:    { param: { control: 'home' } },
            account: { param: { requireAuth: true } },
            login:   { param: { requireAuth: false } },
            admin:   { param: { requireAuth: true } }
        }), { count: 2, rolesCount: 0 });
        assert.throws(function () { lint({ a: { param: { requireAuth: 'true' } } }); }, /must be a boolean/);
        assert.equal(lint({ a: {}, b: null, c: 'nope', d: { param: {} } }).count, 0);
    });
});

describe('§10 — the client-served routing blob strips the authorization keys (server.isaac.js)', function () {

    // Verbatim-lifted from the server.isaac.js full-blob loop body.
    function stripLikeIsaac(route) {
        const { _comment, middleware, ...clean } = route;
        if ( clean.param && typeof(clean.param) == 'object' ) {
            const { requireAuth, roles, policy, ...cleanParam } = clean.param;
            clean.param = cleanParam;
        }
        return clean;
    }

    it('01. source pin — the boot-built blob rebuilds param without requireAuth/roles/policy', function () {
        assert.match(ISAAC_SRC, /const \{ requireAuth, roles, policy, \.\.\.cleanParam \} = clean\.param;/);
        assert.match(ISAAC_SRC, /clean\.param = cleanParam;/);
    });

    it('02. DECISIVE — the strip runs BEFORE the #B66 stripped variant is derived, so BOTH client blobs inherit it', function () {
        var stripIdx   = ISAAC_SRC.indexOf('const { requireAuth, roles, policy, ...cleanParam } = clean.param;');
        var derivedIdx = ISAAC_SRC.indexOf('var _routingStripped = JSON.clone(_routing);');
        assert.ok(stripIdx > -1, 'the strip');
        assert.ok(derivedIdx > -1, 'the #B66 host-stripped derivation');
        assert.ok(stripIdx < derivedIdx,
            'stripping after the derivation would leave the proxied-client blob carrying the keys');
    });

    it('03. replica — only the three authorization keys are dropped; the client contract survives', function () {
        var served = stripLikeIsaac({
            method    : 'GET',
            url       : '/web/admin',
            webroot   : '/web/',
            middleware: ['x'],
            _comment  : 'internal',
            param     : { control: 'panel', file: 'admin', path: '/x', requireAuth: true, roles: ['admin'], policy: 'isOwner' }
        });
        assert.equal(typeof served.param.requireAuth, 'undefined');
        assert.equal(typeof served.param.roles, 'undefined');
        assert.equal(typeof served.param.policy, 'undefined');
        // The keys the client-side matcher / toUrl actually read all survive:
        assert.equal(served.param.control, 'panel');
        assert.equal(served.param.file, 'admin');
        assert.equal(served.param.path, '/x');
        assert.equal(served.url, '/web/admin');
        assert.equal(served.webroot, '/web/', 'webroot is load-bearing for the client toUrl path (#B66)');
        // ...and the pre-existing strips still hold:
        assert.equal(typeof served.middleware, 'undefined');
        assert.equal(typeof served._comment, 'undefined');
    });

    it('04. a param-less route flows through the strip untouched (guarded)', function () {
        var served = stripLikeIsaac({ method: 'GET', url: '/x' });
        assert.equal(served.url, '/x');
        assert.equal(typeof served.param, 'undefined');
    });
});

describe('§11 — the policy escape hatch (slice 3): AND-composed after roles, allow iff `=== true`', function () {

    /** A policy-gated request with `<name>` registered as `fn`. */
    function runWith(name, fn, opts, capture) {
        var c = ctl(), out;
        opts = opts || {};
        withPolicies(fn ? (function () { var m = {}; m[name] = fn; return m; })() : {}, function () {
            (capture || captureDebug)(function () {
                out = gate.authorizeRequest(c, req({
                    rule    : opts.rule || 'invoice-edit',
                    param   : opts.param || { policy: name },
                    session : ('session' in opts) ? opts.session : { user: { id: 7, roles: ['editor'] } }
                }), res());
            });
        });
        return { out: out, ctl: c };
    }

    it('01. DECISIVE (can-fail validated) — the roles check precedes the policy run', function () {
        var rolesIdx  = GATE_SRC.indexOf('hasAnyRole(req.session.user, param.roles)');
        var policyIdx = GATE_SRC.indexOf('runPolicy(controller, req, param.policy, req.session.user)');
        assert.ok(rolesIdx > -1, 'the roles check');
        assert.ok(policyIdx > -1, 'the policy run');
        assert.ok(rolesIdx < policyIdx, 'roles must be matched before the policy runs (authN -> roles -> policy)');

        // The pin reads the ORDER, so a source with the two swapped must flip it.
        var perturbed = GATE_SRC
            .replace('hasAnyRole(req.session.user, param.roles)', '__ROLES_MOVED__')
            .replace('runPolicy(controller, req, param.policy, req.session.user)', 'hasAnyRole(req.session.user, param.roles)')
            .replace('__ROLES_MOVED__', 'runPolicy(controller, req, param.policy, req.session.user)');
        assert.notEqual(perturbed, GATE_SRC, 'the perturbation must actually change the source');
        assert.ok(
            perturbed.indexOf('hasAnyRole(req.session.user, param.roles)') > perturbed.indexOf('runPolicy(controller, req, param.policy, req.session.user)'),
            'CONTROL: the pin must FAIL on a swapped source — otherwise it reads nothing'
        );
    });

    it('02. source pin — the gate authenticates BEFORE it runs the policy (401 precedes 403)', function () {
        var authIdx   = GATE_SRC.indexOf('!isAuthenticated(req)');
        var policyIdx = GATE_SRC.indexOf('runPolicy(controller, req, param.policy, req.session.user)');
        assert.ok(authIdx > -1 && policyIdx > -1);
        assert.ok(authIdx < policyIdx,
            'authN must run first: an unauthenticated caller must never learn the route is policy-restricted');
    });

    it('03. source pin — policy IMPLIES requireAuth via the non-empty-string derivation', function () {
        assert.match(GATE_SRC, /typeof\(param\.policy\) == 'string' && param\.policy !== ''/);
    });

    it('04. a policy-gated route WITHOUT requireAuth still authenticates first (policy implies auth)', function () {
        var c = ctl();
        withAuthConf(null, function () {
            assert.equal(gate.authorizeRequest(c, req({ param: { policy: 'ownsInvoice' }, session: {} }), res()), false);
        });
        assert.equal(c.thrown.status, 401, 'unauthenticated -> 401, never a 403');
    });

    it('05. a policy returning true reaches the action', function () {
        var r = runWith('ownsInvoice', function () { return true; });
        assert.equal(r.out, true);
        assert.equal(r.ctl.thrown, null);
    });

    it('06. a policy returning false -> a generic 403', function () {
        var r = runWith('ownsInvoice', function () { return false; });
        assert.equal(r.out, false);
        assert.deepEqual(r.ctl.thrown, { status: 403, error: 'Forbidden' });
    });

    it('07. the policy receives (user, req) — the record check\'s whole input', function () {
        var seen = null;
        var r = runWith('ownsInvoice', function (user, request) {
            seen = { user: user, rule: request.routing.rule };
            return user.id === 7;
        });
        assert.equal(r.out, true);
        assert.equal(seen.user.id, 7, 'arg 1 is req.session.user');
        assert.equal(seen.rule, 'invoice-edit', 'arg 2 is the request');
    });

    it('08. DECISIVE — allow is strictly `=== true`: a TRUTHY non-true return DENIES', function () {
        [ 1, 'yes', {}, [] ].forEach(function (truthy) {
            var r = runWith('truthy-' + typeof truthy + Math.random(), function () { return truthy; }, null, captureWarn);
            assert.equal(r.out, false, JSON.stringify(truthy) + ' is truthy but not `true` — it must DENY');
            assert.equal(r.ctl.thrown.status, 403);
        });
    });

    it('09. DECISIVE — a PROMISE return denies (the transpiled-async shape the boot refusal cannot see)', function () {
        var r = runWith('asyncish-1', function () { return Promise.resolve(true); }, null, captureWarn);
        assert.equal(r.out, false, 'a promise is truthy — a truthy-allow gate would have ALLOWED it');
        assert.equal(r.ctl.thrown.status, 403);
    });

    it('10. SUBTRACT — a truthy-allow gate ALLOWS an async policy that DENIED: the fail-OPEN this closes', function () {
        // The shipped allow rule, and the one-token perturbation of it:
        var shipped   = function (allowed) { return allowed === true; };
        var perturbed = function (allowed) { return !!allowed; };
        // An async policy whose answer is NO. Its promise is truthy regardless of the answer.
        var deniedByAnAsyncPolicy = Promise.resolve(false);

        assert.equal(shipped(deniedByAnAsyncPolicy), false, 'the shipped strict test denies it');
        assert.equal(perturbed(deniedByAnAsyncPolicy), true,
            'CONTROL: a truthy-allow gate ALLOWS a request the policy explicitly DENIED — fail-open');
        // ...and the perturbation is not vacuous: it agrees with the shipped rule on a real boolean.
        assert.equal(shipped(true),  perturbed(true));
        assert.equal(shipped(false), perturbed(false));
    });

    it('11. a non-boolean return warns ONCE, naming the policy and the contract', function () {
        var lines = captureWarn(function () {
            withPolicies({ 'warnee-a': function () { return Promise.resolve(true); } }, function () {
                gate.authorizeRequest(ctl(), req({ param: { policy: 'warnee-a' }, session: { user: { id: 7 } } }), res());
            });
        });
        assert.equal(lines.length, 1, lines.join('|'));
        assert.match(lines[0], /warnee-a/, 'the warning names the offending policy');
        assert.match(lines[0], /a promise/, 'and the shape it wrongly returned');
        assert.match(lines[0], /fail-closed/i);
    });

    it('12. ...and only once: a second request through the same policy does not re-warn', function () {
        var policy = function () { return 'nope'; };
        captureWarn(function () {
            withPolicies({ 'warnee-b': policy }, function () {
                gate.authorizeRequest(ctl(), req({ param: { policy: 'warnee-b' }, session: { user: { id: 7 } } }), res());
            });
        });
        var second = captureWarn(function () {
            withPolicies({ 'warnee-b': policy }, function () {
                gate.authorizeRequest(ctl(), req({ param: { policy: 'warnee-b' }, session: { user: { id: 7 } } }), res());
            });
        });
        assert.equal(second.length, 0, 'a per-request warning would bury the message it exists to surface');
    });

    it('13. a THROWING policy denies 403 — it never propagates (a policy bug must not 500 the wire)', function () {
        var r;
        assert.doesNotThrow(function () {
            r = runWith('boom', function () { throw new Error('db is down'); }, null, captureError);
        });
        assert.equal(r.out, false);
        assert.deepEqual(r.ctl.thrown, { status: 403, error: 'Forbidden' });
    });

    it('14. ...and the throw IS observable server-side', function () {
        var lines = captureError(function () {
            withPolicies({ 'boom-2': function () { throw new Error('db is down'); } }, function () {
                gate.authorizeRequest(ctl(), req({ rule: 'invoice-edit', param: { policy: 'boom-2' }, session: { user: { id: 7 } } }), res());
            });
        });
        assert.ok(lines.some(function (l) { return l.indexOf('boom-2') > -1 && l.indexOf('db is down') > -1; }), lines.join('|'));
    });

    it('15. an UNREGISTERED policy denies fail-closed (a gate that cannot find its policy must never allow)', function () {
        var r = runWith('never-registered', null);
        assert.equal(r.out, false);
        assert.equal(r.ctl.thrown.status, 403);
    });

    it('16. DECISIVE — the 403 body never echoes the policy name or the rule', function () {
        var r = runWith('ownsSecretLedger', function () { return false; }, { rule: 'secret-ledger-edit', param: { policy: 'ownsSecretLedger' } });
        var wire = JSON.stringify(r.ctl.thrown);
        assert.equal(r.ctl.thrown.error, 'Forbidden');
        assert.doesNotMatch(wire, /ownsSecretLedger/, 'the policy name must never reach the wire');
        assert.doesNotMatch(wire, /secret-ledger-edit/, 'the rule name must never reach the wire');
    });

    it('17. ...but the denial IS observable server-side (the debug line names the rule and the policy)', function () {
        var lines = captureDebug(function () {
            withPolicies({ 'ownsInvoice': function () { return false; } }, function () {
                gate.authorizeRequest(ctl(), req({ rule: 'invoice-edit', param: { policy: 'ownsInvoice' }, session: { user: { id: 7 } } }), res());
            });
        });
        assert.ok(lines.some(function (l) { return l.indexOf('invoice-edit') > -1 && l.indexOf('ownsInvoice') > -1; }), lines.join('|'));
    });

    it('18. roles AND policy compose: roles pass, policy denies -> 403', function () {
        var r = runWith('ownsInvoice', function () { return false; }, {
            param   : { roles: ['editor'], policy: 'ownsInvoice' },
            session : { user: { id: 7, roles: ['editor'] } }
        });
        assert.equal(r.out, false);
        assert.equal(r.ctl.thrown.status, 403);
    });

    it('19. roles AND policy compose: roles pass, policy allows -> the action', function () {
        var r = runWith('ownsInvoice', function (user) { return user.id === 7; }, {
            param   : { roles: ['editor'], policy: 'ownsInvoice' },
            session : { user: { id: 7, roles: ['editor'] } }
        });
        assert.equal(r.out, true);
        assert.equal(r.ctl.thrown, null);
    });

    it('20. roles short-circuit the policy: a role denial never runs it', function () {
        var ran = false;
        var r = runWith('ownsInvoice', function () { ran = true; return true; }, {
            param   : { roles: ['admin'], policy: 'ownsInvoice' },
            session : { user: { id: 7, roles: ['viewer'] } }
        });
        assert.equal(r.out, false);
        assert.equal(r.ctl.thrown.status, 403);
        assert.equal(ran, false, 'a role-denied request must not reach the policy at all');
    });

    it('21. an empty-string policy does NOT gate (the boot lint refuses it — it must never HALF-gate)', function () {
        var c = ctl();
        assert.equal(gate.authorizeRequest(c, req({ param: { policy: '' } }), res()), true);
        assert.equal(c.thrown, null);
    });

    it('22. SUBTRACT — a non-string policy does NOT gate: the silent-off case the lint exists for', function () {
        [ 42, true, {}, ['ownsInvoice'] ].forEach(function (bad) {
            var c = ctl();
            assert.equal(gate.authorizeRequest(c, req({ param: { policy: bad } }), res()), true, JSON.stringify(bad));
            assert.equal(c.thrown, null, 'a non-string policy is NOT enforced — the boot lint must reject it');
        });
    });
});

describe('§12 — the policy registrar (slice 3): registerPolicy + the boot lint', function () {

    it('01. source pin — the shipped block registers every declared policy at boot', function () {
        assert.match(SERVER_SRC, /lib\.authzGate\.registerPolicy\(_authzSrcPath, _authzPolicy\)/);
    });

    it('02. source pin — the shipped block lints the policy string shape and refuses a missing module', function () {
        assert.match(SERVER_SRC, /param\.policy` must be a non-empty string/);
        assert.match(SERVER_SRC, /is missing \(or does not export a function\)/);
    });

    it('03. source pin — registerPolicy refuses an AsyncFunction by constructor name', function () {
        assert.match(GATE_SRC, /fn\.constructor && fn\.constructor\.name === 'AsyncFunction'/);
    });

    it('04. a plain function registers and lands on process.gina._policies', function () {
        withPolicyFiles({ ownsInvoice: 'module.exports = function (user, req) { return user.id === 7; };' }, function (dir) {
            withPolicies({}, function () {
                var fn = gate.registerPolicy(dir, 'ownsInvoice');
                assert.equal(typeof fn, 'function');
                assert.equal(process.gina._policies.ownsInvoice, fn, 'registered for the O(1) request-path lookup');
                assert.equal(fn({ id: 7 }, {}), true, 'and it is the real module');
            });
        });
    });

    it('05. the registered policy is what the gate then runs end-to-end', function () {
        withPolicyFiles({ ownsIt: 'module.exports = function (user, req) { return user.id === req.routing.param.id; };' }, function (dir) {
            withPolicies({}, function () {
                gate.registerPolicy(dir, 'ownsIt');
                var c = ctl();
                assert.equal(gate.authorizeRequest(c, req({
                    param   : { policy: 'ownsIt', id: 7 },
                    session : { user: { id: 7 } }
                }), res()), true);
                assert.equal(c.thrown, null);
            });
        });
    });

    it('06. a missing file is unresolved (null) — the caller refuses the boot', function () {
        withPolicyFiles({}, function (dir) {
            withPolicies({}, function () {
                assert.equal(gate.registerPolicy(dir, 'nope'), null);
            });
        });
    });

    it('07. a module exporting a non-function is unresolved (null)', function () {
        withPolicyFiles({ notAFn: 'module.exports = { allow: true };' }, function (dir) {
            withPolicies({}, function () {
                assert.equal(gate.registerPolicy(dir, 'notAFn'), null);
            });
        });
    });

    it('08. DECISIVE — an `async function` policy REFUSES to boot', function () {
        withPolicyFiles({ asyncPolicy: 'module.exports = async function (user, req) { return true; };' }, function (dir) {
            withPolicies({}, function () {
                assert.throws(function () { gate.registerPolicy(dir, 'asyncPolicy'); }, /async function/);
                assert.equal(typeof process.gina._policies.asyncPolicy, 'undefined', 'and it is never registered');
            });
        });
    });

    it('09. ...because `typeof` cannot see it — only the constructor name can (the boot-visible tell)', function () {
        withPolicyFiles({
            asyncP: 'module.exports = async function (user, req) { return true; };',
            plainP: 'module.exports = function (user, req) { return true; };'
        }, function (dir) {
            var asyncFn = require(path.join(dir, 'policies', 'asyncP.js'));
            var plainFn = require(path.join(dir, 'policies', 'plainP.js'));
            assert.equal(typeof asyncFn, typeof plainFn, 'CONTROL: typeof reads `function` for BOTH — it cannot discriminate');
            assert.equal(asyncFn.constructor.name, 'AsyncFunction');
            assert.equal(plainFn.constructor.name, 'Function');
        });
    });

    it('10. DECISIVE — a promise-RETURNING plain function is boot-INVISIBLE: why §11\'s allow test must be strict', function () {
        withPolicyFiles({ transpiled: 'module.exports = function (user, req) { return Promise.resolve(true); };' }, function (dir) {
            withPolicies({}, function () {
                // The registrar CANNOT refuse it — it is a plain Function by every boot-visible measure.
                var fn = gate.registerPolicy(dir, 'transpiled');
                assert.equal(typeof fn, 'function');
                assert.equal(fn.constructor.name, 'Function', 'the transpiled-async shape reads as an ordinary function');
                // So the ONLY thing standing between it and a fail-open is the gate's `=== true`.
                assert.notEqual(fn({}, {}), true, 'its return is truthy but never `true` -> the strict gate denies it');
            });
        });
    });

    it('11. a broken module propagates its throw (the caller wraps it with route context)', function () {
        withPolicyFiles({ broken: 'throw new Error("syntax-ish boom");' }, function (dir) {
            withPolicies({}, function () {
                assert.throws(function () { gate.registerPolicy(dir, 'broken'); }, /syntax-ish boom/);
            });
        });
    });

    it('12. a non-string / empty name is unresolved, never a crash', function () {
        withPolicies({}, function () {
            [ '', null, undefined, 42, {} ].forEach(function (bad) {
                assert.equal(gate.registerPolicy('/tmp/whatever', bad), null, JSON.stringify(bad));
            });
        });
    });

    // Pure-logic replica of the shipped server.js policy lint (§12.01/§12.02 pin the source).
    function lintPolicy(routing, register) {
        var count = 0, policyCount = 0;
        for (var rule in routing) {
            var route = routing[rule];
            if (typeof route != 'object' || route === null || !route.param) { continue; }
            var gated = false;
            if (typeof route.param.policy != 'undefined') {
                var name = route.param.policy;
                if (typeof name != 'string' || name === '') {
                    throw new Error('Route `' + rule + '`: `param.policy` must be a non-empty string.');
                }
                if (!register(name)) {
                    throw new Error('Route `' + rule + '` declares `param.policy` `' + name + '` but policies/' + name + '.js is missing (or does not export a function).');
                }
                gated = true;
                ++policyCount;
            }
            if (gated) { ++count; }
        }
        return { count: count, policyCount: policyCount };
    }
    var registered = function (name) { return name === 'ownsInvoice'; };

    it('13. replica — a valid policy gates the route even without requireAuth', function () {
        assert.deepEqual(lintPolicy({ a: { param: { policy: 'ownsInvoice' } } }, registered), { count: 1, policyCount: 1 });
    });

    it('14. replica — a non-string policy refuses to boot', function () {
        assert.throws(function () { lintPolicy({ a: { param: { policy: 42 } } }, registered); }, /non-empty string/);
        assert.throws(function () { lintPolicy({ a: { param: { policy: null } } }, registered); }, /non-empty string/);
        assert.throws(function () { lintPolicy({ a: { param: { policy: ['x'] } } }, registered); }, /non-empty string/);
    });

    it('15. replica — an empty-string policy refuses to boot', function () {
        assert.throws(function () { lintPolicy({ a: { param: { policy: '' } } }, registered); }, /non-empty string/);
    });

    it('16. replica — an unresolvable policy refuses to boot (a typo is not a silently-ungated route)', function () {
        assert.throws(function () { lintPolicy({ a: { param: { policy: 'typoed' } } }, registered); }, /is missing/);
    });

    it('17. replica — a param-less or non-object route is skipped, never a crash', function () {
        assert.equal(lintPolicy({ a: {}, b: null, c: 'nope', d: { param: {} } }, registered).count, 0);
    });
});

describe('§13 — self.hasRole(role): the imperative escape hatch reads roles THROUGH the gate', function () {

    var CTRL_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
    var TYPES_SRC = fs.readFileSync(path.join(FW, '../../types/index.d.ts'), 'utf8');

    it('01. DECISIVE — the controller delegates to the gate\'s predicate, never its own role read', function () {
        assert.match(CTRL_SRC, /return lib\.authzGate\.hasAnyRole\(user, \[ role \]\);/,
            'one definition of "holding a role" framework-wide');
        // CONTROL: the pin would fail on an inlined copy — the drift class this prevents.
        var perturbed = CTRL_SRC.replace(
            'return lib.authzGate.hasAnyRole(user, [ role ]);',
            'return Array.isArray(user && user.roles) ? user.roles.indexOf(role) > -1 : false;'
        );
        assert.notEqual(perturbed, CTRL_SRC, 'the perturbation must actually change the source');
        assert.doesNotMatch(perturbed, /return lib\.authzGate\.hasAnyRole\(user, \[ role \]\);/,
            'CONTROL: an inlined re-implementation must FAIL this pin');
    });

    it('02. source pin — the predicate is exported for it', function () {
        assert.match(GATE_SRC, /hasAnyRole\s+: hasAnyRole,/);
        assert.equal(typeof gate.hasAnyRole, 'function');
    });

    it('03. source pin — hasRole carries the #B35 released-response guard', function () {
        var idx = CTRL_SRC.indexOf('this.hasRole = function(role) {');
        assert.ok(idx > -1, 'the helper');
        var body = CTRL_SRC.slice(idx, idx + 700);
        assert.match(body, /if \( local\.req == null \) \{\s*\n\s*return false;/,
            'a released request must answer false, never crash the bundle');
        assert.ok(body.indexOf('local.req == null') < body.indexOf('getSession()'),
            'the guard must precede the session read');
    });

    it('04. the #DTO3b parity gate is satisfied: the types interface declares hasRole', function () {
        assert.match(TYPES_SRC, /hasRole\(role: string\): boolean;/,
            'the parity gate diffs the SuperController interface against a real instance');
    });

    it('05. the predicate it delegates to: ANY-of over an opaque string list', function () {
        assert.equal(gate.hasAnyRole({ roles: ['editor'] }, ['admin', 'editor']), true);
        assert.equal(gate.hasAnyRole({ roles: ['admin'] },  ['admin']), true);
        assert.equal(gate.hasAnyRole({ roles: ['viewer'] }, ['admin']), false);
    });

    it('06. ...and its "no roles" cases are exactly the gate\'s (the shared-definition payoff)', function () {
        assert.equal(gate.hasAnyRole(null,                   ['admin']), false, 'unauthenticated');
        assert.equal(gate.hasAnyRole({},                     ['admin']), false, 'no roles key');
        assert.equal(gate.hasAnyRole({ roles: 'admin' },     ['admin']), false, 'a bare string is not a role list');
        assert.equal(gate.hasAnyRole({ roles: {admin: 1} },  ['admin']), false, 'nor an object');
        assert.equal(gate.hasAnyRole({ roles: [] },          ['admin']), false, 'nor an empty list');
    });
});
