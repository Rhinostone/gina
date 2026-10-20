/**
 * #B934 + #B928 — real-bytes boot: gina-container reads the ~/.gina state files
 * the way the CLI reads them.
 *
 * Before the fix the launcher read `~/.gina/<short>/settings.json`,
 * `projects.json` and `ports.reverse.json` with a plain `JSON.parse`, so a
 * hand-edited trailing comma or `//` comment stopped it with an uncaught
 * SyntaxError that named no file, and its `main.json` warning named none
 * either (#B934). Past the launcher, the bundle's boot read `projects.json`
 * and `ports.reverse.json` with a plain `require()` (`core/gna.js`, then
 * `core/config.js`), so the same comma stopped the bundle there. And the
 * launcher's `parseJSONWithComments` refused a trailing comma in
 * `manifest.json`, because `helpers/json` held the logger's first, empty
 * exports in that process (#B928). Thirteen boots:
 *
 *   1. settings.json, a trailing comma        → boots, a warning names the file
 *   2. settings.json, a `//` comment line     → boots
 *   3. settings.json, malformed               → exits 1: « settings.json cannot be used: could not parse `<path>` »
 *   4. projects.json, a trailing comma        → boots (the launcher, gna.js and config.js read it)
 *   5. projects.json, a `//` comment line     → boots
 *   6. projects.json, malformed               → exits 1: « projects.json cannot be used: … »
 *   7. ports.reverse.json, a trailing comma   → boots
 *   8. ports.reverse.json, malformed          → exits 1: « ports.reverse.json cannot be used: … »
 *   9. main.json, malformed                   → boots; the def_framework warning names main.json
 *  10. manifest.json, a trailing comma        → boots (#B928)
 *  11. CONTROL: as scaffolded                 → boots
 *  12. CONTROL: main.json, a trailing comma   → boots
 *  13. CONTROL: manifest.json, a comment line → boots (#B891)
 *
 * Pre-fix (measured on 3e359749e through the seam below): arms 1–10 fail and
 * the controls 11–13 pass.
 *
 * Isolation: the container-boot.test.js shape — a throwaway HOME under
 * os.tmpdir(), its own port window (12850), every mutated file restored after
 * its arm, project:rm + rmSync at teardown. The real ~/.gina is never touched.
 * Module-path seam: `B934_GINA_ROOT=<tree>` boots THAT tree's launcher against
 * a project scaffolded by THAT tree's CLI.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-home-files-b934.test.js
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
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b934-home-' + STAMP);   // $HOME override → <FAKE_HOME>/.gina
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'hf' + STAMP;                                         // valid [a-z0-9_.]+ project name
var BUNDLE     = 'demo';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12850;                                                // own window: bundle:add claims 12850–12855

var BOOT_TIMEOUT_MS  = 25000;   // bounded wait for an exit OR an open port
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B934_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var SHORT     = JSON.parse(fs.readFileSync(path.join(GINA_ROOT, 'package.json'), 'utf8')).version.split('.').slice(0, 2).join('.');

var CHILD_ENV = Object.assign({}, process.env, {
    HOME           : FAKE_HOME,
    GINA_LOG_STDOUT: 'true'
});
delete CHILD_ENV.GINA_HOMEDIR;   // must derive from HOME, not inherit the dev's value
delete CHILD_ENV.NODE_PATH;

var FILES = {
    settings    : path.join(GINA_HOME, SHORT, 'settings.json'),
    projects    : path.join(GINA_HOME, 'projects.json'),
    portsReverse: path.join(GINA_HOME, 'ports.reverse.json'),
    main        : path.join(GINA_HOME, 'main.json'),
    manifest    : path.join(PROJ_DIR, 'manifest.json')
};

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

/**
 * One edit of a JSON document: `comma` adds a trailing comma before its last
 * `}`, `comment` puts a `//` line first, `malformed` drops its last `}`.
 *
 * @param {string} text - the document
 * @param {string} how - `comma` | `comment` | `malformed`
 * @returns {string}
 */
function mutate(text, how) {
    if (how === 'comma') {
        var at = text.lastIndexOf('}');
        var j = at - 1;
        while (j >= 0 && /\s/.test(text[j])) { j--; }
        if (text[j] === ',' || text[j] === '{') { throw new Error('no trailing comma can be added here'); }
        return text.slice(0, j + 1) + ',' + text.slice(j + 1);
    }
    if (how === 'comment')   { return '// a comment line\n' + text; }
    if (how === 'malformed') { return text.slice(0, text.lastIndexOf('}')); }
    throw new Error('unknown edit ' + how);
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

/**
 * Writes one edit of `key`'s file (or none), boots, and restores the file
 * whatever the boot did. The file must be back byte for byte.
 *
 * @param {string|null} key - a FILES key, or null for an untouched boot
 * @param {string} [how] - the edit, see mutate()
 * @returns {Promise<object>} the boot() result, the bundle stopped
 */
async function bootWith(key, how) {
    var file = key ? FILES[key] : null;
    var orig = file ? fs.readFileSync(file, 'utf8') : null;
    if (file) { fs.writeFileSync(file, mutate(orig, how)); }
    var out = await boot();
    try {
        if (out.portOpened) { out.res = await httpGet(webroot); }
    } finally {
        await teardown(out);
        if (file) { fs.writeFileSync(file, orig); }
    }
    if (file) { assert.equal(fs.readFileSync(file, 'utf8'), orig, 'harness: ' + file + ' restored'); }
    return out;
}

function assertBooted(out, label) {
    assert.equal(out.portOpened, true, label + ': the bundle must start.\n' + diagnostics(out));
    assert.ok(out.res && out.res.status === 200, label + ': the scaffold page must answer 200; got '
        + (out.res && (out.res.status || out.res.err)) + '.\n' + diagnostics(out));
}

function assertRefused(out, fileName, file) {
    assert.equal(out.portOpened, false, 'the bundle must not start.\n' + diagnostics(out));
    assert.ok(out.exit && out.exit.code === 1, 'the launcher exits 1.\n' + diagnostics(out));
    var text = out.stdout + out.stderr;
    var expected = '[ gina-container ] ' + fileName + ' cannot be used: could not parse `' + file + '`';
    assert.ok(text.indexOf(expected) > -1, 'the message names the file: « ' + expected + ' ».\n' + diagnostics(out));
    assert.equal(/at Object\.<anonymous> \(.*gina-container/.test(text), false, 'no uncaught SyntaxError stack.\n' + diagnostics(out));
}

function warned(out, file) {
    return (out.stdout + out.stderr).indexOf('trailing comma in `' + file + '`') > -1;
}


// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('23 - container-boot-home-files — gina-container reads ~/.gina the way the CLI does (#B934, #B928)', function() {

    before(function() {
        if (process.platform === 'win32') {
            skip = true; skipReason = 'gina-container is Unix-centric (win32 not supported)';
            return;
        }
        fs.mkdirSync(PROJ_DIR, { recursive: true });

        runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
        if (!fs.existsSync(FILES.projects) || !readJSON(FILES.projects)[PROJ]) {
            setupError = 'project:add did not register @' + PROJ + ' in ' + FILES.projects; return;
        }
        runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
        var key = BUNDLE + '@' + PROJ;
        if (!fs.existsSync(FILES.portsReverse) || !readJSON(FILES.portsReverse)[key]) {
            setupError = 'bundle:add did not register ' + key + ' in ports.reverse.json'; return;
        }
        var missing = Object.keys(FILES).filter(function(k) { return !fs.existsSync(FILES[k]); });
        if (missing.length) { setupError = 'the scaffold has no ' + missing.join(', '); return; }

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

        var projects = readJSON(FILES.projects), portsReverse = readJSON(FILES.portsReverse);
        var pe = projects[PROJ], env = pe.def_env || 'dev', proto = pe.def_protocol;
        scheme = pe.def_scheme || 'http';
        try { bundlePort = portsReverse[key][env][proto][scheme]; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the bound port for ' + key; return; }
        try {
            var ssj = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            var wr  = (ssj.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE);
            webroot = wr.replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }
    });

    after(async function() {
        await teardown(current);
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        // project:add may create an empty ~/.<project> on the REAL home even under
        // HOME isolation (boot-smoke recipes, 2026-07-30); the name is unique to this run.
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    var T = { timeout: BOOT_TIMEOUT_MS + 20000 };

    it('1. settings.json with a trailing comma: boots, and a warning names the file', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith('settings', 'comma');
        assertBooted(out, 'pre-fix: an uncaught SyntaxError at gina-container:122');
        assert.ok(warned(out, FILES.settings), 'a warning names settings.json.\n' + diagnostics(out));
    });

    it('2. settings.json with a // comment line: boots', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertBooted(await bootWith('settings', 'comment'), 'pre-fix: « Unexpected token \'/\' »');
    });

    it('3. settings.json malformed: exits 1 and names the file', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertRefused(await bootWith('settings', 'malformed'), 'settings.json', FILES.settings);
    });

    it('4. projects.json with a trailing comma: boots (the launcher and the bundle\'s boot accept it)', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith('projects', 'comma');
        assertBooted(out, 'pre-fix: the launcher stops; past it, gna.js and config.js stop the bundle');
        assert.ok(warned(out, FILES.projects), 'a warning names projects.json.\n' + diagnostics(out));
    });

    it('5. projects.json with a // comment line: boots', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertBooted(await bootWith('projects', 'comment'), 'pre-fix: the launcher stops');
    });

    it('6. projects.json malformed: exits 1 and names the file', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertRefused(await bootWith('projects', 'malformed'), 'projects.json', FILES.projects);
    });

    it('7. ports.reverse.json with a trailing comma: boots', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith('portsReverse', 'comma');
        assertBooted(out, 'pre-fix: the launcher stops; past it, gna.js stops the bundle');
        assert.ok(warned(out, FILES.portsReverse), 'a warning names ports.reverse.json.\n' + diagnostics(out));
    });

    it('8. ports.reverse.json malformed: exits 1 and names the file', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertRefused(await bootWith('portsReverse', 'malformed'), 'ports.reverse.json', FILES.portsReverse);
    });

    it('9. main.json malformed: boots, and the def_framework warning names the file', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith('main', 'malformed');
        assertBooted(out, 'main.json is not needed to boot');
        var expected = 'could not sync def_framework — could not parse `' + FILES.main + '`';
        assert.ok((out.stdout + out.stderr).indexOf(expected) > -1, 'pre-fix: the warning names no file; expected « ' + expected + ' ».\n' + diagnostics(out));
    });

    it('10. manifest.json with a trailing comma: boots (#B928)', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith('manifest', 'comma');
        assertBooted(out, 'pre-fix: « manifest.json cannot be used: could not parse »');
        assert.ok(warned(out, FILES.manifest), 'a warning names manifest.json.\n' + diagnostics(out));
    });

    it('11. CONTROL: the scaffold as written boots', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        var out = await bootWith(null);
        assertBooted(out, 'the control');
        assert.equal(/trailing comma|cannot be used/.test(out.stdout + out.stderr), false, 'no warning.\n' + diagnostics(out));
    });

    it('12. CONTROL: main.json with a trailing comma boots', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertBooted(await bootWith('main', 'comma'), 'main.json is not needed to boot');
    });

    it('13. CONTROL: manifest.json with a comment line boots (#B891)', T, async function(t) {
        if (skip) { t.skip(skipReason); return; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        assertBooted(await bootWith('manifest', 'comment'), 'the #B891 reader');
    });
});
