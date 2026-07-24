'use strict';
/**
 * lib/authz-gate — #MS3 machine-caller authentication (service-to-service).
 *
 * A caller that cannot hold a session authenticates per request with
 * `Authorization: Bearer <key>` against `settings.json > auth.machine`
 * (opt-in, fail-closed). core/server.js lints the block at BOOT and
 * precomputes a sha256 hash per configured caller onto
 * `process.gina._authConf.machine`; the gate verifies the presented token in
 * constant time (hash-both-sides), stamps `req.machineCaller` and hands the
 * machine principal to the SAME roles/policy pipeline a session user rides.
 *
 * Shape of this suite (sibling of test/lib/authz-gate.test.js, whose harness
 * idioms it mirrors — the #COMPLY1 suites stay untouched there):
 *   §01 source pins — the gate: session-wins ordering (the machine branch sits
 *       in the else of the session check), the Bearer parse, hash-both-sides +
 *       timingSafeEqual, the `req.machineCaller` stamp, the machine-401 writer
 *       (WWW-Authenticate BEFORE throwError, the '401-machine' audit token).
 *   §02 source pins — the surfaces around the gate: the core/server.js boot
 *       lint + keyHash precompute + the widened `_authConf` write; lib/audit's
 *       deriveActor machine branch; the controller hasRole fallback; the
 *       template settings.json block; the schema/settings.json declaration.
 *   §03 behavioural — the gate driven end-to-end with the harness stubs:
 *       valid/invalid/absent Bearer, roles matching, policy principal,
 *       session-wins, the never-bounce guarantee, the enabled:false and
 *       pre-#MS3-conf SUBTRACTS (byte-identical legacy), lazy resolution on
 *       un-gated routes, empty-callers fail-closed.
 *   §04 crypto properties — unequal-length tokens never throw (the reason for
 *       hashing both sides), a presented sha256-of-the-key does NOT admit
 *       (proves the stored hash is compared against hash(presented), so
 *       knowing the hash is worthless), roles mutation isolation.
 *   §05 audit — real lib/audit file store (the §14 mechanics): a machine
 *       denial writes outcome '401-machine' with the machine actor; a machine
 *       WRITE snapshots `{ key: <name>, roles, machine: true }`; session wins
 *       in the actor derivation too.
 *   §06 controller — `self.hasRole()` behavioural via createTestInstance (the
 *       controller.test.js §36 bootstrap): a machine caller's configured roles
 *       answer hasRole; a session user still wins.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var crypto = require('crypto');

var FW = require('../fw');

var GATE_PATH    = path.join(FW, 'lib/authz-gate/src/main.js');
var gate         = require(GATE_PATH);

var GATE_SRC     = fs.readFileSync(GATE_PATH, 'utf8');
var SERVER_SRC   = fs.readFileSync(path.join(FW, 'core/server.js'), 'utf8');
var AUDIT_SRC    = fs.readFileSync(path.join(FW, 'lib/audit/src/main.js'), 'utf8');
var CTRL_SRC     = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');
var SETTINGS_SRC = fs.readFileSync(path.join(FW, 'core/template/conf/settings.json'), 'utf8');
var SCHEMA_SRC   = fs.readFileSync(path.join(__dirname, '../../schema/settings.json'), 'utf8');

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
/** A response stub recording head/body AND set headers (the machine 401 sets one). */
function res() {
    var r = { headersSent: false, code: null, head: null, body: null, ended: false, headers: {} };
    r.writeHead = function (code, head) { r.code = code; r.head = head; };
    r.end       = function (body) { r.body = body; r.ended = true; };
    r.setHeader = function (k, v) { r.headers[k] = v; };
    return r;
}
/** A request shaped like the one router.js dispatches with. */
function req(opts) {
    opts = opts || {};
    var r = {
        method  : opts.method || 'GET',
        routing : { rule: opts.rule || 'account', param: opts.param || {} }
    };
    if (typeof opts.session !== 'undefined') { r.session = opts.session; }
    if (typeof opts.isXhr   !== 'undefined') { r.isXMLRequest = opts.isXhr; }
    if (typeof opts.bearer  !== 'undefined') { r.headers = { authorization: opts.bearer }; }
    if (typeof opts.headers !== 'undefined') { r.headers = opts.headers; }
    r[String(r.method).toLowerCase()] = opts.data || {};
    return r;
}
/**
 * Build a boot-shaped machine conf: callers keyed by name, each key sha256'd
 * exactly as the core/server.js precompute does.
 */
function machineCallers(map) {
    var out = {};
    Object.keys(map).forEach(function (n) {
        out[n] = {
            keyHash : crypto.createHash('sha256').update(map[n].key, 'utf8').digest(),
            roles   : Array.isArray(map[n].roles) ? map[n].roles.slice() : []
        };
    });
    return out;
}
/** Run `fn` with a full process.gina shape set, restoring whatever was there. */
function withGina(shape, fn) {
    var had  = Object.prototype.hasOwnProperty.call(process, 'gina');
    var prev = had ? process.gina : undefined;
    process.gina = shape;
    try { return fn(); }
    finally {
        if (had) { process.gina = prev; } else { delete process.gina; }
    }
}
/** The common case: an _authConf carrying loginRoute + machine. */
function withMachine(loginRoute, machine, fn) {
    return withGina({ _authConf: { loginRoute: loginRoute, machine: machine } }, fn);
}
/** Silence + capture console.debug (the 403 server-side detail line). */
function captureDebug(fn) {
    var lines = [];
    var prevDebug = console.debug;
    console.debug = function (m) { lines.push(String(m)); };
    try { fn(); } finally { console.debug = prevDebug; }
    return lines;
}
/** Silence + capture console.info (the bounce access-log line). */
function captureInfo(fn) {
    var lines = [];
    var prevInfo = console.info, prevWarn = console.warn;
    console.info = function (m) { lines.push(String(m)); };
    console.warn = function () {};
    try { fn(); } finally { console.info = prevInfo; console.warn = prevWarn; }
    return lines;
}

/** Comment-strip for the template settings.json (inline `//` after whitespace). */
function parseTemplateSettings(src) {
    var stripped = src.split('\n').map(function (l) {
        return l.replace(/(^|\s)\/\/.*$/, '');
    }).join('\n');
    return JSON.parse(stripped);
}

describe('§01 — source pins: the gate\'s machine path', function () {

    it('01. session wins STRUCTURALLY — the machine resolution sits in the else of the session check, before the unauthenticated deny', function () {
        var sessIdx    = GATE_SRC.indexOf('if ( isAuthenticated(req) )');
        var machIdx    = GATE_SRC.indexOf('getMachineConf();');
        var denyIdx    = GATE_SRC.indexOf('if ( !principal )');
        assert.ok(sessIdx > -1, 'the session authN check');
        assert.ok(machIdx > -1, 'the machine conf read');
        assert.ok(denyIdx > -1, 'the unauthenticated deny');
        assert.ok(sessIdx < machIdx, 'the session check precedes the machine resolution (session wins)');
        assert.ok(machIdx < denyIdx, 'the machine resolution precedes the unauthenticated deny');
    });

    it('02. the Bearer parse mirrors the lib/mcp-http precedent (case-insensitive scheme, trimmed token)', function () {
        assert.match(GATE_SRC, /\/\^Bearer\\s\+\(\.\+\)\$\/i\.exec\(header\)/);
        assert.match(GATE_SRC, /m\[1\]\.trim\(\)/);
    });

    it('03. hash-both-sides + timingSafeEqual — fixed-length compare, no length oracle', function () {
        assert.match(GATE_SRC, /crypto\.createHash\('sha256'\)\.update\(token, 'utf8'\)\.digest\(\)/);
        assert.match(GATE_SRC, /crypto\.timingSafeEqual\(presentedHash, entry\.keyHash\)/);
    });

    it('04. the verified principal is stamped on req.machineCaller with the machine marker', function () {
        assert.match(GATE_SRC, /req\.machineCaller = principal/);
        assert.match(GATE_SRC, /machine : true/);
    });

    it('05. the machine 401 sets WWW-Authenticate BEFORE throwError (it must ride the same response)', function () {
        var blkIdx  = GATE_SRC.indexOf('var denyMachineUnauthenticated = function');
        assert.ok(blkIdx > -1, 'the machine deny writer');
        var blk     = GATE_SRC.slice(blkIdx, blkIdx + 1400);
        var hdrIdx  = blk.indexOf("setHeader('WWW-Authenticate', 'Bearer')");
        var thrIdx  = blk.indexOf('controller.throwError(');
        assert.ok(hdrIdx > -1, 'the WWW-Authenticate set');
        assert.ok(thrIdx > -1, 'the 401 write');
        assert.ok(hdrIdx < thrIdx, 'the header must be set before the error writer sends');
    });

    it('06. the machine denial audits with its own outcome token', function () {
        assert.match(GATE_SRC, /emitAuthzDenied\(req, '401-machine'\)/);
    });

    it('07. the machine deny NEVER routes through the bounce writer (the 302 is meaningless to a service)', function () {
        var blkIdx = GATE_SRC.indexOf('var denyMachineUnauthenticated = function');
        var blkEnd = GATE_SRC.indexOf('var denyForbidden', blkIdx);
        var blk    = GATE_SRC.slice(blkIdx, blkEnd);
        assert.ok(blk.indexOf('bounceToLogin(') < 0, 'no bounce from the machine deny writer');
        assert.ok(blk.indexOf('pauseRequest(') < 0, 'no snapshot either — nothing to replay for a machine');
    });

    it('08. the gate still reads only the boot conf — no per-request config clone on the machine path', function () {
        assert.doesNotMatch(GATE_SRC, /getConfig\(/);
        assert.doesNotMatch(GATE_SRC, /JSON\.clone\(/);
    });
});

describe('§02 — source pins: the surfaces around the gate', function () {

    it('01. core/server.js lints auth.machine at boot — the quietly-OFF class refuses to boot', function () {
        assert.match(SERVER_SRC, /`settings\.json > auth\.machine` must be an object/);
        assert.match(SERVER_SRC, /auth\.machine\.enabled` must be a boolean/);
        assert.match(SERVER_SRC, /auth\.machine\.callers` must be an object map/);
        assert.match(SERVER_SRC, /`key` must be a non-empty string/);
    });

    it('02. the boot precomputes sha256 key hashes — the raw key is not retained', function () {
        assert.match(SERVER_SRC, /keyHash : crypto\.createHash\('sha256'\)\.update\(_authzCaller\.key, 'utf8'\)\.digest\(\)/);
    });

    it('03. the boot write carries the machine registry alongside loginRoute (one _authConf resolve)', function () {
        assert.match(SERVER_SRC, /process\.gina\._authConf\s*=\s*\{ loginRoute: _authzLoginRoute, machine: _authzMachine \}/);
    });

    it('04. lib/audit deriveActor snapshots the machine caller — name as key, roles COPIED, machine-marked', function () {
        assert.match(AUDIT_SRC, /req\.machineCaller && typeof req\.machineCaller === 'object'/);
        assert.match(AUDIT_SRC, /key\s*:\s*machine\.name/);
        assert.match(AUDIT_SRC, /machine\.roles\.slice\(\)/);
    });

    it('05. controller hasRole reads the effective principal — machineCaller as the session fallback', function () {
        assert.match(CTRL_SRC, /local\.req\.machineCaller && typeof\(local\.req\.machineCaller\) == 'object'/);
    });

    it('06. the template settings.json ships auth.machine fail-closed', function () {
        var o = parseTemplateSettings(SETTINGS_SRC);
        assert.ok(o.auth.machine, 'settings.json > auth.machine');
        assert.equal(o.auth.machine.enabled, false, 'disabled until a bundle opts in');
        assert.deepEqual(o.auth.machine.callers, {}, 'no callers until a bundle declares them');
    });

    it('07. schema/settings.json declares the block — key required, enabled strictly boolean', function () {
        var s = JSON.parse(SCHEMA_SRC);
        var machine = s.properties.auth.properties.machine;
        assert.ok(machine, 'schema > auth.machine');
        assert.equal(machine.properties.enabled.type, 'boolean');
        assert.equal(machine.properties.enabled.default, false);
        var caller = machine.properties.callers.additionalProperties;
        assert.deepEqual(caller.required, ['key']);
        assert.equal(caller.properties.key.minLength, 1);
    });
});

describe('§03 — behavioural: the gate end-to-end', function () {

    var CALLERS = machineCallers({
        billing : { key: 'k-billing-0123456789abcdef', roles: ['service'] },
        cron    : { key: 'k-cron-fedcba9876543210' }   // no roles
    });
    var MACHINE = { enabled: true, callers: CALLERS };

    it('01. a valid Bearer passes requireAuth and stamps the principal', function () {
        var c = ctl(), r = res();
        var rq = req({ param: { requireAuth: true }, bearer: 'Bearer k-billing-0123456789abcdef' });
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, rq, r);
        });
        assert.equal(out, true, 'the action is reached');
        assert.equal(c.thrown, null);
        assert.deepEqual(rq.machineCaller, { name: 'billing', roles: ['service'], machine: true });
    });

    it('02. the caller\'s roles match route roles exactly like a session user\'s', function () {
        var c = ctl();
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { roles: ['service'] }, bearer: 'Bearer k-billing-0123456789abcdef' }), res());
        });
        assert.equal(out, true);
    });

    it('03. insufficient roles -> the generic 403, after authN passed (never a 401)', function () {
        var c = ctl();
        var rq = req({ param: { roles: ['admin'] }, bearer: 'Bearer k-billing-0123456789abcdef' });
        var out;
        var dbg = captureDebug(function () {
            out = withMachine(null, MACHINE, function () {
                return gate.authorizeRequest(c, rq, res());
            });
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 403, 'authN passed, authZ failed');
        assert.equal(c.thrown.error, 'Forbidden', 'generic body — no role disclosure');
        assert.ok(rq.machineCaller, 'the principal was resolved before the roles check');
        assert.ok(dbg.join('\n').indexOf('machine caller') > -1, 'the server-side detail names the machine caller');
    });

    it('04. a policy receives the MACHINE principal as its user argument', function () {
        var seen = null;
        var out = withGina({
            _authConf  : { loginRoute: null, machine: MACHINE },
            _policies  : { fromMachine: function (user, rq2) { seen = user; return user.machine === true; } }
        }, function () {
            return gate.authorizeRequest(ctl(), req({ param: { policy: 'fromMachine' }, bearer: 'Bearer k-billing-0123456789abcdef' }), res());
        });
        assert.equal(out, true);
        assert.equal(seen.name, 'billing');
        assert.equal(seen.machine, true, 'the policy can discriminate machine callers');
        assert.deepEqual(seen.roles, ['service']);
    });

    it('05. DECISIVE — an invalid presented Bearer gets the machine 401 + WWW-Authenticate, NEVER the bounce (loginRoute configured, non-XHR, session present)', function () {
        var c = ctl(), r = res();
        var out = withMachine('/login', MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {}, bearer: 'Bearer WRONG-KEY' }), r);
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401, 'a clean 401 — the pre-#MS3 shape here was the 302 bounce');
        assert.equal(c.thrown.error, 'Authentication required', 'generic body — unknown vs malformed is not disclosed');
        assert.equal(r.headers['WWW-Authenticate'], 'Bearer', 'the scheme is named (RFC 6750)');
        assert.equal(r.code, null, 'no writeHead — the bounce never ran');
        assert.equal(c.paused, null, 'no snapshot — nothing to replay for a machine');
    });

    it('06. session WINS — a signed-in request never consults the machine path', function () {
        var c = ctl();
        var rq = req({ param: { roles: ['admin'] }, session: { user: { roles: ['admin'] } }, bearer: 'Bearer k-billing-0123456789abcdef' });
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, rq, res());
        });
        assert.equal(out, true, 'authorized by the SESSION user\'s roles');
        assert.equal(typeof rq.machineCaller, 'undefined', 'the machine resolution never ran');
    });

    it('07. SUBTRACT — enabled:false is byte-identical legacy: the same request bounces exactly as pre-#MS3', function () {
        var c = ctl(), r = res();
        var out;
        captureInfo(function () {
            out = withMachine('/login', { enabled: false, callers: CALLERS }, function () {
                return gate.authorizeRequest(c, req({ param: { requireAuth: true }, session: {}, bearer: 'Bearer k-billing-0123456789abcdef' }), r);
            });
        });
        assert.equal(out, false);
        assert.equal(r.code, 302, 'the legacy bounce — a VALID key changes nothing while disabled');
        assert.equal(typeof r.headers['WWW-Authenticate'], 'undefined');
        assert.equal(c.thrown, null, 'no 401 — the bounce answered');
    });

    it('08. SUBTRACT — a pre-#MS3 _authConf (no machine key at all) is byte-identical legacy', function () {
        var c = ctl();
        var rq = req({ param: { requireAuth: true }, bearer: 'Bearer k-billing-0123456789abcdef' });
        var out = withGina({ _authConf: { loginRoute: null } }, function () {
            return gate.authorizeRequest(c, rq, res());
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401, 'the plain legacy 401');
        assert.equal(typeof rq.machineCaller, 'undefined');
    });

    it('09. LAZY — an un-gated route never resolves the machine caller (no compare, no stamp)', function () {
        var rq = req({ param: {}, bearer: 'Bearer k-billing-0123456789abcdef' });
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(ctl(), rq, res());
        });
        assert.equal(out, true, 'no authorization declared — the gate is a strict no-op');
        assert.equal(typeof rq.machineCaller, 'undefined', 'no resolution ran');
    });

    it('10. no Bearer presented + machine enabled -> the ordinary 401 (no WWW-Authenticate)', function () {
        var c = ctl(), r = res();
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true } }), r);
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401);
        assert.equal(typeof r.headers['WWW-Authenticate'], 'undefined', 'nothing was presented — the ordinary shape');
    });

    it('11. a non-Bearer Authorization scheme is NOT a machine credential — ordinary path', function () {
        var c = ctl(), r = res();
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, headers: { authorization: 'Basic dXNlcjpwdw==' } }), r);
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401);
        assert.equal(typeof r.headers['WWW-Authenticate'], 'undefined');
    });

    it('12. a whitespace-only Bearer token is treated as NOT presented', function () {
        var c = ctl(), r = res();
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, headers: { authorization: 'Bearer   ' } }), r);
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401);
        assert.equal(typeof r.headers['WWW-Authenticate'], 'undefined', 'degrades to the ordinary path, not the machine 401');
    });

    it('13. a roles-less caller passes requireAuth-only routes but NEVER a role-gated one', function () {
        var okOut = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(ctl(), req({ param: { requireAuth: true }, bearer: 'Bearer k-cron-fedcba9876543210' }), res());
        });
        assert.equal(okOut, true, 'requireAuth-only: authenticated is enough');

        var c = ctl();
        var denyOut;
        captureDebug(function () {
            denyOut = withMachine(null, MACHINE, function () {
                return gate.authorizeRequest(c, req({ param: { roles: ['service'] }, bearer: 'Bearer k-cron-fedcba9876543210' }), res());
            });
        });
        assert.equal(denyOut, false);
        assert.equal(c.thrown.status, 403, 'no roles held -> role-gated denies');
    });

    it('14. enabled with ZERO callers stays fail-closed — a presented token is rejected with the machine 401', function () {
        var c = ctl(), r = res();
        var out = withMachine(null, { enabled: true, callers: {} }, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, bearer: 'Bearer anything' }), r);
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401);
        assert.equal(r.headers['WWW-Authenticate'], 'Bearer', 'presented + rejected -> the machine shape');
    });
});

describe('§04 — crypto properties', function () {

    var KEY     = 'a-32-byte-ish-key-0123456789abcd';
    var MACHINE = { enabled: true, callers: machineCallers({ svc: { key: KEY, roles: [] } }) };

    it('01. wildly unequal token lengths never throw (hash-both-sides normalizes to 32 bytes)', function () {
        ['x', new Array(300).join('y')].forEach(function (token) {
            var c = ctl();
            var out = withMachine(null, MACHINE, function () {
                return gate.authorizeRequest(c, req({ param: { requireAuth: true }, bearer: 'Bearer ' + token }), res());
            });
            assert.equal(out, false, 'rejected, not thrown');
            assert.equal(c.thrown.status, 401);
        });
    });

    it('02. presenting the sha256 HEX of the key does NOT admit — the compare is hash(presented) vs stored hash', function () {
        var hexOfKey = crypto.createHash('sha256').update(KEY, 'utf8').digest('hex');
        var c = ctl();
        var out = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, bearer: 'Bearer ' + hexOfKey }), res());
        });
        assert.equal(out, false, 'knowing the stored hash is worthless — only the raw key admits');
        assert.equal(c.thrown.status, 401);

        // CONTROL — the same fixture admits the real key, so the rejection above is meaningful.
        var out2 = withMachine(null, MACHINE, function () {
            return gate.authorizeRequest(ctl(), req({ param: { requireAuth: true }, bearer: 'Bearer ' + KEY }), res());
        });
        assert.equal(out2, true);
    });

    it('03. the stamped roles are a COPY — mutating them cannot rewrite the registry', function () {
        var callers = machineCallers({ svc: { key: KEY, roles: ['service'] } });
        var machine = { enabled: true, callers: callers };
        var rq = req({ param: { requireAuth: true }, bearer: 'Bearer ' + KEY });
        withMachine(null, machine, function () {
            return gate.authorizeRequest(ctl(), rq, res());
        });
        rq.machineCaller.roles.push('admin');
        assert.deepEqual(callers.svc.roles, ['service'], 'the registry entry is untouched');
    });
});

describe('§05 — #COMPLY2 audit: machine actors and the 401-machine outcome', function () {

    var { beforeEach, afterEach } = require('node:test');

    // The audit module by the SAME deep path the gate requires — the gate's singleton.
    var audit = require(path.join(FW, 'lib/audit/src/main'));

    var dir, file;
    beforeEach(function () {
        dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-authz-machine-audit-'));
        file = path.join(dir, 'audit.jsonl');
        audit.start({ bundle: 'b', env: 'test', file: file });
    });
    afterEach(function () {
        audit._resetForTest();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
    });

    function flush() {
        return new Promise(function (resolve) {
            audit.write('flush.marker', {}, function () { resolve(); });
        });
    }
    function records() {
        return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
            .map(function (l) { return JSON.parse(l); })
            .filter(function (r) { return r.action !== 'flush.marker'; });
    }

    var MACHINE = { enabled: true, callers: machineCallers({ billing: { key: 'k1', roles: ['service'] } }) };

    it('01. an invalid presented Bearer writes outcome "401-machine"', async function () {
        var c = ctl();
        withMachine(null, MACHINE, function () {
            gate.authorizeRequest(c, req({ param: { requireAuth: true }, bearer: 'Bearer WRONG' }), res());
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.equal(recs[0].action, 'authz.denied');
        assert.deepEqual(recs[0].meta, { outcome: '401-machine' });
        assert.deepEqual(recs[0].actor, { key: null, roles: [] }, 'a failed credential has no actor');
        assert.equal(c.thrown.status, 401, 'the denial itself is unchanged');
    });

    it('02. a machine-authenticated write snapshots { key: <name>, roles, machine: true }', async function () {
        var rq = req({ param: { roles: ['admin'] }, bearer: 'Bearer k1' });
        var c  = ctl();
        captureDebug(function () {
            withMachine(null, MACHINE, function () {
                gate.authorizeRequest(c, rq, res());   // authN passes, roles deny -> 403-roles record
            });
        });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.deepEqual(recs[0].meta, { outcome: '403-roles' });
        assert.deepEqual(recs[0].actor, { key: 'billing', roles: ['service'], machine: true },
            'the machine actor: caller NAME as key, configured roles, machine-marked');
    });

    it('03. session wins in the actor derivation too', async function () {
        var rq = req({ param: {}, session: { user: { id: 'u7', roles: ['admin'] } } });
        rq.machineCaller = { name: 'billing', roles: ['service'], machine: true };   // adversarial: both present
        audit.write('doc.updated', { req: rq });
        await flush();
        var recs = records();
        assert.equal(recs.length, 1);
        assert.deepEqual(recs[0].actor, { key: 'u7', roles: ['admin'] },
            'the session user is the actor; no machine flag');
    });
});

describe('§06 — controller: self.hasRole() answers a machine caller\'s configured roles', function () {

    // The controller.test.js §36 framework-globals bootstrap — controller.js
    // cannot cold-require without it (Path 'gina' not found).
    var SuperController;
    function bootstrap() {
        if (SuperController) { return SuperController; }
        process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + FW;
        require('module').Module._initPaths();
        require(path.join(FW, 'helpers'));
        setPath('gina', { core: path.join(FW, 'core') });
        SuperController = require(path.join(FW, 'core/controller/controller'));
        return SuperController;
    }

    it('01. a machine caller\'s roles answer hasRole; a session user still wins', function () {
        var SC = bootstrap();

        var inst = SC.createTestInstance({
            req: { machineCaller: { name: 'billing', roles: ['service'], machine: true } },
            res: {}
        });
        assert.equal(inst.hasRole('service'), true,  'the machine caller holds its configured role');
        assert.equal(inst.hasRole('admin'),   false, 'and no other');

        var inst2 = SC.createTestInstance({
            req: {
                session       : { user: { roles: ['admin'] } },
                machineCaller : { name: 'billing', roles: ['service'], machine: true }
            },
            res: {}
        });
        assert.equal(inst2.hasRole('admin'),   true,  'the session user wins');
        assert.equal(inst2.hasRole('service'), false, 'the machine roles are not consulted when a session user exists');
    });
});

describe('§07 — source pins: the custom authenticator hook', function () {

    it('01. registerAuthenticator is exported and mirrors registerPolicy (AsyncFunction boot-refusal, own registry)', function () {
        assert.match(GATE_SRC, /registerAuthenticator : registerAuthenticator/);
        var blkIdx = GATE_SRC.indexOf('var registerAuthenticator = function');
        assert.ok(blkIdx > -1);
        var blk = GATE_SRC.slice(blkIdx, GATE_SRC.indexOf('module.exports', blkIdx) > -1 ? undefined : undefined).slice(0, 2400);
        assert.ok(blk.indexOf("'authenticators', name + '.js'") > -1, 'the authenticators/ dir resolution');
        assert.ok(blk.indexOf("fn.constructor.name === 'AsyncFunction'") > -1, 'the async refusal');
        assert.match(GATE_SRC, /process\.gina\._authenticators/);
    });

    it('02. map first, hook second — the hook runs only when the map did not authenticate', function () {
        var mapIdx  = GATE_SRC.indexOf('verifyMachineToken(req, mconf, token)');
        var hookIdx = GATE_SRC.indexOf('runAuthenticator(req, mconf.authenticator)');
        assert.ok(mapIdx > -1 && hookIdx > -1);
        assert.ok(mapIdx < hookIdx, 'the built-in map is tried before the custom hook (first success wins)');
        // The hook call is guarded on the principal still being unresolved.
        var between = GATE_SRC.slice(GATE_SRC.lastIndexOf('if ( !principal', hookIdx), hookIdx);
        assert.ok(between.indexOf('!principal') > -1, 'the hook is gated on the map having missed');
    });

    it('03. the hook normalizes + forces the machine marker — it cannot mint a session-shaped identity', function () {
        var blkIdx = GATE_SRC.indexOf('var runAuthenticator = function');
        var blk    = GATE_SRC.slice(blkIdx, blkIdx + 2600);
        assert.ok(blk.indexOf('machine : true') > -1, 'machine: true is forced by the gate, not trusted from the hook');
        assert.ok(blk.indexOf('Array.isArray(returned.roles) ? returned.roles.slice() : []') > -1, 'roles normalized to a copied array');
    });

    it('04. core/server.js lints + registers the authenticator at boot — even while enabled is false', function () {
        assert.match(SERVER_SRC, /auth\.machine\.authenticator` must be a non-empty string/);
        assert.match(SERVER_SRC, /lib\.authzGate\.registerAuthenticator\(_authzSrcPath, _authzMachineConf\.authenticator\)/);
        assert.match(SERVER_SRC, /is missing \(or does not export a function\)/);
    });

    it('05. the template + the schema both declare the authenticator slot, null default', function () {
        var o = parseTemplateSettings(SETTINGS_SRC);
        assert.equal(o.auth.machine.authenticator, null);
        var s = JSON.parse(SCHEMA_SRC);
        var a = s.properties.auth.properties.machine.properties.authenticator;
        assert.deepEqual(a.type, ['string', 'null']);
        assert.equal(a.default, null);
    });
});

describe('§08 — registerAuthenticator against real files (the withPolicyFiles mechanics, authenticators/ dir)', function () {

    function withAuthenticatorFiles(files, fn) {
        var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-authz-authenticators-'));
        fs.mkdirSync(path.join(dir, 'authenticators'));
        Object.keys(files).forEach(function (name) {
            fs.writeFileSync(path.join(dir, 'authenticators', name + '.js'), files[name], 'utf8');
        });
        try { return fn(dir); }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }

    it('01. a plain sync function registers and lands on the registry', function () {
        withAuthenticatorFiles({ ok: 'module.exports = function (req) { return null; };' }, function (dir) {
            var fn = withGina({}, function () {
                var got = gate.registerAuthenticator(dir, 'ok');
                assert.equal(typeof process.gina._authenticators.ok, 'function', 'registered');
                return got;
            });
            assert.equal(typeof fn, 'function');
        });
    });

    it('02. a missing file / a non-function export is unresolved (null) — the boot caller refuses with context', function () {
        withAuthenticatorFiles({ notafn: 'module.exports = { nope: true };' }, function (dir) {
            withGina({}, function () {
                assert.equal(gate.registerAuthenticator(dir, 'missing'), null);
                assert.equal(gate.registerAuthenticator(dir, 'notafn'), null);
            });
        });
    });

    it('03. DECISIVE — an `async function` REFUSES the boot', function () {
        withAuthenticatorFiles({ badasync: 'module.exports = async function (req) { return { name: "x" }; };' }, function (dir) {
            withGina({}, function () {
                assert.throws(function () { gate.registerAuthenticator(dir, 'badasync'); },
                    /async function/, 'the boot-visible tell must refuse');
            });
        });
    });

    it('04. the transpiled-async shape (plain fn returning a promise) is boot-INVISIBLE — why the runtime shape check must stay strict', function () {
        withAuthenticatorFiles({ sneaky: 'module.exports = function (req) { return Promise.resolve({ name: "x" }); };' }, function (dir) {
            withGina({}, function () {
                assert.equal(typeof gate.registerAuthenticator(dir, 'sneaky'), 'function',
                    'registers fine — only the runtime return check catches it (see §09.05)');
            });
        });
    });
});

describe('§09 — behavioural: the hook end-to-end through the gate', function () {

    var KEY     = 'map-key-0123456789abcdef';
    var CALLERS = machineCallers({ mapped: { key: KEY, roles: ['service'] } });

    function ginaShape(authenticators, withMap) {
        return {
            _authConf: { loginRoute: null, machine: {
                enabled       : true,
                callers       : withMap === false ? {} : CALLERS,
                authenticator : 'custom'
            } },
            _authenticators: authenticators
        };
    }

    it('01. the hook admits a caller the map does not know — from a NON-Bearer scheme', function () {
        var rq = req({ param: { requireAuth: true }, headers: { 'x-api-key': 'apik-42' } });
        var out = withGina(ginaShape({
            custom: function (r) {
                return ( r.headers && r.headers['x-api-key'] === 'apik-42' )
                    ? { name: 'partner', roles: ['integrations'] }
                    : null;
            }
        }), function () {
            return gate.authorizeRequest(ctl(), rq, res());
        });
        assert.equal(out, true);
        assert.deepEqual(rq.machineCaller, { name: 'partner', roles: ['integrations'], machine: true },
            'normalized + machine-marked by the gate');
    });

    it('02. map FIRST — a token the map knows never reaches the hook', function () {
        var hookCalls = 0;
        var out = withGina(ginaShape({ custom: function () { ++hookCalls; return { name: 'x' }; } }), function () {
            return gate.authorizeRequest(ctl(), req({ param: { requireAuth: true }, bearer: 'Bearer ' + KEY }), res());
        });
        assert.equal(out, true);
        assert.equal(hookCalls, 0, 'first success wins — the hook was never consulted');
    });

    it('03. a Bearer the map rejects IS handed to the hook; a hook match admits, a hook miss -> the machine 401', function () {
        var out = withGina(ginaShape({
            custom: function (r) {
                var m = /^Bearer\s+(.+)$/i.exec((r.headers && r.headers.authorization) || '');
                return ( m && m[1] === 'jwt-like-token' ) ? { name: 'jwt-caller' } : null;
            }
        }), function () {
            return gate.authorizeRequest(ctl(), req({ param: { requireAuth: true }, bearer: 'Bearer jwt-like-token' }), res());
        });
        assert.equal(out, true, 'the hook admitted what the map could not');

        var c = ctl(), r = res();
        var out2 = withGina(ginaShape({ custom: function () { return null; } }), function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, bearer: 'Bearer nobody-knows-this' }), r);
        });
        assert.equal(out2, false);
        assert.equal(c.thrown.status, 401);
        assert.equal(r.headers['WWW-Authenticate'], 'Bearer', 'Bearer presented + both rejected -> the machine 401');
    });

    it('04. a hook THROW is fail-closed unauthenticated, never a 500 — and a custom-scheme miss stays the ORDINARY 401', function () {
        var c = ctl(), r = res();
        var errs = [];
        var prevErr = console.error;
        console.error = function (m) { errs.push(String(m)); };
        var out;
        try {
            out = withGina(ginaShape({ custom: function () { throw new Error('verifier exploded'); } }), function () {
                // NO Bearer — a custom-scheme request whose verifier dies.
                return gate.authorizeRequest(c, req({ param: { requireAuth: true }, headers: { 'x-api-key': 'x' } }), r);
            });
        } finally { console.error = prevErr; }
        assert.equal(out, false);
        assert.equal(c.thrown.status, 401, 'the ordinary shape — no Bearer was presented');
        assert.equal(typeof r.headers['WWW-Authenticate'], 'undefined', 'the machine 401 stays Bearer-specific');
        assert.ok(errs.join('\n').indexOf('verifier exploded') > -1, 'the throw is logged server-side');
    });

    it('05. a malformed return — including the transpiled-async promise — warns ONCE and stays unauthenticated', function () {
        var warns = [];
        var prevWarn = console.warn;
        console.warn = function (m) { warns.push(String(m)); };
        try {
            [1, 2].forEach(function () {
                var c = ctl();
                var out = withGina(ginaShape({ custom: function () { return Promise.resolve({ name: 'x' }); } }), function () {
                    return gate.authorizeRequest(c, req({ param: { requireAuth: true }, headers: { 'x-api-key': 'x' } }), res());
                });
                assert.equal(out, false, 'a promise is not a principal — fail-closed');
                assert.equal(c.thrown.status, 401);
            });
        } finally { console.warn = prevWarn; }
        var contractWarns = warns.filter(function (w) { return w.indexOf('a promise') > -1; });
        assert.equal(contractWarns.length, 1, 'warned exactly once across repeated requests');
    });

    it('06. roles from the hook normalize — a non-array becomes the empty set (role-gated routes deny)', function () {
        var c = ctl();
        var out;
        captureDebug(function () {
            out = withGina(ginaShape({ custom: function () { return { name: 'p', roles: 'admin' }; } }), function () {
                return gate.authorizeRequest(c, req({ param: { roles: ['admin'] }, headers: { 'x-api-key': 'x' } }), res());
            });
        });
        assert.equal(out, false);
        assert.equal(c.thrown.status, 403, 'authenticated (name valid) but holds NO roles — the string never counts');
    });

    it('07. the hook is NOT consulted while machine auth is disabled (the subtract holds for slice 2 too)', function () {
        var hookCalls = 0;
        var c = ctl();
        var out = withGina({
            _authConf: { loginRoute: null, machine: { enabled: false, callers: {}, authenticator: 'custom' } },
            _authenticators: { custom: function () { ++hookCalls; return { name: 'x' }; } }
        }, function () {
            return gate.authorizeRequest(c, req({ param: { requireAuth: true }, headers: { 'x-api-key': 'x' } }), res());
        });
        assert.equal(out, false);
        assert.equal(hookCalls, 0, 'disabled means disabled — map AND hook');
        assert.equal(c.thrown.status, 401);
    });
});
