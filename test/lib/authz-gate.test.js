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
        // #MS3 widened the one-shot boot write to carry the machine registry —
        // the invariant (conf resolved ONCE onto _authConf) is unchanged.
        assert.match(SERVER_SRC, /process\.gina\._authConf\s*=\s*\{ loginRoute: _authzLoginRoute, machine: _authzMachine \}/);
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
        // #MS3 realignment: the gate resolves an effective principal (session
        // wins, else machine caller) — the authN check is the code-unique
        // `if ( isAuthenticated(req) )` call site, and roles now match against
        // `principal`. The ordering invariant is unchanged.
        var authIdx  = GATE_SRC.indexOf('if ( isAuthenticated(req) )');
        var rolesIdx = GATE_SRC.indexOf('hasAnyRole(principal, param.roles)');
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
        // #MS3 realignment: both call sites now take the effective principal.
        var rolesIdx  = GATE_SRC.indexOf('hasAnyRole(principal, param.roles)');
        var policyIdx = GATE_SRC.indexOf('runPolicy(controller, req, param.policy, principal)');
        assert.ok(rolesIdx > -1, 'the roles check');
        assert.ok(policyIdx > -1, 'the policy run');
        assert.ok(rolesIdx < policyIdx, 'roles must be matched before the policy runs (authN -> roles -> policy)');

        // The pin reads the ORDER, so a source with the two swapped must flip it.
        var perturbed = GATE_SRC
            .replace('hasAnyRole(principal, param.roles)', '__ROLES_MOVED__')
            .replace('runPolicy(controller, req, param.policy, principal)', 'hasAnyRole(principal, param.roles)')
            .replace('__ROLES_MOVED__', 'runPolicy(controller, req, param.policy, principal)');
        assert.notEqual(perturbed, GATE_SRC, 'the perturbation must actually change the source');
        assert.ok(
            perturbed.indexOf('hasAnyRole(principal, param.roles)') > perturbed.indexOf('runPolicy(controller, req, param.policy, principal)'),
            'CONTROL: the pin must FAIL on a swapped source — otherwise it reads nothing'
        );
    });

    it('02. source pin — the gate authenticates BEFORE it runs the policy (401 precedes 403)', function () {
        // #MS3 realignment: the authN check is the code-unique effective-principal
        // resolution; the policy run takes the principal. Ordering unchanged.
        var authIdx   = GATE_SRC.indexOf('if ( isAuthenticated(req) )');
        var policyIdx = GATE_SRC.indexOf('runPolicy(controller, req, param.policy, principal)');
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

describe('§14 — #COMPLY2 audit auto-events: every denial writes one authz.denied record', function () {

    var { beforeEach, afterEach } = require('node:test');

    // The audit module by the SAME deep path the gate requires
    // (`../../audit/src/main` from lib/authz-gate/src/ ⇒ lib/audit/src/main) —
    // Node's cache keys on the resolved file, so this IS the gate's singleton:
    // start()/reset() here govern exactly what the gate's emits see.
    var audit = require(path.join(FW, 'lib/audit/src/main'));

    it('00. source pin — the gate requires the audit module by DEEP PATH (no registry dependency)', function () {
        assert.match(GATE_SRC, /var audit = require\('\.\.\/\.\.\/audit\/src\/main'\);/,
            'the one-way deep-path dependency (the lib/job -> lib/uuid precedent)');
        assert.doesNotMatch(GATE_SRC, /lib\.audit/, 'never through the registry — the gate must not depend on injection ordering');
    });

    var dir, file;
    beforeEach(function () {
        dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-authz-audit-'));
        file = path.join(dir, 'audit.jsonl');
        audit.start({ bundle: 'b', env: 'test', file: file });
    });
    afterEach(function () {
        audit._resetForTest();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
    });

    /**
     * FIFO flush barrier: the auto-events are fire-and-forget, but the file
     * store's write queue is strictly FIFO — a marker written AFTER the
     * trigger lands AFTER the trigger's record, so read-back is deterministic.
     */
    function flush() {
        return new Promise(function (resolve) {
            audit.write('flush.marker', {}, function () { resolve(); });
        });
    }
    /** Read the records back, minus the barrier itself. */
    function records() {
        return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
            .map(function (l) { return JSON.parse(l); })
            .filter(function (r) { return r.action !== 'flush.marker'; });
    }

    it('01. a clean 401 (no bounce possible) writes outcome "401"', async function () {
        var c = ctl();
        withAuthConf(null, function () {
            gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), res());
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.equal(recs[0].action, 'authz.denied');
        assert.deepEqual(recs[0].meta, { outcome: '401' });
        assert.equal(recs[0].rule, 'account', 'the denied route rides the record');
        assert.deepEqual(recs[0].actor, { key: null, roles: [] }, 'a 401 has no authenticated actor');
        assert.equal(c.thrown.status, 401, 'the denial itself is unchanged');
    });

    it('02. the login bounce writes outcome "login-bounce"', async function () {
        var c = ctl();
        withAuthConf('/login', function () {
            captureInfo(function () {
                gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), res());
            });
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.equal(recs[0].action, 'authz.denied');
        assert.deepEqual(recs[0].meta, { outcome: 'login-bounce' });
    });

    it('03. a roles denial writes outcome "403-roles" with the denied user as the actor', async function () {
        var c = ctl();
        captureDebug(function () {
            gate.authorizeRequest(c, req({
                param   : { roles: ['admin'] },
                session : { user: { id: 'u7', roles: ['viewer'] } }
            }), res());
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.deepEqual(recs[0].meta, { outcome: '403-roles' });
        assert.deepEqual(recs[0].actor, { key: 'u7', roles: ['viewer'] },
            'an authenticated 403 records WHO was denied');
        assert.equal(c.thrown.status, 403);
    });

    it('04. every policy denial writes outcome "403-policy" — deny return, throw, unregistered alike', async function () {
        var c1 = ctl(), c2 = ctl(), c3 = ctl();
        withPolicies({
            saysNo  : function () { return false; },
            blowsUp : function () { throw new Error('kaboom'); }
        }, function () {
            captureDebug(function () {
                gate.authorizeRequest(c1, req({ param: { requireAuth: true, policy: 'saysNo' }, session: { user: { id: 'u1', roles: [] } } }), res());
            });
            captureError(function () {
                gate.authorizeRequest(c2, req({ param: { requireAuth: true, policy: 'blowsUp' }, session: { user: { id: 'u1', roles: [] } } }), res());
            });
            captureDebug(function () {
                gate.authorizeRequest(c3, req({ param: { requireAuth: true, policy: 'ghost' }, session: { user: { id: 'u1', roles: [] } } }), res());
            });
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 3, 'one record per denial');
        recs.forEach(function (r) {
            assert.equal(r.action, 'authz.denied');
            assert.deepEqual(r.meta, { outcome: '403-policy' });
        });
        [c1, c2, c3].forEach(function (c) { assert.equal(c.thrown.status, 403); });
    });

    it('05. an ALLOWED request writes nothing', async function () {
        var c = ctl();
        var out = gate.authorizeRequest(c, req({
            param   : { roles: ['admin'] },
            session : { user: { id: 'u1', roles: ['admin'] } }
        }), res());
        assert.equal(out, true);
        await flush();
        assert.equal(records().length, 0, 'the trail records denials, not grants');
    });

    it('06. events.authz: false opts the auto-events out — the denial itself is untouched', async function () {
        audit._resetForTest();
        audit.start({ bundle: 'b', env: 'test', file: file, eventsAuthz: false });
        var c = ctl();
        withAuthConf(null, function () {
            gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {} }), res());
        });
        await flush();
        assert.equal(records().length, 0, 'no auto-event');
        assert.equal(c.thrown.status, 401, 'the 401 is untouched by the opt-out');
    });

    it('07. SUBTRACT — audit enabled vs disabled: byte-identical authz outcomes', function () {
        // The containment contract: the trail must never CHANGE an authorization
        // decision. Drive the same three requests once with the trail on, once
        // with it off, and diff what the gate put on the wire.
        var outcomes = function () {
            var c401 = ctl(), c403 = ctl(), cOk = ctl();
            withAuthConf(null, function () {
                gate.authorizeRequest(c401, req({ param: { requireAuth: true }, session: {} }), res());
            });
            captureDebug(function () {
                gate.authorizeRequest(c403, req({ param: { roles: ['admin'] }, session: { user: { id: 1, roles: [] } } }), res());
            });
            var ok = gate.authorizeRequest(cOk, req({ param: { roles: ['admin'] }, session: { user: { id: 1, roles: ['admin'] } } }), res());
            return { t401: c401.thrown, t403: c403.thrown, allowed: ok };
        };
        var enabled = outcomes();          // the beforeEach started the trail
        audit._resetForTest();             // now OFF
        var disabled = outcomes();
        assert.deepEqual(enabled, disabled, 'audit on/off must be invisible to the authz outcomes');
    });
});


/* ------------------------------------------------------------------------- *
 * §15 — #COMPLY10 deny-by-default (`auth.requireAuthByDefault`)
 *
 * The mode INVERTS §02: an un-annotated route is gated instead of open, and
 * `param.public: true` is the explicit opt-out. Everything here is additive —
 * §02 must stay green untouched, which is itself the proof that the mode
 * defaults OFF when `process.gina._authConf` carries no `byBundle` map.
 *
 * The two decisive properties, beyond the happy path:
 *   * PER-BUNDLE keying. Merged mode runs every bundle in one process, so a
 *     flat flag would let the last bundle to boot decide the posture for all
 *     of them — silently un-gating a bundle that opted in (a fail-OPEN).
 *   * STRUCTURAL precedence. `public` is tested INSIDE the un-annotated
 *     branch, so it can never un-gate an explicitly gated route even when the
 *     boot lint has not run (a hand-built or tampered config still fails
 *     closed).
 * ------------------------------------------------------------------------- */

/** A request carrying the bundle the per-bundle mode lookup reads. */
function reqB(opts) {
    opts = opts || {};
    var r = {
        method  : opts.method || 'GET',
        routing : {
            rule   : opts.rule || 'dashboard',
            param  : opts.param || {},
            bundle : ( typeof opts.bundle === 'undefined' ) ? 'app' : opts.bundle
        }
    };
    if (typeof opts.session !== 'undefined') { r.session = opts.session; }
    if (typeof opts.isXhr   !== 'undefined') { r.isXMLRequest = opts.isXhr; }
    r[String(r.method).toLowerCase()] = opts.data || {};
    return r;
}

/** Run `fn` with a boot-built `_authConf` carrying the per-bundle mode map. */
function withMode(byBundle, loginRoute, fn) {
    var had  = Object.prototype.hasOwnProperty.call(process, 'gina');
    var prev = had ? process.gina : undefined;
    process.gina = { _authConf: { loginRoute: loginRoute || null, machine: { enabled: false, callers: {} }, byBundle: byBundle } };
    try { return fn(); }
    finally {
        if (had) { process.gina = prev; } else { delete process.gina; }
    }
}

/**
 * Pure-logic replica of the shipped core/server.js boot-lint additions
 * (the `param.public` axis + the mode-scoped cache cross-check).
 */
function lintPublic(routing, authSettings) {
    var s = authSettings || {};
    var defaultDeny = false;
    if ( typeof(s.requireAuthByDefault) != 'undefined' ) {
        if ( typeof(s.requireAuthByDefault) != 'boolean' ) {
            throw new Error('`settings.json > auth.requireAuthByDefault` must be a boolean');
        }
        defaultDeny = s.requireAuthByDefault;
    }
    for (var rule in routing) {
        var route = routing[rule];
        if ( typeof(route) != 'object' || route === null || !route.param ) { continue; }
        var gated = false;
        if ( route.param.requireAuth === true ) { gated = true; }
        if ( Array.isArray(route.param.roles) && route.param.roles.length > 0 ) { gated = true; }
        if ( typeof(route.param.policy) == 'string' && route.param.policy !== '' ) { gated = true; }
        if ( typeof(route.param.public) != 'undefined' ) {
            if ( typeof(route.param.public) != 'boolean' ) {
                throw new Error('Route `'+ rule +'`: `param.public` must be a boolean');
            }
            if ( route.param.public === true && gated ) {
                throw new Error('Route `'+ rule +'`: `param.public: true` contradicts');
            }
        }
        // #B158 — ANY gated route, however it is gated (explicit key OR the mode).
        // #COMPLY10 shipped this scoped to mode-gated routes only; the explicitly
        // annotated case it left open was the pre-existing leak.
        var routeGated = gated || ( defaultDeny && route.param.public !== true );
        if ( routeGated && route.cache ) {
            throw new Error('Route `'+ rule +'`: gates this route, but it also declares `cache`');
        }
    }
    return true;
}

describe('§15 — #COMPLY10 deny-by-default: source pins', function () {
    it('15.1 - the gate reads the mode PER BUNDLE, never a flat flag', function () {
        assert.match(GATE_SRC, /var requireAuthByDefault = function \(req\) \{/, 'the reader exists');
        assert.ok(GATE_SRC.indexOf('conf.byBundle[bundle]') > -1, 'keyed by bundle');
        assert.ok(GATE_SRC.indexOf('req.routing.bundle') > -1, 'the key comes off the request');
    });
    it('15.2 - the exemption is tested INSIDE the un-annotated branch (structural fail-closed)', function () {
        var branchIdx = GATE_SRC.indexOf('if ( param.requireAuth !== true && !mustMatchRoles && !mustRunPolicy ) {');
        var publicIdx = GATE_SRC.indexOf('if ( param.public === true ) {');
        var modeIdx   = GATE_SRC.indexOf('if ( !requireAuthByDefault(req) ) {');
        var principal = GATE_SRC.indexOf('if ( isAuthenticated(req) ) {');
        assert.ok(branchIdx > -1 && publicIdx > -1 && modeIdx > -1 && principal > -1, 'all four anchors present');
        assert.ok(publicIdx > branchIdx, '`public` is checked inside the un-annotated branch, not beside it');
        assert.ok(modeIdx   > publicIdx, 'an explicit exemption short-circuits before the mode lookup');
        assert.ok(principal > modeIdx,   'the mode falls through to the SAME authN block');
    });
    it('15.3 - core/server.js lints the new key and every contradiction it makes possible', function () {
        assert.ok(SERVER_SRC.indexOf('`settings.json > auth.requireAuthByDefault` must be a boolean') > -1, 'strict-boolean master switch');
        assert.ok(SERVER_SRC.indexOf('`param.public` must be a boolean') > -1, 'strict-boolean exemption');
        assert.ok(SERVER_SRC.indexOf('contradicts `param.requireAuth` / `param.roles` / `param.policy`') > -1, 'same-axis contradiction refuses');
        assert.ok(SERVER_SRC.indexOf('it also declares `cache`') > -1, 'mode-scoped cache cross-check refuses');
        assert.ok(SERVER_SRC.indexOf('an infinite redirect that locks out every visitor') > -1, 'login-route lockout refuses');
    });
    it('15.4 - the boot write preserves sibling bundles (the merged-mode fail-open fix)', function () {
        assert.ok(SERVER_SRC.indexOf('process.gina._authConf.byBundle = _authzByBundle;') > -1, 'the map is written');
        assert.match(SERVER_SRC, /_authzByBundle\[self\.appName\] = \{ requireAuthByDefault: _authzDefaultDeny \};/, 'keyed by the booting bundle');
        assert.ok(SERVER_SRC.indexOf('process.gina._authConf.byBundle') > -1
               && SERVER_SRC.indexOf('? process.gina._authConf.byBundle : {}') > -1, 'reads the existing map first, so an earlier bundle is not erased');
    });
    it('15.5 - the client-served routing blob strips `public` too', function () {
        assert.ok(ISAAC_SRC.indexOf('delete cleanParam.public;') > -1, '`public` is stripped');
        // The #COMPLY1 destructuring line must stay byte-identical — §10 pins it.
        assert.ok(ISAAC_SRC.indexOf('const { requireAuth, roles, policy, ...cleanParam } = clean.param;') > -1,
            'the pinned #COMPLY1 strip line is untouched');
    });
    it('15.6 - the shipped settings template ships the mode OFF', function () {
        assert.match(SETTINGS_SRC, /"requireAuthByDefault":\s*false/, 'fail-closed default in the template');
    });
});

describe('§15 — #COMPLY10 deny-by-default: behaviour', function () {
    it('15.7 - mode ON: an un-annotated route now answers 401', function () {
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            var c = ctl(), rq = reqB({ param: { control: 'dashboard' } }), rs = res();
            var allowed = gate.authorizeRequest(c, rq, rs);
            assert.equal(allowed, false, 'the gate answered');
            assert.equal(c.thrown && c.thrown.status, 401, 'a 401, never a 403 — the route declares no roles/policy');
        });
    });
    it('15.8 - mode ON + `public: true`: the route stays open', function () {
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            var c = ctl(), rq = reqB({ param: { control: 'home', public: true } }), rs = res();
            assert.equal(gate.authorizeRequest(c, rq, rs), true, 'the action is reached');
            assert.equal(c.thrown, null, 'nothing was written to the wire');
        });
    });
    it('15.9 - mode OFF: byte-identical to today (the subtract-control)', function () {
        // Both shapes of "off": no byBundle map at all, and an explicit false.
        [undefined, { app: { requireAuthByDefault: false } }].forEach(function (map, i) {
            withMode(map, null, function () {
                var c = ctl(), rq = reqB({ param: { control: 'dashboard' } }), rs = res();
                assert.equal(gate.authorizeRequest(c, rq, rs), true, 'un-annotated stays open (case ' + i + ')');
                assert.equal(c.thrown, null, 'nothing written (case ' + i + ')');
            });
        });
    });
    it('15.10 - PER-BUNDLE: one bundle opting in never gates its siblings', function () {
        withMode({ secured: { requireAuthByDefault: true } }, null, function () {
            var cA = ctl(), rqA = reqB({ bundle: 'secured', param: { control: 'x' } }), rsA = res();
            assert.equal(gate.authorizeRequest(cA, rqA, rsA), false, 'the opted-in bundle gates');
            assert.equal(cA.thrown.status, 401);

            var cB = ctl(), rqB2 = reqB({ bundle: 'other', param: { control: 'x' } }), rsB = res();
            assert.equal(gate.authorizeRequest(cB, rqB2, rsB), true, 'the sibling bundle is untouched');
            assert.equal(cB.thrown, null);
        });
    });
    it('15.11 - an unidentifiable bundle does not gate (availability-safe, and unreachable from dispatch)', function () {
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            var c = ctl(), rq = reqB({ bundle: undefined, param: { control: 'x' } }), rs = res();
            delete rq.routing.bundle;
            assert.equal(gate.authorizeRequest(c, rq, rs), true, 'no bundle -> the mode cannot apply');
            assert.equal(c.thrown, null);
        });
    });
    it('15.12 - STRUCTURAL precedence: `public` never un-gates an explicitly gated route', function () {
        // The boot lint refuses this config; the gate must fail CLOSED anyway.
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            [
                { control: 'x', public: true, requireAuth: true },
                { control: 'x', public: true, roles: ['admin'] },
                { control: 'x', public: true, policy: 'ownsIt' }
            ].forEach(function (param, i) {
                var c = ctl(), rq = reqB({ param: param }), rs = res();
                assert.equal(gate.authorizeRequest(c, rq, rs), false, 'still gated (case ' + i + ')');
                assert.equal(c.thrown.status, 401, 'unauthenticated -> 401 (case ' + i + ')');
            });
        });
    });
    it('15.13 - mode ON + an authenticated session: the action is reached', function () {
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            var c = ctl(), rq = reqB({ param: { control: 'x' }, session: { user: { id: 7 } } }), rs = res();
            assert.equal(gate.authorizeRequest(c, rq, rs), true);
            assert.equal(c.thrown, null);
        });
    });
    it('15.14 - mode ON + a login route: a browser navigation bounces (302), never a 403', function () {
        withMode({ app: { requireAuthByDefault: true } }, '/login', function () {
            var c = ctl(), rq = reqB({ param: { control: 'x' }, session: {} }), rs = res();
            var lines = captureInfo(function () { gate.authorizeRequest(c, rq, rs); });
            assert.equal(rs.code, 302, 'the forced bounce');
            assert.equal(rs.head['location'], '/login');
            assert.equal(rs.head['cache-control'], 'no-cache, no-store, must-revalidate', 'never a cacheable bounce');
            assert.ok(lines.some(function (l) { return l.indexOf('[302] /login') > -1; }), lines.join('|'));
        });
    });
});

describe('§15 — #COMPLY10 deny-by-default: the boot lint (pure-logic replica)', function () {
    it('15.15 - a non-boolean `param.public` refuses to boot', function () {
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x', public: 'true' } } }, {});
        }, /`param\.public` must be a boolean/);
    });
    it('15.16 - `public: true` alongside an explicit gate key refuses to boot', function () {
        [ { requireAuth: true }, { roles: ['admin'] }, { policy: 'ownsIt' } ].forEach(function (extra, i) {
            var param = Object.assign({ control: 'x', public: true }, extra);
            assert.throws(function () {
                lintPublic({ r: { param: param } }, {});
            }, /contradicts/, 'case ' + i);
        });
    });
    it('15.17 - `public` with a non-gating shape is accepted (redundant, not an error)', function () {
        assert.equal(lintPublic({ r: { param: { control: 'x', public: true, requireAuth: false } } }, {}), true);
        assert.equal(lintPublic({ r: { param: { control: 'x', public: false } } }, {}), true);
    });
    it('15.18 - a non-boolean `auth.requireAuthByDefault` refuses to boot', function () {
        assert.throws(function () {
            lintPublic({}, { requireAuthByDefault: 'true' });
        }, /must be a boolean/);
    });
    it('15.19 - mode ON: a route the MODE gates may not also be cached', function () {
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x' }, cache: { type: 'memory' } } }, { requireAuthByDefault: true });
        }, /it also declares `cache`/);
    });
    it('15.20 - #B158: an EXPLICITLY gated route may not be cached either, in either mode', function () {
        // The pre-existing leak #COMPLY10 deliberately left open. Refused in BOTH modes
        // now: the render cache is served before the gate and keyed without a principal,
        // so the first authenticated body is replayed to every later anonymous caller.
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x', requireAuth: true }, cache: { type: 'memory' } } }, {});
        }, /it also declares `cache`/, 'requireAuth + cache, mode OFF');
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x', roles: ['admin'] }, cache: { type: 'memory' } } }, {});
        }, /it also declares `cache`/, 'roles + cache implies requireAuth');
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x', policy: 'p' }, cache: { type: 'memory' } } }, {});
        }, /it also declares `cache`/, 'policy + cache implies requireAuth');
        assert.throws(function () {
            lintPublic({ r: { param: { control: 'x', requireAuth: true }, cache: { type: 'memory' } } }, { requireAuthByDefault: true });
        }, /it also declares `cache`/, 'requireAuth + cache, mode ON');
        // mode ON but the route is public -> cacheable and open is a legitimate pair.
        assert.equal(lintPublic({ r: { param: { control: 'x', public: true }, cache: { type: 'memory' } } }, { requireAuthByDefault: true }), true,
            'public + cache stays legal under the mode');
    });
    it('15.21 - #B158: an UNGATED cached route is untouched (the subtract-control)', function () {
        // The refusal must key on gating, never on the mere presence of `cache` — a plain
        // cached route is the single most common shape in the wild.
        assert.equal(lintPublic({ r: { param: { control: 'x' }, cache: { type: 'memory' } } }, {}), true,
            'mode OFF, un-annotated + cache stays legal');
        assert.equal(lintPublic({ r: { param: { control: 'x', requireAuth: false }, cache: { type: 'memory' } } }, {}), true,
            'an explicit requireAuth:false does not gate, so it does not forbid cache');
        assert.equal(lintPublic({ r: { param: { control: 'x', requireAuth: true } } }, {}), true,
            'gated WITHOUT cache is the normal gated route and stays legal');
    });
});

/* ---------------------------------------------------------------------------
 * §16 — #B158: a gated route is never render-cached.
 *
 * The defect: both render-cache serve points run BEFORE the authorization gate
 * (the engine-agnostic read serves and RETURNS ahead of `router.route`, inside
 * which the gate runs; isaac's runs pre-routing, before `req.routing` exists),
 * and `buildKey` composes `<release>:<kind>:<bundle>:<url>` with no principal
 * component. So a cached gated route replays the first authenticated caller's
 * rendered body to every later anonymous one — reproduced live on an isolated
 * boot before the fix, and refused at boot after it.
 *
 * Two layers, tested separately: the boot refusal (§15.20/§15.21 cover the lint
 * replica) and the write-side backstop pinned here, which fails CLOSED for a
 * config the lint never saw (hand-built, tampered, or mutated at runtime).
 * ------------------------------------------------------------------------- */

var RJSON_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.render-json.js'), 'utf8');
var RSWIG_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.render-swig.js'), 'utf8');
var RNJK_SRC  = fs.readFileSync(path.join(FW, 'core/controller/controller.render-nunjucks.js'), 'utf8');

describe('§16 — #B158: `isRouteGated` is the one runtime answer', function () {
    it('16.1 - an explicit key gates, in whatever form', function () {
        withMode({ app: { requireAuthByDefault: false } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { requireAuth: true } })), true, 'requireAuth');
            assert.equal(gate.isRouteGated(reqB({ param: { roles: ['admin'] } })), true, 'roles imply requireAuth');
            assert.equal(gate.isRouteGated(reqB({ param: { policy: 'p' } })), true, 'policy implies requireAuth');
        });
    });
    it('16.2 - an invalid declared shape never HALF-gates (it is boot-refused anyway)', function () {
        withMode({ app: { requireAuthByDefault: false } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { requireAuth: 'true' } })), false, 'a truthy STRING does not gate');
            assert.equal(gate.isRouteGated(reqB({ param: { roles: [] } })), false, 'an empty roles array does not gate');
            assert.equal(gate.isRouteGated(reqB({ param: { policy: '' } })), false, 'an empty policy does not gate');
        });
    });
    it('16.3 - the #COMPLY10 mode gates an un-annotated route, and `public` exempts it', function () {
        withMode({ app: { requireAuthByDefault: true } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { control: 'x' } })), true, 'mode ON gates the un-annotated route');
            assert.equal(gate.isRouteGated(reqB({ param: { control: 'x', public: true } })), false, '`public` exempts');
        });
        withMode({ app: { requireAuthByDefault: false } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { control: 'x' } })), false, 'mode OFF leaves it open');
        });
    });
    it('16.4 - the mode is read PER BUNDLE, so a sibling bundle cannot gate this one', function () {
        withMode({ other: { requireAuthByDefault: true } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { control: 'x' }, bundle: 'app' })), false,
                'only the booting bundle\'s own posture counts');
        });
    });
    it('16.5 - `public` can never un-gate an EXPLICITLY gated route (structural fail-closed)', function () {
        // The boot lint refuses this contradiction outright; the predicate must still
        // fail closed for a config that never passed the lint.
        withMode({ app: { requireAuthByDefault: false } }, null, function () {
            assert.equal(gate.isRouteGated(reqB({ param: { requireAuth: true, public: true } })), true,
                'explicit gate wins over `public`');
        });
    });
    it('16.6 - a request with no routing is not gated (and cannot throw)', function () {
        assert.equal(gate.isRouteGated(undefined), false);
        assert.equal(gate.isRouteGated({}), false);
        assert.equal(gate.isRouteGated({ routing: {} }), false);
    });
});

describe('§16 — #B158: the write-side backstop is wired in every render delegate', function () {
    it('16.7 - all three delegates consult the gate before storing', function () {
        assert.ok(RJSON_SRC.indexOf('lib.authzGate.isRouteGated(req)') > -1, 'render-json');
        assert.ok(RSWIG_SRC.indexOf('lib.authzGate.isRouteGated(req)') > -1, 'render-swig');
        // nunjucks binds the registry as `libRef` (see its own #B32 note).
        assert.ok(RNJK_SRC.indexOf('libRef.authzGate.isRouteGated(req)') > -1, 'render-nunjucks');
    });
    it('16.8 - DECISIVE: the check sits INSIDE each writeCache early-return guard', function () {
        // Placed in the guard, the gated route returns before any key is built. Placed
        // after, a gated body would already be on its way into the store.
        [['render-json', RJSON_SRC, 'lib.'], ['render-swig', RSWIG_SRC, 'lib.'], ['render-nunjucks', RNJK_SRC, 'libRef.']]
            .forEach(function (row) {
                var name = row[0], src = row[1], ns = row[2];
                var guardIdx = src.indexOf('typeof(req.routing.cache) == \'undefined\'');
                var gatedIdx = src.indexOf(ns + 'authzGate.isRouteGated(req)');
                var keyIdx   = src.indexOf('renderCache.buildKey(');
                assert.ok(guardIdx > -1 && gatedIdx > -1 && keyIdx > -1, name + ': all three anchors present');
                assert.ok(gatedIdx > guardIdx, name + ': the check is part of the cache guard');
                assert.ok(gatedIdx < keyIdx,   name + ': it runs BEFORE the cache key is built');
            });
    });
    it('16.9 - the boot lint refuses the pairing for ANY gated route, not just mode-gated', function () {
        var idx = SERVER_SRC.indexOf('var _authzRouteGated = _authzGated || ( _authzDefaultDeny && _authzRoute.param.public !== true );');
        assert.ok(idx > -1, 'the widened predicate is computed at boot');
        assert.ok(SERVER_SRC.indexOf('it also declares `cache`') > -1, 'the refusal still names the pairing');
        // The remedy differs by how the route is gated: `public: true` is a legal fix
        // only for a mode-gated route — on an explicitly gated one it is boot-refused
        // as a contradiction, so that branch must tell the operator to drop a key.
        assert.ok(SERVER_SRC.indexOf('or remove the authorization keys if the route is meant to be open to everyone.') > -1,
            'the explicit branch offers the reachable remedy');
    });
});
