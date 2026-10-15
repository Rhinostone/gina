/**
 * #B844 — an exception raised in a callback NESTED in a multipart file part is answered or
 * logged, and the bundle keeps running. Also the two listeners #B843's test did not drive.
 *
 * #B843 wrapped the three Busboy listeners of the multipart branch (core/server.js). The
 * 'file' listener only REGISTERS the callbacks that do the work of a file part: the write
 * stream's 'error' and 'finish' handlers, the close callback, the file stream's 'end'
 * handler and the cleanup timer's callback. They ran outside the wrapper, so an exception
 * raised in one of them reached the process and the bundle exited (code 143) on Node.js 22,
 * 24, 25 and 26. The request of an upload is handed to its action from the close callback, so the
 * same exception that was answered 500 for a body without a file ended the bundle for a
 * body with one. #B844 runs the five callbacks under the same wrapper.
 *
 * No request is known to make these callbacks raise: the arms use TEST DOUBLES that raise
 * INSIDE the framework's own statements (a call the callback makes, a read it performs),
 * armed by a field of the request. Arms:
 *   01    controls — an upload with the doubles installed and not armed
 *   02    the 'file' listener and the end-of-body listener (#B843's guard; its own test
 *         drives the 'field' listener only)
 *   03    the nested callbacks (#B844)
 *
 * Red-first: the 03 arms fail on a tree without #B844, the 02 arms on a tree without #B843.
 * Seam: B844_GINA_ROOT=<tree> boots THAT tree's launcher:
 *   B844_GINA_ROOT=/path/to/pre-fix/tree \
 *     node --test test/integration/container-boot-multipart-nested-throw-b844.test.js
 *
 * Isolation: the container-boot-multipart-throw-b843.test.js shape — a throwaway HOME and
 * project under os.tmpdir(), removed in teardown.
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b844-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b844pt' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11650;

var BOOT_TIMEOUT_MS    = 25000;
var POLL_INTERVAL_MS   = 250;
var REQUEST_TIMEOUT_MS = 5000;
var CLEANUP_TIMEOUT    = '300ms';   // upload.autoTmpCleanupTimeout of the throwaway bundle
var AFTER_CLEANUP_MS   = 1300;      // long enough for that timer to have run

var GINA_ROOT = process.env.B844_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, scheme = 'http', webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

var XHR       = { 'x-requested-with': 'XMLHttpRequest' };
var PAGE_MARK = 'B844-CUSTOM-500';
var FILE      = ['f', 'hello', 'ok.txt'];

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

/** One HTTP request. Never rejects: a request that gets no answer resolves `status: 'NO ANSWER'`. */
function request(method, reqPath, body, headers) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function (resolve) {
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        var h = Object.assign({}, headers || {});
        if (body != null) { h['content-length'] = Buffer.byteLength(body); }
        var req = lib.request({ host: '127.0.0.1', port: bundlePort, path: reqPath, method: method, headers: h, rejectUnauthorized: false }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { json = null; }
                finish({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: data, json: json });
            });
            res.on('error', function (e) { finish({ status: 'NO ANSWER', err: e.code || e.message, type: '', body: data, json: null }); });
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, function () { finish({ status: 'NO ANSWER', type: '', body: '', json: null }); req.destroy(); });
        req.on('error', function (e) { finish({ status: 'NO ANSWER', err: e.code || e.message, type: '', body: '', json: null }); });
        if (body != null) { req.write(body); }
        req.end();
    });
}

/** A multipart/form-data body from [name, value] text fields and [name, content, filename] files. */
function multipart(fields) {
    var boundary = '----ginaB844' + STAMP;
    var body = '';
    fields.forEach(function (f) {
        body += '--' + boundary + '\r\n'
             +  'Content-Disposition: form-data; name="' + f[0] + '"' + (f.length > 2 ? '; filename="' + f[2] + '"\r\nContent-Type: text/plain' : '') + '\r\n\r\n'
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

/** One multipart POST to the echo action; returns the answer and what the bundle logged for it. */
async function drive(label, fields, headers, settleMs) {
    assert.ok(await ensureUp(), label + ': the bundle did not come up: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1200));
    var m = multipart(fields);
    var mark = childOut.length;
    var r = await request('POST', webroot + 'echo', m.body, Object.assign({ 'content-type': m.ct }, headers || XHR));
    await sleep(settleMs || 400);
    return { res: r, logged: childOut.slice(mark) };
}

function assertNoUncaught(label, logged) {
    assert.equal((logged.match(/uncaughtException/g) || []).length, 0, label + ': nothing may reach the process as an uncaughtException');
}

/** The guard's own answer: a 500 with a relayable ref that the log pairs with the raised exception. */
function assertGuardAnswer(label, o, raised) {
    assert.equal(o.res.status, 500, label + ': the request must be answered 500 — got ' + o.res.status
        + ' (process alive: ' + isChildAlive() + ', exit: ' + JSON.stringify(childExit) + ')');
    assert.match(o.res.type, /^application\/json/);
    assert.equal(o.res.json.status, 500);
    assert.equal(String(o.res.json.error).indexOf('Could not evaluate POST request data.'), 0, 'error: ' + String(o.res.json.error).slice(0, 120));
    assert.match(String(o.res.json.ref), /^[0-9A-F]{6}$/);
    assert.ok(o.logged.indexOf('[ ref ' + o.res.json.ref + ' ]') > -1, label + ': the pairing line carries the ref the client received');
    assert.ok(o.logged.indexOf(raised) > -1, label + ': the log must carry the exception that was raised (' + raised + ')');
    assertNoUncaught(label, o.logged);
}

/** Routes, an echo action, a custom 500 page, the cleanup timer and the test doubles. */
function installScene() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var rf = path.join(src, 'config', 'routing.json');
    var sf = path.join(src, 'config', 'settings.json');
    var cf = path.join(src, 'controllers', 'controller.content.js');
    var xf = path.join(src, 'index.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };

    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    ['GET', 'POST'].forEach(function (mm) {
        r['echo_' + mm.toLowerCase()] = { namespace: 'content', url: '/echo', method: mm, param: { control: 'echo' } };
    });
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    // the cleanup timer is armed for every staged file of this bundle
    var st = fs.readFileSync(sf, 'utf8');
    if (st.indexOf('"upload"') > -1) { throw new Error('settings.json already holds an upload block'); }
    fs.writeFileSync(sf, st.replace('{', '{\n    "upload": { "autoTmpCleanupTimeout": "' + CLEANUP_TIMEOUT + '" },'));

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
        '        var files = req.files || [];',
        '        self.renderJSON({ method: req.method, get: show(req.get), post: show(req.post), nf: files.length, fp: files[0] ? files[0].path : null });',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, actions + anchor));

    var x = fs.readFileSync(xf, 'utf8');
    var startAnchor = BUNDLE + '.start();';
    if (x.split(startAnchor).length !== 2) { throw new Error('index.js start anchor count ' + (x.split(startAnchor).length - 1)); }
    // The doubles. A bracket-notation text field named b844<arm>[…] arms the NEXT file part
    // (the 'field' listener nests it through the nestBracketNotationKey global, which the
    // data helper re-assigns when it is loaded again: hence the accessor that re-wraps).
    //   file   fs.createWriteStream raises            -> inside the 'file' listener
    //   close  the stream's close() raises            -> inside the write stream's 'finish' handler
    //   werr   the stream errors, then close() raises -> inside its 'error' handler, after the handler's own answer
    //   end    request.files.push raises              -> inside the file stream's 'end' handler
    //   timer  new _(<staged path>) raises            -> inside the cleanup timer's callback
    // Two body keys act where the end-of-body listener assigns request.body:
    //   b844finish   that assignment raises           -> inside the end-of-body listener
    //   b844handoff  the next read of request.url raises, once -> inside the hand-off to the action
    var doubles = [
        '(function () {',
        '    var arm = null, timerPath = null;',
        '    var wrapNest = function (fn) {',
        '        var w = function (obj, keys) {',
        '            if (keys && typeof keys.indexOf === "function") { ["file", "close", "werr", "end", "timer"].forEach(function (k) { if (keys.indexOf("b844" + k) > -1) { arm = k; } }); }',
        '            return fn.apply(this, arguments);',
        '        };',
        '        w.__b844 = true;',
        '        return w;',
        '    };',
        '    var curNest = wrapNest(global.nestBracketNotationKey);',
        '    Object.defineProperty(global, "nestBracketNotationKey", { configurable: true, enumerable: true,',
        '        get: function () { return curNest; },',
        '        set: function (fn) { curNest = (fn && fn.__b844) ? fn : wrapNest(fn); } });',
        '    var fsMod = require("fs"), realCWS = fsMod.createWriteStream;',
        '    fsMod.createWriteStream = function () {',
        '        if (arm === "file") { arm = null; throw new TypeError("b844 injected: createWriteStream"); }',
        '        var ws = realCWS.apply(this, arguments);',
        '        if (arm === "close" || arm === "werr") {',
        '            var how = arm; arm = null;',
        '            ws.close = function () { delete ws.close; throw new TypeError("b844 injected: write stream close call (" + how + ")"); };',
        '            if (how === "werr") { setImmediate(function () { ws.destroy(new Error("b844 simulated write error")); }); }',
        '        }',
        '        return ws;',
        '    };',
        '    var IMP = require("http").IncomingMessage.prototype, bodyStore = new WeakMap(), filesStore = new WeakMap();',
        '    Object.defineProperty(IMP, "body", { configurable: true, enumerable: false,',
        '        get: function () { return bodyStore.get(this); },',
        '        set: function (v) {',
        '            var has = function (k) { return v !== null && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, k); };',
        '            if (has("b844finish")) { throw new TypeError("b844 injected: end-of-body listener"); }',
        '            if (has("b844handoff")) {',
        '                var rq = this, realUrl = rq.url, fired = false;',
        '                Object.defineProperty(rq, "url", { configurable: true, enumerable: true,',
        '                    get: function () { if (!fired) { fired = true; throw new TypeError("b844 injected: hand-off"); } return realUrl; },',
        '                    set: function (nv) { realUrl = nv; } });',
        '            }',
        '            bodyStore.set(this, v);',
        '        } });',
        '    Object.defineProperty(IMP, "files", { configurable: true, enumerable: false,',
        '        get: function () {',
        '            var a = filesStore.get(this);',
        '            if (a && (arm === "end" || arm === "timer")) {',
        '                var how = arm; arm = null;',
        '                a.push = function (rec) {',
        '                    delete a.push;',
        '                    if (how === "end") { throw new TypeError("b844 injected: file end handler"); }',
        '                    timerPath = rec && rec.path;',
        '                    return Array.prototype.push.apply(a, arguments);',
        '                };',
        '            }',
        '            return a;',
        '        },',
        '        set: function (v) { filesStore.set(this, v); } });',
        '    var wrapPath = function (fn) {',
        '        if (typeof fn !== "function" || fn.__b844) { return fn; }',
        '        return new Proxy(fn, {',
        '            construct: function (target, args, nt) {',
        '                if (timerPath && args[0] === timerPath) { timerPath = null; throw new TypeError("b844 injected: cleanup timer callback"); }',
        '                return Reflect.construct(target, args, nt);',
        '            },',
        '            get: function (target, prop, recv) { return (prop === "__b844") ? true : Reflect.get(target, prop, recv); }',
        '        });',
        '    };',
        '    var curPath = wrapPath(global._);',
        '    Object.defineProperty(global, "_", { configurable: true, enumerable: true,',
        '        get: function () { return curPath; },',
        '        set: function (fn) { curPath = wrapPath(fn); } });',
        '})();',
        ''
    ].join('\n');
    fs.writeFileSync(xf, x.replace(startAnchor, doubles + startAnchor));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('27 - container-boot-multipart-nested-throw — an exception in a callback nested in a file part is answered, the bundle survives (#B844)', function () {

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

    // ── 01 the control: the doubles are inert when they are not armed ────────

    it('01.1  an upload with no armed double is answered 200, and the cleanup timer removes the staged file', async function (t) {
        if (!ready(t)) { return; }
        var o = await drive('01.1', [['x', 'plain'], ['a[b]', '1'], FILE], XHR, AFTER_CLEANUP_MS);
        assert.equal(o.res.status, 200, 'POST upload');
        assert.deepEqual(o.res.json.post, { x: 'plain', a: { b: '1' } });
        assert.equal(o.res.json.nf, 1, 'the action saw one file record');
        assert.equal(typeof o.res.json.fp, 'string');
        assert.equal(fs.existsSync(o.res.json.fp), false, 'the timer callback ran with its argument: the staged file is gone (' + o.res.json.fp + ')');
        assertNoUncaught('01.1', o.logged);
        await assertAlive('01.1');
    });

    // ── 02 the two listeners #B843's own test does not drive ─────────────────

    it('02.1  an exception in the \'file\' listener is answered 500 with the ref the log pairs with the stack', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('02.1', await drive('02.1', [['b844file[a]', '1'], FILE]), 'b844 injected: createWriteStream');
        await assertAlive('02.1');
    });

    it('02.2  an exception in the end-of-body listener is answered 500', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('02.2', await drive('02.2', [['b844finish', '1'], ['x', 'plain']]), 'b844 injected: end-of-body listener');
        await assertAlive('02.2');
    });

    // ── 03 the callbacks nested in a file part (#B844) ───────────────────────

    it('03.1  the hand-off of a request that carries a file: an exception in it is answered 500', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('03.1', await drive('03.1', [['b844handoff', '1'], FILE]), 'b844 injected: hand-off');
        await assertAlive('03.1');
    });

    it('03.2  CONTROL — the same hand-off exception without a file is answered 500 as well', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('03.2', await drive('03.2', [['b844handoff', '1'], ['x', 'plain']]), 'b844 injected: hand-off');
        await assertAlive('03.2');
    });

    it('03.3  an exception in the write stream\'s \'finish\' handler is answered 500', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('03.3', await drive('03.3', [['b844close[a]', '1'], FILE]), 'b844 injected: write stream close call (close)');
        await assertAlive('03.3');
    });

    it('03.4  an exception in the file stream\'s \'end\' handler is answered 500', async function (t) {
        if (!ready(t)) { return; }
        assertGuardAnswer('03.4', await drive('03.4', [['b844end[a]', '1'], FILE]), 'b844 injected: file end handler');
        await assertAlive('03.4');
    });

    it('03.5  an exception in the write stream\'s \'error\' handler, after its own answer: no second answer, the stack is logged', async function (t) {
        if (!ready(t)) { return; }
        var o = await drive('03.5', [['b844werr[a]', '1'], FILE], XHR, 900);
        assert.equal(o.res.status, 500, 'the handler\'s own answer');
        assert.equal(String(o.res.json.error).indexOf('Internal server error'), 0, 'error: ' + String(o.res.json.error).slice(0, 120));
        assert.ok(o.logged.indexOf('[ onListenerThrow ] not answered: ') > -1, 'the guard logs that it did not answer');
        assert.ok(o.logged.indexOf('b844 injected: write stream close call (werr)') > -1, 'with the exception that was raised');
        assertNoUncaught('03.5', o.logged);
        await assertAlive('03.5');
    });

    it('03.6  an exception in the cleanup timer\'s callback, after the request was answered: it is logged', async function (t) {
        if (!ready(t)) { return; }
        var o = await drive('03.6', [['b844timer[a]', '1'], FILE], XHR, AFTER_CLEANUP_MS);
        assert.equal(o.res.status, 200, 'the upload itself is answered');
        assert.equal(o.res.json.nf, 1);
        assert.ok(o.logged.indexOf('b844 injected: cleanup timer callback') > -1, 'the timer callback ran and raised');
        assert.ok(o.logged.indexOf('[ onListenerThrow ] not answered: ') > -1, 'the guard logs that nothing answers');
        assertNoUncaught('03.6', o.logged);
        await assertAlive('03.6');
    });

    it('03.7  an HTML request is served the bundle\'s own error page, with the logged ref', async function (t) {
        if (!ready(t)) { return; }
        var o = await drive('03.7', [['b844handoff', '1'], FILE], { accept: 'text/html' });
        assert.equal(o.res.status, 500, '03.7: got ' + o.res.status + ' (process alive: ' + isChildAlive() + ')');
        assert.match(o.res.type, /^text\/html/);
        var m = o.res.body.match(new RegExp(PAGE_MARK + ' status=500 ref=([0-9A-F]{6})'));
        assert.ok(m, 'the custom page: ' + o.res.body.slice(0, 200));
        assert.ok(o.logged.indexOf('[ ref ' + m[1] + ' ]') > -1, 'the page shows the ref of the pairing line');
        assertNoUncaught('03.7', o.logged);
        await assertAlive('03.7');
    });
});
