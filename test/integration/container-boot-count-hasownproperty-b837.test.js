/**
 * #B837 — a request field named `hasOwnProperty` reaches the action like any
 * other field, through a booted bundle.
 *
 * The request pipeline gates its containers on an own-key count: the GET, HEAD and
 * DELETE branches hand the parsed query over as `req.get` / `req.delete` only when
 * it holds at least one key, and the POST and PATCH branches set `req.body` to the
 * parsed object only when that object holds one. The count is gina's
 * `Object.prototype.count()` helper, which counted with `this.hasOwnProperty(prop)`:
 * a field named `hasOwnProperty` shadowed that method, the call threw on the first
 * key, the helper's catch returned 0, and the action received `req.get` /
 * `req.delete` empty and `req.body` as the raw body string, with no error. This
 * file boots the REAL `bin/gina-container` against a scaffolded project carrying
 * an `/echo` route that reports what the action received, and drives it over
 * HTTP/1.1 on the default engine (isaac):
 *
 *   01  GET: every field arrives in `req.get`, the field first or last
 *   02  HEAD on the GET rule: the same keys, reported in a response header
 *   03  DELETE: every field arrives in `req.delete`
 *   04  POST, urlencoded: `req.body` is the parsed object `req.post` holds
 *   05  POST, JSON: the same
 *   06  PATCH, urlencoded: `req.body` is the parsed object `req.patch` holds
 *   07  the bundle served every request and is still up
 *
 * Every cell has a control (`a=1&b=2`) and a near-miss name (`hasOwnPropertyX`) that
 * read the same before and after the fix. PUT is not driven here: it loses the field
 * through a separate path.
 *
 * Isolation: the container-boot-request-parsing.test.js shape — a throwaway HOME
 * under os.tmpdir(), its own port window (11750), project:rm + rmSync at teardown.
 * Seam: `B837_GINA_ROOT=<tree>` boots THAT tree's launcher against a project
 * scaffolded by THAT tree's CLI (red-first against another worktree, no shared-tree
 * touch).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-count-hasownproperty-b837.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync, spawn } = require('child_process');


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b837-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'hop' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11750;

var BOOT_TIMEOUT_MS  = 25000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B837_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

var FORM = 'application/x-www-form-urlencoded';
var JSONT = 'application/json';


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

/** One request; resolves with the status, the raw body, the parsed JSON and the headers. */
function request(method, reqPath, body, contentType) {
    return new Promise(function (resolve) {
        var headers = {};
        if (body != null) { headers['content-type'] = contentType; headers['content-length'] = Buffer.byteLength(body); }
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: reqPath, method: method, headers: headers }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () {
                var json = null;
                try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
                resolve({ status: res.statusCode, body: data, json: json, headers: res.headers });
            });
        });
        req.setTimeout(8000, function () { req.destroy(new Error('no answer within 8 s')); });
        req.on('error', function (e) { resolve({ status: null, err: e.message, body: '', json: null, headers: {} }); });
        if (body != null) { req.write(body); }
        req.end();
    });
}

function echo(method, rawQuery)         { return request(method, webroot + 'echo?' + rawQuery); }
function send(method, body, type)       { return request(method, webroot + 'echo', body, type); }

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function isChildAlive() { return child && child.exitCode === null && child.signalCode === null; }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function show(r) { return r.status + ' ' + String(r.body).slice(0, 300); }

/** Adds the echo routes and action to the scaffold. HEAD is served by the GET rule. */
function installEchoRoute() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    ['GET', 'POST', 'PATCH', 'DELETE'].forEach(function (m) {
        r['echo_' + m.toLowerCase()] = { namespace: 'content', url: '/echo', method: m, param: { control: 'echo' } };
    });
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var action = [
        '    this.echo = function(req, res) {',
        '        var show = function (v) { return (typeof v === "undefined") ? "__undefined__" : v; };',
        '        var keys = function (v) { return (v && typeof v === "object") ? Object.keys(v).join(",") : "(" + typeof v + ")"; };',
        // a HEAD answer has no body: what the action saw travels in headers
        "        res.setHeader('x-b837-get-keys', keys(req.get));",
        "        res.setHeader('x-b837-method', String(req.method));",
        '        self.renderJSON({ method: req.method, get: show(req.get), post: show(req.post), patch: show(req.patch), "delete": show(req["delete"]), body: show(req.body) });',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, action + anchor));
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('38 - container-boot-count-hasownproperty-b837 — a request field named hasOwnProperty reaches the action (#B837)', function () {

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

        try { installEchoRoute(); } catch (e) { setupError = 'echo route install failed: ' + (e.message || e); return; }

        var pe = readJSON(projectsPath)[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        var scheme = pe.def_scheme || 'http';
        if (scheme !== 'http') { setupError = 'the scaffold is ' + scheme + ', this file speaks http'; return; }
        try { bundlePort = readJSON(portsReversePath)[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

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

    // ── 01 GET ────────────────────────────────────────────────────────────

    it('01.1  GET controls — a plain query and a near-miss name arrive in req.get', async function (t) {
        if (!ready(t)) return;
        var r = await echo('GET', 'a=1&b=2');
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.get, { a: '1', b: '2' });
        r = await echo('GET', 'hasOwnPropertyX=x&a=1');
        assert.deepEqual(r.json.get, { hasOwnPropertyX: 'x', a: '1' });
    });

    it('01.2  GET — a field named hasOwnProperty arrives in req.get with the others (was: req.get empty)', async function (t) {
        if (!ready(t)) return;
        var r = await echo('GET', 'hasOwnProperty=x&a=1');
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.get, { hasOwnProperty: 'x', a: '1' });
        r = await echo('GET', 'a=1&hasOwnProperty=x');
        assert.deepEqual(r.json.get, { a: '1', hasOwnProperty: 'x' }, 'the field last');
    });

    // ── 02 HEAD ───────────────────────────────────────────────────────────

    it('02.1  HEAD control — the GET rule hands HEAD its query keys', async function (t) {
        if (!ready(t)) return;
        var r = await echo('HEAD', 'a=1&b=2');
        assert.equal(r.status, 200, show(r));
        assert.equal(r.headers['x-b837-method'], 'HEAD');
        assert.equal(r.headers['x-b837-get-keys'], 'a,b');
    });

    it('02.2  HEAD — a field named hasOwnProperty is among the keys (was: none)', async function (t) {
        if (!ready(t)) return;
        var r = await echo('HEAD', 'hasOwnProperty=x&a=1');
        assert.equal(r.status, 200, show(r));
        assert.equal(r.headers['x-b837-get-keys'], 'hasOwnProperty,a');
    });

    // ── 03 DELETE ─────────────────────────────────────────────────────────

    it('03.1  DELETE controls — a plain query and a near-miss name arrive in req.delete', async function (t) {
        if (!ready(t)) return;
        var r = await echo('DELETE', 'a=1&b=2');
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.delete, { a: '1', b: '2' });
        r = await echo('DELETE', 'hasOwnPropertyX=x&a=1');
        assert.deepEqual(r.json.delete, { hasOwnPropertyX: 'x', a: '1' });
    });

    it('03.2  DELETE — a field named hasOwnProperty arrives in req.delete (was: req.delete empty)', async function (t) {
        if (!ready(t)) return;
        var r = await echo('DELETE', 'hasOwnProperty=x&a=1');
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.delete, { hasOwnProperty: 'x', a: '1' });
    });

    // ── 04 POST, urlencoded ───────────────────────────────────────────────

    it('04.1  POST form controls — req.body is the parsed object req.post holds', async function (t) {
        if (!ready(t)) return;
        var r = await send('POST', 'a=1&b=2', FORM);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.post, { a: '1', b: '2' });
        assert.deepEqual(r.json.body, { a: '1', b: '2' });
        r = await send('POST', 'hasOwnPropertyX=x&a=1', FORM);
        assert.deepEqual(r.json.body, { hasOwnPropertyX: 'x', a: '1' });
    });

    it('04.2  POST form — with a field named hasOwnProperty, req.body is the parsed object too (was: the raw string)', async function (t) {
        if (!ready(t)) return;
        var r = await send('POST', 'hasOwnProperty=x&a=1', FORM);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.post, { hasOwnProperty: 'x', a: '1' });
        assert.deepEqual(r.json.body, { hasOwnProperty: 'x', a: '1' });
        r = await send('POST', 'a=1&hasOwnProperty=x', FORM);
        assert.deepEqual(r.json.body, { a: '1', hasOwnProperty: 'x' }, 'the field last');
    });

    // ── 05 POST, JSON ─────────────────────────────────────────────────────

    it('05.1  POST JSON control — req.body is the parsed object', async function (t) {
        if (!ready(t)) return;
        var r = await send('POST', '{"a":1,"b":2}', JSONT);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.body, { a: 1, b: 2 });
    });

    it('05.2  POST JSON — with a key named hasOwnProperty, req.body is the parsed object (was: the raw string)', async function (t) {
        if (!ready(t)) return;
        var r = await send('POST', '{"hasOwnProperty":"x","a":1}', JSONT);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.post, { hasOwnProperty: 'x', a: 1 });
        assert.deepEqual(r.json.body, { hasOwnProperty: 'x', a: 1 });
    });

    // ── 06 PATCH, urlencoded ──────────────────────────────────────────────

    it('06.1  PATCH form control — req.body is the parsed object req.patch holds', async function (t) {
        if (!ready(t)) return;
        var r = await send('PATCH', 'a=1&b=2', FORM);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.patch, { a: '1', b: '2' });
        assert.deepEqual(r.json.body, { a: '1', b: '2' });
    });

    it('06.2  PATCH form — with a field named hasOwnProperty, req.body is the parsed object (was: the raw string)', async function (t) {
        if (!ready(t)) return;
        var r = await send('PATCH', 'hasOwnProperty=x&a=1', FORM);
        assert.equal(r.status, 200, show(r));
        assert.deepEqual(r.json.patch, { hasOwnProperty: 'x', a: '1' });
        assert.deepEqual(r.json.body, { hasOwnProperty: 'x', a: '1' });
    });

    // ── 07 the bundle ─────────────────────────────────────────────────────

    it('07.1  the bundle is still up, answers a control and logged no uncaught exception', async function (t) {
        if (!ready(t)) return;
        await sleep(150);
        assert.ok(isChildAlive(), 'the bundle process must survive — exit: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1500));
        var r = await echo('GET', 'x=plain&y=1');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.get, { x: 'plain', y: '1' });
        assert.equal((childOut.match(/uncaughtException/g) || []).length, 0, childOut.slice(-1500));
    });
});
