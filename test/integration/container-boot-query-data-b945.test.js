/**
 * #B945 / #B952 — how `self.query()` sends its data, in a booted bundle.
 *
 * `query(options, data)` sends `data` as a JSON body for a PUT, POST or PATCH, and in the query
 * string for any other method. Two defects on that path:
 *
 *   - #B945: the query-string branch appended `'?'` and the data to `options.path` with no test
 *     for an existing `?`, so a path that already held a query string (a getRoute() url carrying
 *     a forward's static param or a validator rule's data) went out as `?k=v?x=1`, which a
 *     standard parser reads as `k = 'v?x=1'`; the validator's GET rule sent its data twice in
 *     the url; and the same `?k=v` string also went out as a json-labelled body that a receiver
 *     reads nowhere.
 *   - #B952: a PATCH took that query-string branch too, so its body was the `?k=v` string under
 *     the json label, and a gina receiver answered 500 before the action ran.
 *
 * The scene: one bundle, an echo action recording what reaches it (method, `originalUrl`, the
 * method's data bag, `req.params`, `content-length`, the raw body), reached three ways that all
 * end in `query()`: a `forward` route, a `validator::{ query }` requirement, and a `forward`
 * route with `param.method` set. The DELETE arms copy a common shape: a DELETE route whose url
 * placeholders carry requirements, reached with and without data.
 *
 *   01  controls that hold on both sides of the fix: a direct request, a validator POST rule
 *       (one JSON body, no query string), a forward without data, and every DELETE arm's
 *       handler values (`req.delete`, `req.params`), which the fix must not change
 *   02  #B945: the data joins the path's query string with `&`, travels once, and sends no body
 *       for GET and DELETE; a key the path already holds keeps the path's value
 *   03  #B952: a PATCH sends its data as a JSON body, and the receiver answers
 *
 * Every request carries a client timeout, so a pre-fix run FAILS instead of hanging the suite.
 *
 * Isolation: the container-boot-geturl-choice-b374.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (13050), project:rm + rmSync at teardown. Seam:
 * `B945_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded by THAT tree's
 * CLI (red-first against a pre-fix tree, zero shared-tree touch). The scene's app.json gives the
 * bundle a `proxy` entry for itself, which a same-bundle validator `query` rule needs under
 * `bin/gina-container` (#B950).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-query-data-b945.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert      = require('node:assert/strict');
var net         = require('net');
var http        = require('http');
var https       = require('https');
var fs          = require('fs');
var os          = require('os');
var path        = require('path');
var querystring = require('querystring');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b945-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'uc' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 13050;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B945_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;
var drives = {};


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTcpPortOpen(port) {
    return new Promise(function (resolve) {
        var sock = new net.Socket();
        sock.setTimeout(800);
        sock.on('connect', function () { sock.destroy(); resolve(true); });
        sock.on('error',   function () { resolve(false); });
        sock.on('timeout', function () { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

/**
 * One GET with a client timeout: an unanswered request resolves with
 * `{ status: null, err: 'timeout' }` instead of waiting forever.
 *
 * @inner
 * @param {string} reqPath - path including the webroot
 * @returns {Promise<object>} `{ status, body, json }` or `{ status: null, err }`
 */
function get(reqPath) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: bundlePort, path: reqPath, method: 'GET', rejectUnauthorized: false
        }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
                resolve({ status: res.statusCode, body: data, json: json });
            });
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { resolve({ status: null, err: e.message, body: '', json: null }); });
        req.end();
    });
}

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function isChildAlive() { return child && child.exitCode === null && child.signalCode === null; }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** Adds the rules, the actions and the self-proxy entry this file drives to the scaffold. */
function installScene() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var af = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'app.json');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    var B = '@' + BUNDLE;
    var rule = function (target, method) {
        return 'validator::{ query: { validIf: "$isValid == true", url: "' + target + B + '", method: "' + method + '", data: { name: ":name" } } }';
    };
    // receivers
    r.b945_echo        = { namespace: 'content', url: '/echo',        method: 'GET',    param: { control: 'b945Echo' } };
    r.b945_echo_post   = { namespace: 'content', url: '/echo-post',   method: 'POST',   param: { control: 'b945Echo' } };
    r.b945_echo_patch  = { namespace: 'content', url: '/echo-patch',  method: 'PATCH',  param: { control: 'b945Echo' } };
    r.b945_echo_del    = { namespace: 'content', url: '/echo-del',    method: 'DELETE', param: { control: 'b945Echo' } };
    r.b945_echo_delete = { namespace: 'content', url: '/echo-delete/:grp/:id', method: 'DELETE',
                           requirements: { grp: '/^[a-z0-9]+$/', id: '/^[0-9]+$/' },
                           param: { control: 'b945Echo', grp: ':grp', id: ':id' } };
    r.b945_last        = { namespace: 'content', url: '/last',        method: 'GET',    param: { control: 'b945Last' } };
    // senders: forward routes
    r.b945_fwd         = { namespace: 'content', url: '/fwd',       method: 'GET', param: { control: 'forward', url: 'b945_echo' + B, k: 'v' } };
    r.b945_fwd0        = { namespace: 'content', url: '/fwd0',      method: 'GET', param: { control: 'forward', url: 'b945_echo' + B } };
    r.b945_fwd_patch   = { namespace: 'content', url: '/fwd-patch', method: 'GET', param: { control: 'forward', url: 'b945_echo_patch' + B, method: 'PATCH' } };
    r.b945_fwd_delete  = { namespace: 'content', url: '/fwd-delete', method: 'GET', param: { control: 'forward', url: 'b945_echo_delete' + B, method: 'DELETE', grp: 'g1', id: '42' } };
    // senders: validator `query` requirements
    r.b945_vq_get      = { namespace: 'content', url: '/vq-get/:name',    method: 'GET', requirements: { name: '/^[a-z]+$/i', check: rule('b945_echo', 'GET') },         param: { control: 'b945Ok', name: ':name' } };
    r.b945_vq_post     = { namespace: 'content', url: '/vq-post/:name',   method: 'GET', requirements: { name: '/^[a-z]+$/i', check: rule('b945_echo_post', 'POST') },   param: { control: 'b945Ok', name: ':name' } };
    r.b945_vq_patch    = { namespace: 'content', url: '/vq-patch/:name',  method: 'GET', requirements: { name: '/^[a-z]+$/i', check: rule('b945_echo_patch', 'PATCH') }, param: { control: 'b945Ok', name: ':name' } };
    r.b945_vq_delete   = { namespace: 'content', url: '/vq-delete/:name', method: 'GET', requirements: { name: '/^[a-z]+$/i', check: rule('b945_echo_del', 'DELETE') },  param: { control: 'b945Ok', name: ':name' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var app = JSON.parse(strip(fs.readFileSync(af, 'utf8')));
    app.proxy = app.proxy || {};
    app.proxy[BUNDLE] = { hostname: BUNDLE + '@' + PROJ };
    fs.writeFileSync(af, JSON.stringify(app, null, 2));

    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var actions = [
        '    this.b945Echo = function(req, res) {',
        '        var m = String(req.method || "get").toLowerCase();',
        '        var e = { method: req.method, originalUrl: req.originalUrl, bag: req[m] || null, params: req.params || null,',
        '                  cl: req.headers["content-length"] || null, raw: (typeof(req.rawBody) != "undefined" && req.rawBody != null) ? String(req.rawBody) : null };',
        '        global.__b945 = global.__b945 || []; global.__b945.push(e);',
        '        self.renderJSON({ isValid: true });',
        '    };',
        '    this.b945Last = function(req, res) { self.renderJSON({ seen: global.__b945 || [] }); };',
        '    this.b945Ok = function(req, res) { self.renderJSON({ ok: true }); };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));
}

/**
 * Requests `reqPath` once (memoised per path) and returns the answer plus the echo records the
 * request produced.
 *
 * @inner
 * @param {string} reqPath - path under the webroot, without the leading webroot
 * @returns {Promise<{status: (number|null), err: (string|null), echoed: object[]}>}
 */
async function drive(reqPath) {
    if (drives[reqPath]) { return drives[reqPath]; }
    var before = await get(webroot + 'last');
    var seenBefore = (before.json && before.json.seen) ? before.json.seen.length : 0;
    var r = await get(webroot + reqPath);
    await sleep(200);
    var after = await get(webroot + 'last');
    var seen = (after.json && after.json.seen) || [];
    drives[reqPath] = { status: r.status, err: r.err || null, body: r.body, echoed: seen.slice(seenBefore) };
    return drives[reqPath];
}

/** The one echo record a drive produced, asserted to exist. */
function echoOf(d, label) {
    assert.equal(d.echoed.length, 1, label + ': expected one record at the echo action, got ' + d.echoed.length
        + ' (answer ' + d.status + ': ' + String(d.err || d.body || '').slice(0, 300) + ')');
    return d.echoed[0];
}

/**
 * The query string of a recorded url, parsed by node's own querystring module, copied onto a
 * plain object (querystring.parse() returns one without a prototype, which a strict deepEqual
 * never matches against a literal).
 */
function parsedQuery(e) {
    var u = String(e.originalUrl || '');
    var i = u.indexOf('?');
    return (i > -1) ? Object.assign({}, querystring.parse(u.substring(i + 1))) : {};
}

/** True when the request carried no body. */
function hasNoBody(e) {
    return (e.cl === null || e.cl === '0') && (e.raw === null || e.raw === '');
}


// ---------------------------------------------------------------------------
// 01 – 03 — boot arms
// ---------------------------------------------------------------------------

describe('container-boot-query-data — how self.query() sends its data (#B945, #B952)', function () {

    before(async function () {
        if (process.platform === 'win32') { skip = true; skipReason = 'gina-container is Unix-centric (win32 not supported)'; return; }
        fs.mkdirSync(PROJ_DIR, { recursive: true });

        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        var projectsPath = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJ]) { setupError = 'project:add did not register @' + PROJ; return; }
        runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) { setupError = 'bundle:add did not register ' + key; return; }

        // the project must load the tree under test (the #B422 Franken-boot trap)
        try {
            var target = fs.realpathSync(path.join(PROJ_DIR, 'node_modules', 'gina'));
            if (target !== fs.realpathSync(GINA_ROOT)) { setupError = 'node_modules/gina resolves to ' + target + ', not ' + GINA_ROOT; return; }
        } catch (e) { setupError = 'node_modules/gina is not linked: ' + (e.message || e); return; }

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        scheme = pe.def_scheme || 'http';
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        try { installScene(); } catch (e) { setupError = 'scene install failed: ' + (e.message || e); return; }

        // ONE boot for every arm
        child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', function (d) { childOut += d; });
        child.stderr.on('data', function (d) { childOut += d; });
        child.on('exit', function (code, signal) { childExit = { code: code, signal: signal }; });
        var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
        while (Date.now() < deadline && !childExit) {
            if (await isTcpPortOpen(bundlePort)) { up = true; break; }
            await sleep(POLL_INTERVAL_MS);
        }
        if (!up) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(childExit) + '\n' + childOut.slice(-2000); return; }
        await sleep(300);
    });

    after(async function () {
        if (isChildAlive()) {
            try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
            var until = Date.now() + 4000;
            while (Date.now() < until && isChildAlive()) { await sleep(150); }
            if (isChildAlive()) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
        }
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    function ready(t) {
        if (skip) { t.skip(skipReason); return false; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        return true;
    }

    // ── 01 controls: hold on both sides of the fix ──────────────────────────

    it('01.1  CONTROL — a direct request reaches the echo action with its query', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('echo?x=1'), 'echo?x=1');
        assert.deepEqual(e.bag, { x: '1' });
    });

    it('01.2  CONTROL — a validator POST rule sends one JSON body and no query string', async function (t) {
        if (!ready(t)) return;
        var d = await drive('vq-post/foo?x=1');
        assert.equal(d.status, 200, 'the validator POST route did not answer 200: ' + String(d.body).slice(0, 300));
        var e = echoOf(d, 'vq-post');
        assert.equal(e.method, 'POST');
        assert.equal(e.originalUrl, webroot + 'echo-post');
        assert.deepEqual(e.bag, { name: 'foo', x: '1', check: null });
        assert.equal(e.raw, '{"name":"foo","x":"1","check":null}');
    });

    it('01.3  CONTROL — a forward without data sends no query string and no body', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd0'), 'fwd0');
        assert.equal(e.originalUrl, webroot + 'echo');
        assert.ok(hasNoBody(e), 'a forward without data carried a body: ' + JSON.stringify(e));
    });

    it('01.4  CONTROL — a DELETE without data: the handler reads the url params in req.delete', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd-delete'), 'fwd-delete');
        assert.equal(e.method, 'DELETE');
        assert.equal(e.originalUrl, webroot + 'echo-delete/g1/42');
        assert.deepEqual(e.bag, { grp: 'g1', id: '42' });
        assert.ok(hasNoBody(e), 'a DELETE without data carried a body: ' + JSON.stringify(e));
    });

    it('01.5  CONTROL — a DELETE with data: the handler reads the same values (url params and data)', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd-delete?linked=false'), 'fwd-delete?linked=false');
        assert.deepEqual(e.bag, { grp: 'g1', id: '42', linked: false });
        assert.equal(e.originalUrl, webroot + 'echo-delete/g1/42?linked=false');
    });

    it('01.6  CONTROL — a validator DELETE rule: the handler reads the rule data once', async function (t) {
        if (!ready(t)) return;
        var d = await drive('vq-delete/foo?x=1');
        assert.equal(d.status, 200, 'the validator DELETE route did not answer 200: ' + String(d.body).slice(0, 300));
        var e = echoOf(d, 'vq-delete');
        assert.equal(e.originalUrl, webroot + 'echo-del?name=foo&x=1&check=null');
        assert.deepEqual(e.bag, { name: 'foo', x: '1', check: 'null' });
    });

    // ── 02 #B945 ─────────────────────────────────────────────────────────────

    it('02.1  #B945 — a forward joins its data to the path\'s query string with &', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd?x=1'), 'fwd?x=1');
        assert.equal(e.originalUrl, webroot + 'echo?k=v&x=1');
        assert.deepEqual(parsedQuery(e), { k: 'v', x: '1' }, 'a standard parser must read each value whole');
        assert.deepEqual(e.bag, { k: 'v', x: '1' });
    });

    it('02.2  #B945 — a forwarded GET sends no body', async function (t) {
        if (!ready(t)) return;
        var withStatic = echoOf(await drive('fwd?x=1'), 'fwd?x=1');
        assert.ok(hasNoBody(withStatic), 'the forwarded GET carried a body: ' + JSON.stringify(withStatic));
        var plain = echoOf(await drive('fwd0?x=1'), 'fwd0?x=1');
        assert.equal(plain.originalUrl, webroot + 'echo?x=1');
        assert.ok(hasNoBody(plain), 'the forwarded GET carried a body: ' + JSON.stringify(plain));
    });

    it('02.3  #B945 — a validator GET rule sends its data once, in the query string, with no body', async function (t) {
        if (!ready(t)) return;
        var d = await drive('vq-get/foo?x=1');
        assert.equal(d.status, 200, 'the validator GET route did not answer 200: ' + String(d.body).slice(0, 300));
        var e = echoOf(d, 'vq-get');
        assert.equal(e.originalUrl, webroot + 'echo?name=foo&x=1&check=null');
        assert.deepEqual(parsedQuery(e), { name: 'foo', x: '1', check: 'null' }, 'each key once, each value whole');
        assert.deepEqual(e.bag, { name: 'foo', x: '1', check: null });
        assert.ok(hasNoBody(e), 'the validator GET carried a body: ' + JSON.stringify(e));
    });

    it('02.4  #B945 — a DELETE keeps its data in the query string and sends no body', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd-delete?linked=false'), 'fwd-delete?linked=false');
        assert.ok(hasNoBody(e), 'the DELETE carried a body: ' + JSON.stringify(e));
        var v = echoOf(await drive('vq-delete/foo?x=1'), 'vq-delete');
        assert.ok(hasNoBody(v), 'the validator DELETE carried a body: ' + JSON.stringify(v));
    });

    it('02.5  #B945 — a key the path already holds keeps the path\'s value', async function (t) {
        if (!ready(t)) return;
        var e = echoOf(await drive('fwd?k=other&x=1'), 'fwd?k=other&x=1');
        assert.equal(e.originalUrl, webroot + 'echo?k=v&x=1');
        assert.deepEqual(parsedQuery(e), { k: 'v', x: '1' });
        assert.deepEqual(e.bag, { k: 'v', x: '1' }, 'the forward route\'s static param must reach the target');
    });

    // ── 03 #B952 ─────────────────────────────────────────────────────────────

    it('03.1  #B952 — a validator PATCH rule sends a JSON body, and the receiver answers', async function (t) {
        if (!ready(t)) return;
        var d = await drive('vq-patch/foo?x=1');
        assert.equal(d.status, 200, 'the validator PATCH route did not answer 200: ' + String(d.body).slice(0, 300));
        var e = echoOf(d, 'vq-patch');
        assert.equal(e.method, 'PATCH');
        assert.equal(e.originalUrl, webroot + 'echo-patch');
        assert.equal(e.raw, '{"name":"foo","x":"1","check":null}');
        assert.deepEqual(e.bag, { name: 'foo', x: '1', check: null });
    });

    it('03.2  #B952 — a forward with param.method PATCH relays the data as a JSON body', async function (t) {
        if (!ready(t)) return;
        var d = await drive('fwd-patch?x=1');
        assert.equal(d.status, 200, 'the PATCH forward did not answer 200: ' + String(d.body).slice(0, 300));
        var e = echoOf(d, 'fwd-patch');
        assert.equal(e.method, 'PATCH');
        assert.equal(e.originalUrl, webroot + 'echo-patch');
        assert.equal(e.raw, '{"x":"1"}');
        assert.deepEqual(e.bag, { x: '1' });
    });
});
