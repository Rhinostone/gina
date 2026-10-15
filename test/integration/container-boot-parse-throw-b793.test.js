/**
 * #B793 — an exception thrown while the request data is parsed is answered as a
 * 500, through a booted bundle. It used to reach the process as an
 * uncaughtException, which ends the bundle.
 *
 * No known input makes that parse throw today, so the scene's bundle entry
 * installs TEST DOUBLES over two globals the real parse calls, before
 * `start()`: each throws on a sentinel and is inert otherwise.
 *
 *   formatDataFromString     throws when its string holds `b793fmt`
 *   Object.prototype.count   throws when its receiver has an own key `b793count`
 *
 * The throw is therefore raised inside the real call sites of core/server.js,
 * on the real `'end'` listener, over HTTP/1.1 on the default engine (isaac).
 *
 *   01  what already answered before the guard: a parse exception on a POST or
 *       PATCH body (500), and the custom error page an action's own throwError()
 *       is served — the controls
 *   02  the guard: GET, HEAD, DELETE and a PUT with a JSON body answer 500 with
 *       the incident ref the log pairs with the stack, as JSON for an XHR request
 *       and as the bundle's own error page for an HTML one; the bundle survives
 *
 * Red-first: on a tree without the guard every 02 arm gets no answer and the
 * bundle exits (code 143). Each 02 arm re-boots a dead bundle first, so each is
 * red for its own request rather than for the previous arm's exit.
 *
 * Not covered here: a `multipart/form-data` request. It never runs the guarded
 * call (Busboy's listeners build its fields), and what happens to an exception
 * thrown in one of those listeners depends on the Node.js version.
 *
 * Isolation: the container-boot-request-parsing.test.js shape — a throwaway HOME
 * under os.tmpdir(), its own port window (11400), project:rm + rmSync at
 * teardown. Seam: `B793_GINA_ROOT=<tree>` boots THAT tree's launcher against a
 * project scaffolded by THAT tree's CLI.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-parse-throw-b793.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var https  = require('https');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-pt-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'pt' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11400;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B793_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

var FORM = 'application/x-www-form-urlencoded';
var XHR  = { 'x-requested-with': 'XMLHttpRequest' };
var PAGE_MARK = 'B793-CUSTOM-500';


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

/** One request. Never rejects: no answer within the timeout resolves `{ status: 'NO ANSWER' }`. */
function request(method, reqPath, body, headers) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        var h = Object.assign({}, headers || {});
        if (body != null) { h['content-length'] = Buffer.byteLength(body); }
        var req = lib.request({
            host: '127.0.0.1', port: bundlePort, path: reqPath, method: method,
            headers: h, rejectUnauthorized: false
        }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
                finish({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: data, json: json });
            });
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, function () { finish({ status: 'NO ANSWER', type: '', body: '', json: null }); req.destroy(); });
        req.on('error', function (e) { finish({ status: 'NO ANSWER', err: e.code || e.message, type: '', body: '', json: null }); });
        if (body != null) { req.write(body); }
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

/**
 * Boots the bundle unless it is running and answering. A bundle that is shutting down
 * still reads as alive for a moment, so a live process is probed with a control request,
 * and one that does not answer is given the time to exit before the next boot.
 * Returns false when the bundle did not come up.
 */
async function ensureUp() {
    if (isChildAlive()) {
        var probe = await request('GET', webroot + 'echo?x=plain&y=1', null, XHR);
        if (probe.status === 200) { return true; }
        var gone = Date.now() + 8000;
        while (Date.now() < gone && isChildAlive()) { await sleep(150); }
        if (isChildAlive()) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } await sleep(300); }
    }
    childExit = null;
    var mine = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    child = mine;
    mine.stdout.on('data', function (d) { childOut += d; });
    mine.stderr.on('data', function (d) { childOut += d; });
    mine.on('exit', function (code, signal) { if (child === mine) { childExit = { code: code, signal: signal }; } });
    var deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline && !childExit) {
        if (await isTcpPortOpen(bundlePort)) { await sleep(300); return true; }
        await sleep(POLL_INTERVAL_MS);
    }
    return false;
}

/** The state every arm ends on: the process is up AND a control GET is parsed and answered. */
async function assertAlive(label) {
    await sleep(150);
    assert.ok(isChildAlive(), label + ': the bundle process must survive — exit: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1200));
    var ctl = await request('GET', webroot + 'echo?x=plain&y=1', null, XHR);
    assert.equal(ctl.status, 200, label + ': the control GET must still answer');
    assert.deepEqual(ctl.json.get, { x: 'plain', y: '1' });
}

/**
 * One guarded request: it must be answered 500, with a relayable ref, and the log must
 * pair that ref with the stack of the exception the double raised.
 */
async function assertGuarded(label, method, reqPath, body, headers, doubleName) {
    assert.ok(await ensureUp(), label + ': the bundle did not come up: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1200));
    var mark = childOut.length;
    var r = await request(method, reqPath, body, headers);
    await sleep(250);
    assert.equal(r.status, 500, label + ': a parse exception must be answered 500 — got ' + r.status
        + ' (process alive: ' + isChildAlive() + ', exit: ' + JSON.stringify(childExit) + ')');
    var logged = childOut.slice(mark);
    assert.ok(logged.indexOf('b793 injected: ' + doubleName) > -1, label + ': the log must carry the stack of the exception');
    assert.equal((logged.match(/uncaughtException/g) || []).length, 0, label + ': nothing may reach the process as an uncaughtException');
    return { res: r, logged: logged };
}

/** Routes, an echo action, an action that fails on demand, a custom 500 page and the test doubles. */
function installScene() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var rf = path.join(src, 'config', 'routing.json');
    var cf = path.join(src, 'controllers', 'controller.content.js');
    var xf = path.join(src, 'index.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };

    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (m) {
        r['echo_' + m.toLowerCase()] = { namespace: 'content', url: '/echo', method: m, param: { control: 'echo' } };
    });
    r.boom_get = { namespace: 'content', url: '/boom', method: 'GET', param: { control: 'boom' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var errorsDir = path.join(src, 'templates', 'html', 'errors');
    fs.mkdirSync(errorsDir, { recursive: true });
    fs.writeFileSync(path.join(errorsDir, '500.html'),
        '<!doctype html><html><head><title>t</title></head><body>' + PAGE_MARK + ' status={{ page.data.status }} ref={{ page.data.ref }}</body></html>');

    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var actions = [
        '    this.echo = function(req, res) {',
        '        var show = function (v) { return (typeof v === "undefined") ? "__undefined__" : v; };',
        '        self.renderJSON({ method: req.method, get: show(req.get), post: show(req.post), put: show(req.put) });',
        '    };',
        '    this.boom = function(req, res) {',
        '        return self.throwError(500, new Error("boom from the action"));',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));

    var x = fs.readFileSync(xf, 'utf8');
    var startAnchor = BUNDLE + '.start();';
    if (x.split(startAnchor).length !== 2) { throw new Error('index.js start anchor count ' + (x.split(startAnchor).length - 1)); }
    // The function global is re-assigned when its helper is loaded again, so its double
    // sits behind an accessor that wraps whatever is assigned.
    var doubles = [
        '(function () {',
        '    var guardGlobal = function (name, shouldThrow) {',
        '        var wrap = function (fn) {',
        '            var w = function () {',
        '                if (shouldThrow.apply(null, arguments)) { throw new TypeError("b793 injected: " + name); }',
        '                return fn.apply(this, arguments);',
        '            };',
        '            w.__b793 = true;',
        '            return w;',
        '        };',
        '        var cur = wrap(global[name]);',
        '        Object.defineProperty(global, name, { configurable: true, enumerable: true,',
        '            get: function () { return cur; },',
        '            set: function (fn) { cur = (fn && fn.__b793) ? fn : wrap(fn); } });',
        '    };',
        '    guardGlobal("formatDataFromString", function (s) { return typeof s === "string" && s.indexOf("b793fmt") > -1; });',
        '    var realCount = Object.prototype.count;',
        '    Object.defineProperty(Object.prototype, "count", { writable: true, enumerable: false, configurable: true, value: function () {',
        '        if (this !== null && typeof this === "object" && Object.prototype.hasOwnProperty.call(this, "b793count")) { throw new TypeError("b793 injected: count"); }',
        '        return realCount.apply(this, arguments);',
        '    } });',
        '})();',
        ''
    ].join('\n');
    fs.writeFileSync(xf, x.replace(startAnchor, doubles + startAnchor));
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('25 - container-boot-parse-throw — a parse exception on the request data is answered, the bundle survives (#B793)', function () {

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

        // HTML views: an HTML request is then answered with the bundle's own error page
        var va = runCli(['view:add', BUNDLE, '@' + PROJ]);
        if (!fs.existsSync(path.join(PROJ_DIR, 'src', BUNDLE, 'templates', 'html', 'layouts', 'main.html'))) {
            setupError = 'view:add did not install the templates: ' + (va.stdout + va.stderr).slice(-800); return;
        }
        try { installScene(); } catch (e) { setupError = 'scene install failed: ' + (e.message || e); return; }

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        scheme = pe.def_scheme || 'http';
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        if (!(await ensureUp())) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(childExit) + '\n' + childOut.slice(-2000); }
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

    // ── 01 what already answered: the controls ────────────────────────────

    it('01.1  the doubles are inert without a sentinel: every method parses and answers 200', async function (t) {
        if (!ready(t)) { return; }
        var g = await request('GET', webroot + 'echo?x=plain&y=1', null, XHR);
        assert.equal(g.status, 200); assert.deepEqual(g.json.get, { x: 'plain', y: '1' });
        var p = await request('POST', webroot + 'echo', 'x=plain', Object.assign({ 'content-type': FORM }, XHR));
        assert.equal(p.status, 200); assert.deepEqual(p.json.post, { x: 'plain' });
        var u = await request('PUT', webroot + 'echo', '{"x":"plain"}', Object.assign({ 'content-type': 'application/json' }, XHR));
        assert.equal(u.status, 200); assert.deepEqual(u.json.put, { x: 'plain' });
        var d = await request('DELETE', webroot + 'echo?x=plain', null, XHR);
        assert.equal(d.status, 200);
    });

    it('01.2  a parse exception on a POST or PATCH body was already answered 500', async function (t) {
        if (!ready(t)) { return; }
        var p = await request('POST', webroot + 'echo', 'x=b793fmt', Object.assign({ 'content-type': FORM }, XHR));
        assert.equal(p.status, 500, 'POST');
        var a = await request('PATCH', webroot + 'echo', 'x=b793fmt', Object.assign({ 'content-type': FORM }, XHR));
        assert.equal(a.status, 500, 'PATCH');
        await assertAlive('01.2');
    });

    it('01.3  an action\'s own throwError(500) on an HTML request is served the bundle\'s error page', async function (t) {
        if (!ready(t)) { return; }
        var b = await request('GET', webroot + 'boom', null, { accept: 'text/html' });
        assert.equal(b.status, 500);
        assert.match(b.type, /^text\/html/);
        assert.ok(b.body.indexOf(PAGE_MARK + ' status=500 ref=') > -1, 'the custom page: ' + b.body.slice(0, 200));
    });

    // ── 02 the guard ──────────────────────────────────────────────────────

    it('02.1  GET — a throw at the query count is answered 500 with the ref the log pairs with the stack', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.1', 'GET', webroot + 'echo?b793count=1', null, XHR, 'count');
        assert.match(o.res.type, /^application\/json/);
        assert.equal(o.res.json.status, 500);
        assert.equal(String(o.res.json.error).indexOf('Could not evaluate GET request data.'), 0, 'error: ' + String(o.res.json.error).slice(0, 120));
        assert.match(String(o.res.json.ref), /^[0-9A-F]{6}$/);
        assert.ok(o.logged.indexOf('[ ref ' + o.res.json.ref + ' ]') > -1, 'the pairing line carries the ref the client received');
        await assertAlive('02.1');
    });

    it('02.2  GET — a throw in the query parse, and in the inheritedData parse', async function (t) {
        if (!ready(t)) { return; }
        await assertGuarded('02.2 query', 'GET', webroot + 'echo?x=b793fmt', null, XHR, 'formatDataFromString');
        await assertAlive('02.2 query');
        await assertGuarded('02.2 inheritedData', 'GET', webroot + 'echo?x=1&inheritedData=b793fmt', null, XHR, 'formatDataFromString');
        await assertAlive('02.2 inheritedData');
    });

    it('02.3  HEAD — answered 500 with no body', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.3', 'HEAD', webroot + 'echo?b793count=1', null, XHR, 'count');
        assert.equal(o.res.body, '');
        await assertAlive('02.3');
    });

    it('02.4  DELETE — answered 500', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.4', 'DELETE', webroot + 'echo?b793count=1', null, XHR, 'count');
        assert.equal(String(o.res.json.error).indexOf('Could not evaluate DELETE request data.'), 0);
        await assertAlive('02.4');
    });

    it('02.5  PUT with a JSON body — a throw after the body branch\'s own try is answered 500', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.5', 'PUT', webroot + 'echo', '{"b793count":1}', Object.assign({ 'content-type': 'application/json' }, XHR), 'count');
        assert.equal(String(o.res.json.error).indexOf('Could not evaluate PUT request data.'), 0);
        await assertAlive('02.5');
    });

    it('02.6  an HTML request is served the bundle\'s own error page, with the logged ref', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.6', 'GET', webroot + 'echo?x=b793fmt', null, { accept: 'text/html' }, 'formatDataFromString');
        assert.match(o.res.type, /^text\/html/);
        var m = o.res.body.match(new RegExp(PAGE_MARK + ' status=500 ref=([0-9A-F]{6})'));
        assert.ok(m, 'the custom page: ' + o.res.body.slice(0, 200));
        assert.ok(o.logged.indexOf('[ ref ' + m[1] + ' ]') > -1, 'the page shows the ref of the pairing line');
        await assertAlive('02.6');
    });
});
