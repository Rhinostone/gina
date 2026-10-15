/**
 * #B843 — a throw inside a multipart busboy listener is ANSWERED (500), the bundle survives.
 *
 * The multipart branch of core/server.js attaches its own busboy listeners
 * ('field', 'file', 'finish') and never runs processRequestData, so #B793's guard
 * does not cover it. A throw inside one of those listeners (here: the data helper
 * nestBracketNotationKey, reached from the 'field' listener for a bracket-notation
 * field name) used to reach the process as an uncaughtException and the bundle
 * EXITED (code 143) on Node.js 22; on Node.js 24+ the stream machinery forwarded it
 * to busboy's 'error' listener, which answered a misleading 400 "Malformed
 * multipart/form-data request". The fix wraps the three listeners so a throw is
 * answered 500 "Could not evaluate <METHOD> request data." uniformly across Node
 * versions, with the stack on the log pairing line, and the bundle keeps running.
 *
 * Because the fixed answer is 500 on EVERY Node version, these arms are red-first on
 * both the pre-fix shapes: no answer + exit on Node 22, a 400 on Node 24+.
 *
 * Scope: the arms drive the 'field' listener (the measured gap; no known input makes
 * the 'file'/'finish' listeners throw). All three share the identical wrapper, so the
 * 'field' arms exercise the mechanism; the 'file'/'finish' guards are the same code.
 *
 * Isolation: the container-boot-parse-throw-b793.test.js shape — a throwaway HOME and
 * project under os.tmpdir(), removed in teardown. Seam: B843_GINA_ROOT=<tree> boots
 * THAT tree's launcher, so the arms can run red-first against a pre-fix tree:
 *   B843_GINA_ROOT=/path/to/pre-fix/tree \
 *     node --test test/integration/container-boot-multipart-throw-b843.test.js
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
// Fixture
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b843-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b843pt' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11600;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;

var GINA_ROOT = process.env.B843_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

var XHR       = { 'x-requested-with': 'XMLHttpRequest' };
var PAGE_MARK = 'B843-CUSTOM-500';

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

/** A multipart/form-data body from [name, value] text fields. Returns { body, ct }. */
function multipart(fields) {
    var boundary = '----ginaB843' + STAMP;
    var body = '';
    fields.forEach(function (f) {
        body += '--' + boundary + '\r\n'
             +  'Content-Disposition: form-data; name="' + f[0] + '"\r\n\r\n'
             +  f[1] + '\r\n';
    });
    body += '--' + boundary + '--\r\n';
    return { body: body, ct: 'multipart/form-data; boundary=' + boundary };
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
 * One guarded multipart request: it must be answered 500, with a relayable ref, and the
 * log must pair that ref with the stack of the exception the 'field' listener's double raised.
 */
async function assertGuarded(label, method, fields, headers) {
    assert.ok(await ensureUp(), label + ': the bundle did not come up: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1200));
    var m = multipart(fields);
    var mark = childOut.length;
    var r = await request(method, webroot + 'echo', m.body, Object.assign({ 'content-type': m.ct }, headers || {}));
    await sleep(250);
    assert.equal(r.status, 500, label + ': a multipart listener throw must be answered 500 — got ' + r.status
        + ' (process alive: ' + isChildAlive() + ', exit: ' + JSON.stringify(childExit) + ')');
    var logged = childOut.slice(mark);
    assert.ok(logged.indexOf('b843 injected: nestBracketNotationKey') > -1, label + ': the log must carry the stack of the exception the listener raised');
    assert.equal((logged.match(/uncaughtException/g) || []).length, 0, label + ': nothing may reach the process as an uncaughtException');
    return { res: r, logged: logged };
}

/** Routes, an echo action, a custom 500 page and the 'field'-listener test double. */
function installScene() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var rf = path.join(src, 'config', 'routing.json');
    var cf = path.join(src, 'controllers', 'controller.content.js');
    var xf = path.join(src, 'index.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };

    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (mm) {
        r['echo_' + mm.toLowerCase()] = { namespace: 'content', url: '/echo', method: mm, param: { control: 'echo' } };
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
        '        self.renderJSON({ method: req.method, get: show(req.get), post: show(req.post), put: show(req.put) });',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));

    var x = fs.readFileSync(xf, 'utf8');
    var startAnchor = BUNDLE + '.start();';
    if (x.split(startAnchor).length !== 2) { throw new Error('index.js start anchor count ' + (x.split(startAnchor).length - 1)); }
    // nestBracketNotationKey is a framework global the data helper re-assigns when it
    // is loaded again, so its double sits behind an accessor that re-wraps whatever is
    // assigned (the #B793 harness pattern). It throws when a bracket-notation field name
    // nests through the sentinel key "b843nest" — the path the 'field' listener takes.
    var doubles = [
        '(function () {',
        '    var guardGlobal = function (name, shouldThrow) {',
        '        var wrap = function (fn) {',
        '            var w = function () {',
        '                if (shouldThrow.apply(null, arguments)) { throw new TypeError("b843 injected: " + name); }',
        '                return fn.apply(this, arguments);',
        '            };',
        '            w.__b843 = true;',
        '            return w;',
        '        };',
        '        var cur = wrap(global[name]);',
        '        Object.defineProperty(global, name, { configurable: true, enumerable: true,',
        '            get: function () { return cur; },',
        '            set: function (fn) { cur = (fn && fn.__b843) ? fn : wrap(fn); } });',
        '    };',
        '    guardGlobal("nestBracketNotationKey", function (obj, keys) {',
        '        return keys && typeof keys.indexOf === "function" && keys.indexOf("b843nest") > -1;',
        '    });',
        '})();',
        ''
    ].join('\n');
    fs.writeFileSync(xf, x.replace(startAnchor, doubles + startAnchor));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('26 - container-boot-multipart-throw — a throw in a multipart listener is answered, the bundle survives (#B843)', function () {

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

    // ── 01 the controls: the double is inert without the sentinel ───────────

    it('01.1  a benign multipart body (text fields, no sentinel) is parsed and answered 200', async function (t) {
        if (!ready(t)) { return; }
        var m = multipart([['x', 'plain'], ['a[b]', '1']]);
        var p = await request('POST', webroot + 'echo', m.body, Object.assign({ 'content-type': m.ct }, XHR));
        assert.equal(p.status, 200, 'POST benign multipart');
        assert.deepEqual(p.json.post, { x: 'plain', a: { b: '1' } });
        var u = await request('PUT', webroot + 'echo', m.body, Object.assign({ 'content-type': m.ct }, XHR));
        assert.equal(u.status, 200, 'PUT benign multipart');
        await assertAlive('01.1');
    });

    // ── 02 the guard: a 'field'-listener throw is answered 500 ──────────────

    it('02.1  POST — a throw in the \'field\' listener is answered 500 with the ref the log pairs with the stack', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.1', 'POST', [['x', 'plain'], ['b843nest[a]', '1']], XHR);
        assert.match(o.res.type, /^application\/json/);
        assert.equal(o.res.json.status, 500);
        assert.equal(String(o.res.json.error).indexOf('Could not evaluate POST request data.'), 0, 'error: ' + String(o.res.json.error).slice(0, 120));
        assert.match(String(o.res.json.ref), /^[0-9A-F]{6}$/);
        assert.ok(o.logged.indexOf('[ ref ' + o.res.json.ref + ' ]') > -1, 'the pairing line carries the ref the client received');
        await assertAlive('02.1');
    });

    it('02.2  PUT — a throw in the \'field\' listener is answered 500', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.2', 'PUT', [['b843nest[a]', '1']], XHR);
        assert.equal(String(o.res.json.error).indexOf('Could not evaluate PUT request data.'), 0);
        await assertAlive('02.2');
    });

    it('02.3  an HTML request is served the bundle\'s own error page, with the logged ref', async function (t) {
        if (!ready(t)) { return; }
        var o = await assertGuarded('02.3', 'POST', [['b843nest[a]', '1']], { accept: 'text/html' });
        assert.match(o.res.type, /^text\/html/);
        var m = o.res.body.match(new RegExp(PAGE_MARK + ' status=500 ref=([0-9A-F]{6})'));
        assert.ok(m, 'the custom page: ' + o.res.body.slice(0, 200));
        assert.ok(o.logged.indexOf('[ ref ' + m[1] + ' ]') > -1, 'the page shows the ref of the pairing line');
        await assertAlive('02.3');
    });
});
