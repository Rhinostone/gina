/**
 * #B842 — on an HTML request, an exception raised while the framework dispatches the bundle's
 * custom error page is answered with the built-in error page, through a booted bundle with views.
 * It used to call throwError again for the same request, which dispatched the page again: the cycle
 * ran until the call stack overflowed and the bundle exited (code 143), with no answer sent.
 *
 * No known input makes that dispatch raise, so the scene's bundle entry installs TEST DOUBLES over
 * two globals before `start()`; each throws on a sentinel and is inert otherwise:
 *
 *   formatDataFromString     throws when its string holds `b842fmt`
 *   Object.prototype.count   throws when its receiver has an own key `b842count`
 *
 * A body holding the key `b842count` makes the body parse raise (answered by its own catch through
 * throwError, which dispatches the custom 500 page), and building the error-page controller raises
 * again on the same request data: that second raise is the re-entry. A body holding the value
 * `b842fmt` makes the parse raise without the second one — the page is dispatched and rendered.
 *
 *   01  controls: the doubles are inert without a sentinel; a parse exception whose error-page
 *       dispatch does not raise is still served the bundle's custom page
 *   02  the re-entry: POST with a form body, POST with a JSON body and PATCH with a form body, each
 *       holding the key: answered 500 with the built-in page and a ref the log pairs, no
 *       uncaughtException, the bundle survives
 *
 * Red-first: on a tree without the fix every 02 arm gets no answer and the bundle exits (code 143).
 * Each 02 arm re-boots a dead bundle first, so each is red for its own request.
 *
 * Isolation: the container-boot-parse-throw-b793.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (11700), project:rm + rmSync at teardown. Seam:
 * `B842_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded by THAT tree's CLI.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-error-page-reentry-b842.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-epr-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'epr' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11700;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B842_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

var FORM = 'application/x-www-form-urlencoded';
var JSON_TYPE = 'application/json';
var XHR  = { 'x-requested-with': 'XMLHttpRequest' };
var PAGE_MARK = 'B842-CUSTOM-500';


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

/** Sends one HTML request on a bundle that is up; returns the answer and the log lines it produced. */
async function send(label, method, body, contentType) {
    assert.ok(await ensureUp(), label + ': the bundle did not come up: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1200));
    var mark = childOut.length;
    var r = await request(method, webroot + 'echo', body, { 'content-type': contentType });
    await sleep(250);
    return { res: r, logged: childOut.slice(mark) };
}

/**
 * One request whose error-page dispatch raises: it must be answered 500 with the built-in page,
 * under a ref the log pairs, with nothing reaching the process as an uncaughtException.
 */
async function assertBuiltIn(label, method, body, contentType) {
    var o = await send(label, method, body, contentType);
    assert.equal(o.res.status, 500, label + ': the request must be answered 500 — got ' + o.res.status
        + ' (process alive: ' + isChildAlive() + ', exit: ' + JSON.stringify(childExit) + ')');
    assert.match(o.res.type, /^text\/html/);
    assert.ok(o.res.body.indexOf('<h1>Error 500.</h1>') > -1, label + ': the built-in page: ' + o.res.body.slice(0, 200));
    assert.equal(o.res.body.indexOf(PAGE_MARK), -1, label + ': not the custom page');
    var m = o.res.body.match(/ref ([0-9A-F]{6})<\/pre>/);
    assert.ok(m, label + ': the built-in page carries a ref');
    assert.ok(o.logged.indexOf('[ ref ' + m[1] + ' ]') > -1, label + ': the log pairs the ref the client received');
    assert.ok(o.logged.indexOf('b842 injected: count') > -1, label + ': the log carries the exception the double raised');
    assert.equal((o.logged.match(/uncaughtException/g) || []).length, 0, label + ': nothing may reach the process as an uncaughtException');
    // Distinct refs, not matches: with GINA_LOG_STDOUT the bundle writes one JSON record per line,
    // and a record carries its text twice (`message` and the back-compat `msg` field).
    var refs = {};
    (o.logged.match(/\[ ref [0-9A-F]{6} \]/g) || []).forEach(function (s) { refs[s] = true; });
    var pairs = Object.keys(refs).length;
    assert.equal(pairs, 2, label + ': one pairing line for the parse exception and one for the dispatch — got ' + pairs);
    return o;
}

/** Routes, an echo action, a custom 500 page and the test doubles. */
function installScene() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var rf = path.join(src, 'config', 'routing.json');
    var cf = path.join(src, 'controllers', 'controller.content.js');
    var xf = path.join(src, 'index.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };

    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    ['GET', 'POST', 'PATCH'].forEach(function (m) {
        r['echo_' + m.toLowerCase()] = { namespace: 'content', url: '/echo', method: m, param: { control: 'echo' } };
    });
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
        '        self.renderJSON({ method: req.method, get: show(req.get), post: show(req.post), patch: show(req.patch) });',
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
        '                if (shouldThrow.apply(null, arguments)) { throw new TypeError("b842 injected: " + name); }',
        '                return fn.apply(this, arguments);',
        '            };',
        '            w.__b842 = true;',
        '            return w;',
        '        };',
        '        var cur = wrap(global[name]);',
        '        Object.defineProperty(global, name, { configurable: true, enumerable: true,',
        '            get: function () { return cur; },',
        '            set: function (fn) { cur = (fn && fn.__b842) ? fn : wrap(fn); } });',
        '    };',
        '    guardGlobal("formatDataFromString", function (s) { return typeof s === "string" && s.indexOf("b842fmt") > -1; });',
        '    var realCount = Object.prototype.count;',
        '    Object.defineProperty(Object.prototype, "count", { writable: true, enumerable: false, configurable: true, value: function () {',
        '        if (this !== null && typeof this === "object" && Object.prototype.hasOwnProperty.call(this, "b842count")) { throw new TypeError("b842 injected: count"); }',
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

describe('28 - container-boot-error-page-reentry — an error-page dispatch that raises is answered with the built-in page, the bundle survives (#B842)', function () {

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

        // HTML views: an HTML request is then answered through the bundle's error pages
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

    // ── 01 controls ───────────────────────────────────────────────────────

    it('01.1  the doubles are inert without a sentinel: GET, POST and PATCH parse and answer 200', async function (t) {
        if (!ready(t)) { return; }
        var g = await request('GET', webroot + 'echo?x=plain&y=1', null, XHR);
        assert.equal(g.status, 200); assert.deepEqual(g.json.get, { x: 'plain', y: '1' });
        var p = await request('POST', webroot + 'echo', 'x=plain', { 'content-type': FORM });
        assert.equal(p.status, 200); assert.deepEqual(p.json.post, { x: 'plain' });
        var a = await request('PATCH', webroot + 'echo', 'x=plain', { 'content-type': FORM });
        assert.equal(a.status, 200);
    });

    it('01.2  a parse exception whose error-page dispatch does not raise is served the bundle\'s custom page', async function (t) {
        if (!ready(t)) { return; }
        var o = await send('01.2', 'POST', 'x=b842fmt', FORM);
        assert.equal(o.res.status, 500);
        assert.match(o.res.type, /^text\/html/);
        var m = o.res.body.match(new RegExp(PAGE_MARK + ' status=500 ref=([0-9A-F]{6})'));
        assert.ok(m, 'the custom page: ' + o.res.body.slice(0, 200));
        assert.ok(o.logged.indexOf('[ ref ' + m[1] + ' ]') > -1, 'the page shows the ref of the pairing line');
        await assertAlive('01.2');
    });

    // ── 02 the re-entry ───────────────────────────────────────────────────

    it('02.1  POST with a form body — answered 500 with the built-in page', async function (t) {
        if (!ready(t)) { return; }
        await assertBuiltIn('02.1', 'POST', 'b842count=1', FORM);
        await assertAlive('02.1');
    });

    it('02.2  POST with a JSON body — answered 500 with the built-in page', async function (t) {
        if (!ready(t)) { return; }
        await assertBuiltIn('02.2', 'POST', '{"b842count":1}', JSON_TYPE);
        await assertAlive('02.2');
    });

    it('02.3  PATCH with a form body — answered 500 with the built-in page', async function (t) {
        if (!ready(t)) { return; }
        await assertBuiltIn('02.3', 'PATCH', 'b842count=1', FORM);
        await assertAlive('02.3');
    });
});
