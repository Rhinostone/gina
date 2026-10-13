/**
 * #B848 / #B847 — the DELETE container `req.delete` is a plain object holding the
 * query's own fields, through a booted bundle on the default engine (isaac).
 *
 * isaac parses a `{`- or `[`-leading query value as JSON and assigned every field with
 * `request.query[name] = value`, so a field named `__proto__` holding a JSON value
 * reached the `Object.prototype.__proto__` setter and re-pointed the prototype of
 * `request.query`; the DELETE branch of core/server.js handed that object over as
 * `req.delete` by reference (#B848). On the first DELETE to a path the routing loop's
 * double `Object.assign` copy laundered it; on every later one (the route verdict is
 * cached) the action received the re-pointed object: `req.delete.polluted` read the
 * injected value while `Object.keys` did not list it, and a shadowed `count`,
 * `hasOwnProperty` or `toString` made the documented calls throw. A field named
 * `constructor` or `prototype` reached `req.delete` as an own key, which GET drops
 * (#B592). This file boots the REAL `bin/gina-container` against a scaffolded project
 * carrying `/echo` (GET + DELETE) and `/cold` (DELETE) routes whose action reports the
 * shape of the bag it received, and drives it over HTTP/1.1:
 *
 *   01  GET and HEAD controls: the same fields are dropped there already (#B592)
 *   02  DELETE on a warm route: the pair form in both orders, the shadows, an array or
 *       a bare object as the injected prototype, `constructor` / `prototype`, the
 *       single-field form, a bracket key, the whole-query JSON document, an array
 *       document, a control after the polluting cells
 *   03  DELETE on a cold route: the first request to a path
 *   04  the bundle served every request and is still up
 *
 * #B847 (Express 4 with a `querystring`-built query parser: a null-prototype
 * `req.delete`) needs Express, which is consumer-provided and never a dependency, so it
 * is not driven here: test/core/delete-query-copy-b848.test.js runs the shipped helper
 * on a null-prototype object, and the live express 4/5 scene is the acceptance.
 *
 * Isolation: the container-boot-request-parsing.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (11800), project:rm + rmSync at teardown.
 * Seam: `B848_GINA_ROOT=<tree>` boots THAT tree's launcher against a project scaffolded
 * by THAT tree's CLI (red-first against another worktree, no shared-tree touch).
 *
 * Run standalone:
 *   node --test test/integration/container-boot-delete-proto-b848.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b848-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'dpr' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 11800;

var BOOT_TIMEOUT_MS  = 25000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B848_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var child = null, childOut = '', childExit = null;

// `{"polluted":1}` and friends, percent-encoded
var POLLUTED = '%7B%22polluted%22%3A1%7D';
var enc = function (s) { return encodeURIComponent(s); };


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
function request(method, reqPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: reqPath, method: method }, function (res) {
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
        req.end();
    });
}

function on(method, route, rawQuery) { return request(method, webroot + route + (rawQuery === null ? '' : '?' + rawQuery)); }

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function isChildAlive() { return child && child.exitCode === null && child.signalCode === null; }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function show(r) { return r.status + ' ' + String(r.body).slice(0, 400); }

/**
 * Adds the probe routes and action to the scaffold. HEAD is served by the GET rule.
 * The action reports the shape of the bag of its method (`req.delete`, or `req.get`):
 * its type and prototype, its own keys, the keys a `for…in` walk sees, a `polluted`
 * property read, the documented `count()`, `hasOwnProperty('a')`, a string coercion,
 * its JSON, and the keys of `req.getParams()`.
 */
function installProbeRoutes() {
    var rf = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'routing.json');
    var cf = path.join(PROJ_DIR, 'src', BUNDLE, 'controllers', 'controller.content.js');
    var strip = function (raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); };
    var r = JSON.parse(strip(fs.readFileSync(rf, 'utf8')));
    r.probe_get    = { namespace: 'content', url: '/echo',  method: 'GET',    param: { control: 'probe' } };
    r.probe_delete = { namespace: 'content', url: '/echo',  method: 'DELETE', param: { control: 'probe' } };
    r.cold_a       = { namespace: 'content', url: '/colda', method: 'DELETE', param: { control: 'probe' } };
    r.cold_b       = { namespace: 'content', url: '/coldb', method: 'DELETE', param: { control: 'probe' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));
    var s = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    var action = [
        '    this.probe = function(req, res) {',
        '        var shape = function (d) {',
        '            var o = {};',
        '            if (d === null || typeof d === "undefined") { o.type = String(d); return o; }',
        '            o.type = Array.isArray(d) ? "array" : typeof d;',
        '            if (typeof d !== "object") { o.value = d; return o; }',
        '            var p = Object.getPrototypeOf(d);',
        '            o.proto = (p === Object.prototype) ? "Object.prototype" : (p === null) ? "null" : (p === Array.prototype) ? "Array.prototype" : "other";',
        '            o.keys = Object.keys(d);',
        '            o.forIn = []; for (var k in d) { o.forIn.push(k); }',
        '            o.polluted = (typeof d.polluted === "undefined") ? "__undefined__" : d.polluted;',
        '            try { o.count = d.count(); } catch (e) { o.count = "threw " + e.name; }',
        '            try { o.hasA = d.hasOwnProperty("a"); } catch (e) { o.hasA = "threw " + e.name; }',
        '            try { o.str = "" + d; } catch (e) { o.str = "threw " + e.name; }',
        '            try { o.json = JSON.stringify(d); } catch (e) { o.json = "threw " + e.name; }',
        '            return o;',
        '        };',
        '        var m = String(req.method).toLowerCase();',
        '        var bag = (m === "delete") ? req["delete"] : req.get;',
        '        var out = { method: req.method, bag: shape(bag) };',
        '        try { out.params = Object.keys(req.getParams()); } catch (e) { out.params = "threw " + e.name; }',
        // a HEAD answer has no body: what the action saw travels in headers
        "        res.setHeader('x-b848-keys', String((out.bag.keys || []).join(',')));",
        "        res.setHeader('x-b848-polluted', String(out.bag.polluted));",
        '        self.renderJSON(out);',
        '    };',
        ''
    ].join('\n');
    fs.writeFileSync(cf, s.replace(anchor, action + anchor));
}

/** The plain-bag verdict every DELETE cell asserts, plus the cell's own key list. */
function assertPlain(r, keys, label) {
    assert.equal(r.status, 200, label + ': ' + show(r));
    var b = r.json && r.json.bag;
    assert.ok(b, label + ': no bag in ' + show(r));
    assert.equal(b.type, 'object', label + ': ' + JSON.stringify(b));
    assert.equal(b.proto, 'Object.prototype', label + ': the bag\'s prototype must be Object.prototype — ' + JSON.stringify(b));
    assert.deepEqual(b.keys, keys, label + ': own keys — ' + JSON.stringify(b));
    assert.deepEqual(b.forIn, keys, label + ': a for…in walk sees the own keys only — ' + JSON.stringify(b));
    assert.equal(b.polluted, '__undefined__', label + ': no inherited `polluted` — ' + JSON.stringify(b));
    assert.equal(b.count, keys.length, label + ': the documented count() works — ' + JSON.stringify(b));
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('40 - container-boot-delete-proto-b848 — req.delete is a plain object holding the query\'s own fields (#B848)', function () {

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

        try { installProbeRoutes(); } catch (e) { setupError = 'probe route install failed: ' + (e.message || e); return; }

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

    // ── 01 GET / HEAD ─────────────────────────────────────────────────────

    it('01.1  GET controls — a `__proto__` field is dropped from req.get, the shadows leave its methods alone (#B592)', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('GET', 'echo', 'a=1&b=2'), ['a', 'b'], 'GET control');
        assertPlain(await on('GET', 'echo', '__proto__=' + POLLUTED + '&a=1'), ['a'], 'GET __proto__ pair');
        var r = await on('GET', 'echo', '__proto__=' + enc('{"toString":1}') + '&a=1');
        assertPlain(r, ['a'], 'GET toString shadow');
        assert.equal(r.json.bag.str, '[object Object]');
    });

    it('01.2  HEAD control — the same keys, reported in headers', async function (t) {
        if (!ready(t)) return;
        var r = await on('HEAD', 'echo', '__proto__=' + POLLUTED + '&a=1');
        assert.equal(r.status, 200, show(r));
        assert.equal(r.headers['x-b848-keys'], 'a');
        assert.equal(r.headers['x-b848-polluted'], '__undefined__');
    });

    // ── 02 DELETE, warm route ─────────────────────────────────────────────

    it('02.1  DELETE control — warms the route: a plain query arrives as a plain req.delete', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'echo', 'a=1&b=2'), ['a', 'b'], 'DELETE control (cold)');
        assertPlain(await on('DELETE', 'echo', 'a=1&b=2'), ['a', 'b'], 'DELETE control (warm)');
    });

    it('02.2  DELETE — a `__proto__` field holding JSON is dropped, first, last or with an encoded name (was: the prototype of req.delete re-pointed)', async function (t) {
        if (!ready(t)) return;
        var r = await on('DELETE', 'echo', '__proto__=' + POLLUTED + '&a=1');
        assertPlain(r, ['a'], '__proto__ first');
        assert.equal(r.json.params.indexOf('polluted'), -1, 'req.getParams() copies no injected key — ' + JSON.stringify(r.json.params));
        assertPlain(await on('DELETE', 'echo', 'a=1&__proto__=' + POLLUTED), ['a'], '__proto__ last');
        assertPlain(await on('DELETE', 'echo', '%5F%5Fproto%5F%5F=' + POLLUTED + '&a=1'), ['a'], 'an encoded __proto__ name (decoded before the test)');
        assertPlain(await on('DELETE', 'echo', 'a=1&b=2'), ['a', 'b'], 'control after');
    });

    it('02.3  DELETE — a prototype shadowing count, hasOwnProperty or toString cannot be injected: the documented calls work (was: they threw)', async function (t) {
        if (!ready(t)) return;
        var r = await on('DELETE', 'echo', '__proto__=' + enc('{"count":1}') + '&a=1');
        assertPlain(r, ['a'], 'count shadow');
        r = await on('DELETE', 'echo', '__proto__=' + enc('{"hasOwnProperty":1}') + '&a=1');
        assertPlain(r, ['a'], 'hasOwnProperty shadow');
        assert.equal(r.json.bag.hasA, true);
        r = await on('DELETE', 'echo', '__proto__=' + enc('{"toString":1}') + '&a=1');
        assertPlain(r, ['a'], 'toString shadow');
        assert.equal(r.json.bag.str, '[object Object]');
    });

    it('02.4  DELETE — an array or a bare object as the injected prototype is dropped too', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'echo', '__proto__=' + enc('[1]') + '&a=1'), ['a'], '__proto__=[1]');
        assertPlain(await on('DELETE', 'echo', '__proto__=' + enc('{}') + '&a=1'), ['a'], '__proto__={}');
    });

    it('02.5  DELETE — fields named constructor and prototype are dropped, as on GET (was: own keys of req.delete)', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'echo', 'constructor=' + POLLUTED + '&a=1'), ['a'], 'constructor pair');
        assertPlain(await on('DELETE', 'echo', 'prototype=' + POLLUTED + '&a=1'), ['a'], 'prototype pair');
        assertPlain(await on('DELETE', 'echo', 'constructor=x'), [], 'constructor alone');
    });

    it('02.6  DELETE controls — a lone `__proto__` field is dropped, a bracket key is kept as a flat key', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'echo', '__proto__=' + POLLUTED), [], '__proto__ alone');
        assertPlain(await on('DELETE', 'echo', '__proto__%5Bpolluted%5D=1&a=1'), ['__proto__[polluted]', 'a'], 'bracket key');
    });

    it('02.7  DELETE — a whole-query JSON document holding a `__proto__` key: the key is dropped (was: an own `__proto__` key)', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'echo', enc('{"__proto__":{"polluted":1},"a":"1"}')), ['a'], 'document form');
    });

    it('02.8  DELETE control — a whole-query JSON array is handed over as an array, as before', async function (t) {
        if (!ready(t)) return;
        var r = await on('DELETE', 'echo', enc('[1,2]'));
        assert.equal(r.status, 200, show(r));
        assert.equal(r.json.bag.type, 'array', JSON.stringify(r.json.bag));
        assert.deepEqual(r.json.bag.keys, ['0', '1']);
        assert.equal(r.json.bag.json, '[1,2]');
    });

    // ── 03 DELETE, cold route ─────────────────────────────────────────────

    it('03.1  DELETE controls on a cold route — the first request to a path arrives plain (before and after the fix)', async function (t) {
        if (!ready(t)) return;
        assertPlain(await on('DELETE', 'colda', '__proto__=' + POLLUTED + '&a=1'), ['a'], 'cold pair');
        assertPlain(await on('DELETE', 'coldb', enc('{"__proto__":{"polluted":1},"a":"1"}')), ['a'], 'cold document');
    });

    // ── 04 the bundle ─────────────────────────────────────────────────────

    it('04.1  the bundle is still up, answers a control and logged no uncaught exception', async function (t) {
        if (!ready(t)) return;
        await sleep(150);
        assert.ok(isChildAlive(), 'the bundle process must survive — exit: ' + JSON.stringify(childExit) + '\n' + childOut.slice(-1500));
        assertPlain(await on('DELETE', 'echo', 'x=plain&y=1'), ['x', 'y'], 'final control');
        assert.equal((childOut.match(/uncaughtException/g) || []).length, 0, childOut.slice(-1500));
    });
});
