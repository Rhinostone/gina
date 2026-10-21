/**
 * #B932 + #B925 — real-bytes boot: a bundle runs the swig package its
 * settings select.
 *
 * Before the fix the bundle's `swig.useProject` / `swig.package` were never
 * applied: controller.js asked the resolver for swig as the module loaded,
 * before initSwigEngine called load() with the bundle's settings, so every
 * bundle rendered through the framework copy (#B932). A frontend declared but
 * not installed therefore booted too, on the framework copy; with the fix it
 * reaches the resolver's named error, SWIG_PACKAGE_UNAVAILABLE (#B925).
 *
 * The frontend is a test double written into the scaffolded project's
 * node_modules: the framework's own swig whose engines carry one marker filter,
 * `b932marker`. A template using that filter renders `project-copy:<package>`
 * through the double and fails with « Invalid filter » through the framework
 * copy, so the rendered page says which copy rendered it. Five boots:
 *
 *   1. a frontend installed, `useProject: true`  → GET renders the marker
 *   2. a pinned @rhinostone/swig, `useProject: true` → GET renders the marker
 *   3. a frontend declared but not installed      → the bundle exits non-zero
 *                                                    at startup, the port never
 *                                                    opens, and the output names
 *                                                    the package and its install
 *   4. @rhinostone/swig with `useProject: true` and no project copy
 *                                                  → boots on the framework copy
 *                                                    and logs the not-installed
 *                                                    warning (load() ran)
 *   5. CONTROL: no swig block, no double           → the scaffold page 200, the
 *                                                    marker page not rendered
 *
 * Pre-fix (measured on the tree before the change, through the seam below)
 * arms 1–4 fail and arm 5 passes: arms 1 and 2 answer the marker page with an
 * error, arm 3 boots and serves, arm 4 logs no warning.
 *
 * Isolation: the container-boot.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (12500), project:rm + rmSync at teardown.
 * The real ~/.gina is never touched. Module-path seam: `B932_GINA_ROOT=<tree>`
 * boots THAT tree's launcher against a project scaffolded by THAT tree's CLI.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-swig-package-b932.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b932-home-' + STAMP);   // $HOME override → <FAKE_HOME>/.gina
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'sp' + STAMP;                                         // valid [a-z0-9_.]+ project name
var BUNDLE     = 'demo';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12500;                                                // own window: bundle:add claims 12500–12505

var BOOT_TIMEOUT_MS  = 25000;   // bounded wait for an exit OR an open port
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B932_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var FW_SWIG   = path.join(GINA_ROOT, 'framework',
    'v' + JSON.parse(fs.readFileSync(path.join(GINA_ROOT, 'package.json'), 'utf8')).version,
    'node_modules', '@rhinostone', 'swig');

var CHILD_ENV = Object.assign({}, process.env, {
    HOME           : FAKE_HOME,
    GINA_LOG_STDOUT: 'true'
});
delete CHILD_ENV.GINA_HOMEDIR;   // must derive from HOME, not inherit the dev's value
delete CHILD_ENV.NODE_PATH;

var TWIG    = '@rhinostone/swig-twig';
var DEFAULT = '@rhinostone/swig';
var MARKER_PATH = 'b932/page';

var skip       = false;
var skipReason = '';
var setupError = null;
var bundlePort = null;
var scheme     = 'http';
var webroot    = '/' + BUNDLE + '/';
var current    = null;   // the boot in flight, for the after() net


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTcpPortOpen(port) {
    return new Promise(function(resolve) {
        var sock = new net.Socket();
        sock.setTimeout(800);
        sock.on('connect', function() { sock.destroy(); resolve(true);  });
        sock.on('error',   function() { resolve(false); });
        sock.on('timeout', function() { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
    });
}

function httpGet(reqPath) {
    var lib = (scheme === 'https') ? https : http;
    return new Promise(function(resolve) {
        var req = lib.request({
            host: '127.0.0.1', port: bundlePort, path: reqPath, method: 'GET', agent: false, rejectUnauthorized: false
        }, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end',  function() { resolve({ status: res.statusCode, body: body }); });
        });
        req.setTimeout(15000, function() { req.destroy(new Error('timeout')); });
        req.on('error', function(e) { resolve({ status: null, err: e.message, body: '' }); });
        req.end();
    });
}

function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 60000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

function isChildAlive(child) { return child && child.exitCode === null && child.signalCode === null; }

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** The scaffold's JSON files carry whole-line `//` comments only. */
function stripLineComments(raw) { return raw.split('\n').filter(function(l) { return !/^\s*\/\//.test(l); }).join('\n'); }

/** Writes the bundle's settings.json with the given swig block (or none). */
function writeSwigSettings(swig) {
    var sf  = path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.json');
    var obj = JSON.parse(stripLineComments(fs.readFileSync(sf, 'utf8')));
    delete obj.swig;
    if (swig) { obj.swig = swig; }
    fs.writeFileSync(sf, JSON.stringify(obj, null, 2));
}

/**
 * Installs (or removes, when `install` is false) the test double for `pkgName`
 * in the project's node_modules: the framework's own swig module, whose engines
 * register a `b932marker` filter returning `project-copy:<pkgName>`.
 */
function setDouble(pkgName, install) {
    var dir = path.join(PROJ_DIR, 'node_modules', pkgName);
    fs.rmSync(dir, { recursive: true, force: true });
    if (!install) { return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: pkgName, version: '2.8.1', main: 'index.js' }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'index.js'), [
        '// #B932 test double: the framework swig, with a marker filter on every engine it builds.',
        'var real = require(' + JSON.stringify(FW_SWIG) + ');',
        'class MarkedSwig extends real.Swig {',
        '    constructor(opts) {',
        '        super(opts);',
        "        this.setFilter('b932marker', function () { return " + JSON.stringify('project-copy:' + pkgName) + '; });',
        '    }',
        '}',
        'module.exports = Object.assign(Object.create(real), { Swig: MarkedSwig });',
        ''
    ].join('\n'));
}

/** A route + an action rendering a template that uses the marker filter. */
function installFixture() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var rf  = path.join(src, 'config', 'routing.json');
    var r   = JSON.parse(stripLineComments(fs.readFileSync(rf, 'utf8')));
    r.b932page = { namespace: 'content', url: '/' + MARKER_PATH, method: 'GET', param: { control: 'b932page' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var cf = path.join(src, 'controllers', 'controller.content.js');
    var s  = fs.readFileSync(cf, 'utf8');
    var anchor = '    this.home = function(req, res) {';
    if (s.split(anchor).length !== 2) { throw new Error('controller anchor count ' + (s.split(anchor).length - 1)); }
    fs.writeFileSync(cf, s.replace(anchor, "    this.b932page = function(req, res) { self.render({ who: 'b932' }); };\n" + anchor));

    fs.writeFileSync(path.join(src, 'templates', 'html', 'content', 'b932page.html'),
        "<div id=\"b932\">{{ 'x'|b932marker }}</div>\n");
}

/**
 * Boots the bundle through the daemonless launcher and waits until the
 * launcher EXITS or the bundle PORT OPENS, bounded by BOOT_TIMEOUT_MS.
 *
 * @returns {Promise<{child:object, exit:object|null, portOpened:boolean, stdout:string, stderr:string}>}
 */
function boot() {
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
        env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe']
    });
    var out = { child: child, exit: null, portOpened: false, stdout: '', stderr: '' };
    current = out;
    child.stdout.on('data', function(d) { out.stdout += d; });
    child.stderr.on('data', function(d) { out.stderr += d; });
    child.on('exit', function(code, signal) { out.exit = { code: code, signal: signal }; });
    return new Promise(function(resolve) {
        var deadline = Date.now() + BOOT_TIMEOUT_MS;
        (function poll() {
            if (out.exit) { return setTimeout(function() { resolve(out); }, 300); }   // let the streams flush
            isTcpPortOpen(bundlePort).then(function(open) {
                if (open) { out.portOpened = true; return setTimeout(function() { resolve(out); }, 300); }
                if (Date.now() >= deadline) { return resolve(out); }
                setTimeout(poll, POLL_INTERVAL_MS);
            });
        })();
    });
}

/** SIGTERM (drain + exit 143), then SIGKILL; waits for the exit so the port is free for the next arm. */
async function teardown(out) {
    if (!out) { return; }
    if (isChildAlive(out.child)) {
        try { out.child.kill('SIGTERM'); } catch (e) { /* ignore */ }
        var until = Date.now() + 4000;
        while (Date.now() < until && isChildAlive(out.child)) { await sleep(150); }
        if (isChildAlive(out.child)) { try { out.child.kill('SIGKILL'); } catch (e) { /* ignore */ } }
        until = Date.now() + 2000;
        while (Date.now() < until && isChildAlive(out.child)) { await sleep(100); }
    }
    var freeBy = Date.now() + 3000;
    while (Date.now() < freeBy && await isTcpPortOpen(bundlePort)) { await sleep(150); }
    if (current === out) { current = null; }
}

function diagnostics(out) {
    var state = out.exit ? '' : (out.portOpened ? ' (running, port open)' : ' (STILL RUNNING at the deadline, never bound)');
    return 'exit: ' + JSON.stringify(out.exit) + state
        + ' | portOpened: ' + out.portOpened + '\n'
        + 'stdout (' + out.stdout.length + ' bytes):\n' + (out.stdout.slice(-3000) || '(empty)') + '\n---\n'
        + 'stderr (' + out.stderr.length + ' bytes):\n' + (out.stderr.slice(-3000) || '(empty)');
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('22 - container-boot-swig-package — a bundle runs the swig package its settings select (#B932, #B925)', function() {

    before(function() {
        if (process.platform === 'win32') {
            skip = true; skipReason = 'gina-container is Unix-centric (win32 not supported)';
            return;
        }
        if (!fs.existsSync(path.join(FW_SWIG, 'package.json'))) {
            setupError = 'the framework swig copy is missing: ' + FW_SWIG; return;
        }
        fs.mkdirSync(PROJ_DIR, { recursive: true });

        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        var projectsPath = path.join(GINA_HOME, 'projects.json');
        if (!fs.existsSync(projectsPath) || !readJSON(projectsPath)[PROJ]) {
            setupError = 'project:add did not register @' + PROJ + ' in ' + projectsPath; return;
        }
        runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var portsReversePath = path.join(GINA_HOME, 'ports.reverse.json');
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(portsReversePath) || !readJSON(portsReversePath)[key]) {
            setupError = 'bundle:add did not register ' + key + ' in ports.reverse.json'; return;
        }
        var va = runCli(['view:add', BUNDLE, '@' + PROJ]);
        if (!fs.existsSync(path.join(PROJ_DIR, 'src', BUNDLE, 'templates', 'html', 'content'))) {
            setupError = 'view:add did not install the templates: ' + (va.stdout + va.stderr).slice(-800); return;
        }

        // The project must load the tree under test (the #B422 Franken-boot trap):
        // project:add links <proj>/node_modules/gina to the CLI's own root.
        var link = path.join(PROJ_DIR, 'node_modules', 'gina');
        try {
            var target = fs.realpathSync(link);
            if (target !== fs.realpathSync(GINA_ROOT)) {
                setupError = 'node_modules/gina resolves to ' + target + ', not the tree under test ' + GINA_ROOT; return;
            }
        } catch (e) {
            setupError = 'node_modules/gina is not linked in the scaffolded project: ' + (e.message || e); return;
        }

        var projects = readJSON(projectsPath), portsReverse = readJSON(portsReversePath);
        var pe = projects[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        scheme = pe.def_scheme || 'http';
        try { bundlePort = portsReverse[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        try { installFixture(); } catch (e) { setupError = 'fixture: ' + (e.message || e); }
    });

    after(async function() {
        await teardown(current);
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        // project:add may create an empty ~/.<project> on the REAL home even under
        // HOME isolation (boot-smoke recipes, 2026-07-30); the name is unique to this run.
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    it('1. a frontend installed in the project with useProject: true renders through it', { timeout: BOOT_TIMEOUT_MS + 20000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        setDouble(DEFAULT, false);
        setDouble(TWIG, true);
        writeSwigSettings({ useProject: true, 'package': TWIG, autoescape: true });
        var out = await boot();
        try {
            assert.equal(out.portOpened, true, 'the bundle must start.\n' + diagnostics(out));
            var res = await httpGet(webroot + MARKER_PATH);
            assert.equal(res.status, 200, 'the marker page must render — pre-fix the framework copy answers « Invalid filter ».\n'
                + 'body: ' + res.body.slice(0, 300) + '\n' + diagnostics(out));
            assert.ok(res.body.indexOf('project-copy:' + TWIG) > -1, 'rendered through ' + TWIG + '; body: ' + res.body.slice(0, 300));
            assert.ok((out.stdout + out.stderr).indexOf('second bundle requested') < 0,
                'no misleading second-bundle warning.\n' + diagnostics(out));
        } finally { await teardown(out); }
    });

    it('2. a pinned @rhinostone/swig with useProject: true renders through the project copy', { timeout: BOOT_TIMEOUT_MS + 20000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        setDouble(TWIG, false);
        setDouble(DEFAULT, true);
        writeSwigSettings({ useProject: true, autoescape: true });
        var out = await boot();
        try {
            assert.equal(out.portOpened, true, 'the bundle must start.\n' + diagnostics(out));
            var res = await httpGet(webroot + MARKER_PATH);
            assert.equal(res.status, 200, 'the marker page must render through the project copy.\n'
                + 'body: ' + res.body.slice(0, 300) + '\n' + diagnostics(out));
            assert.ok(res.body.indexOf('project-copy:' + DEFAULT) > -1, 'rendered through the pinned copy; body: ' + res.body.slice(0, 300));
        } finally { await teardown(out); }
    });

    it('3. a frontend declared but not installed stops the bundle at startup, naming the package and its install', { timeout: BOOT_TIMEOUT_MS + 20000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        setDouble(TWIG, false);
        setDouble(DEFAULT, false);
        writeSwigSettings({ useProject: true, 'package': TWIG, autoescape: true });
        var out = await boot();
        try {
            assert.ok(out.exit, 'the launcher must exit — pre-fix the bundle boots on the framework copy.\n' + diagnostics(out));
            assert.notEqual(out.exit.code, 0, 'a non-zero exit code.\n' + diagnostics(out));
            assert.equal(out.portOpened, false, 'the port must never open');
            var all = out.stdout + out.stderr;
            assert.ok(all.indexOf('settings.swig.package is ' + TWIG) > -1, 'the output names the package.\n' + diagnostics(out));
            assert.ok(all.indexOf('npm install ' + TWIG) > -1, 'the output gives the install line.\n' + diagnostics(out));
        } finally { await teardown(out); }
    });

    it('4. @rhinostone/swig with useProject: true and no project copy boots on the framework copy and logs the warning', { timeout: BOOT_TIMEOUT_MS + 20000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        setDouble(TWIG, false);
        setDouble(DEFAULT, false);
        writeSwigSettings({ useProject: true, autoescape: true });
        var out = await boot();
        try {
            assert.equal(out.portOpened, true, 'the bundle must start.\n' + diagnostics(out));
            var res = await httpGet(webroot);
            assert.equal(res.status, 200, 'the scaffold page.\n' + diagnostics(out));
            assert.ok((out.stdout + out.stderr).indexOf('project override ignored (not-installed)') > -1,
                'load() ran and logged the not-installed fallback — pre-fix it never ran.\n' + diagnostics(out));
        } finally { await teardown(out); }
    });

    it('5. CONTROL: no swig block and no double — the scaffold page renders, the marker page does not', { timeout: BOOT_TIMEOUT_MS + 20000 }, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        setDouble(TWIG, false);
        setDouble(DEFAULT, false);
        writeSwigSettings({ autoescape: true });
        var out = await boot();
        try {
            assert.equal(out.portOpened, true, 'the bundle must start.\n' + diagnostics(out));
            var home = await httpGet(webroot);
            assert.equal(home.status, 200, 'the scaffold page.\n' + diagnostics(out));
            assert.ok(home.body.indexOf('Hello World') > -1, 'expected the scaffold greeting; first 200 chars: ' + home.body.slice(0, 200));
            var marker = await httpGet(webroot + MARKER_PATH);
            assert.notEqual(marker.status, 200, 'the framework copy has no b932marker filter, so the marker page must fail');
            assert.ok(marker.body.indexOf('project-copy:') < 0, 'no marker from the framework copy');
        } finally { await teardown(out); }
    });
});
