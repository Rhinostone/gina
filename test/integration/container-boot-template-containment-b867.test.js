/**
 * #B867 — the page template path is confined to the template root at the render boundary.
 *
 * A template path can reach the render delegates from request data by routes the routing fill
 * (#B833) never sees: a controller passing a request value to `self.setTemplate()`, or writing it
 * to `req.routing.param.file` in its action. controller.render-swig.js joined such a value under
 * the root with no containment check (the setTemplate and namespace branches had none; the else
 * branch only inspected `file.charAt(0)`, and for a leading `.` it checked one path and read
 * another, relative to the process cwd). `_()` normalises a path BEFORE it turns `\` into `/`, so
 * a backslash-separated `..` (`%5C` in a URL segment) survived and traversed at read time: the
 * published example `self.setTemplate('errors/' + req.params.code)` read any `.html` file.
 * controller.render-nunjucks.js left containment to nunjucks' FileSystemLoader, whose
 * `indexOf(root) === 0` test has no trailing separator, so a sibling directory whose name starts
 * with the root's name passed.
 *
 * The fix: each sync delegate resolves the path it is about to read and refuses one outside the
 * section's configured `template.html` root (separator-anchored, lexical), answering 500 through
 * throwError. Custom error pages are exempt (they legitimately live in `<sharedPath>/errors`,
 * outside the bundle) on the flag renderCustomError sets, never on a flag carried by render data.
 *
 * This boots the REAL bin/gina-container (isaac, http/1.1) on a scaffolded bundle, with the
 * process cwd inside the sandbox and markers placed OUTSIDE the template root. Asserted: every
 * traversal answers 500 with no marker and the guard's message in the bundle output, while the
 * in-root controls, a developer-authored static `../` prefix that stays inside, and a shared
 * custom error page still render. Red-first against the pre-fix tree: the escape arms answer 200
 * and leak their marker. Seam: B867_GINA_ROOT=<tree>.
 *
 * Run standalone:
 *   node --test test/integration/container-boot-template-containment-b867.test.js
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var net    = require('net');
var http   = require('http');
var fs      = require('fs');
var os      = require('os');
var path    = require('path');
var { spawnSync, spawn } = require('child_process');

var STAMP      = Date.now();
var FAKE_HOME  = path.join(os.tmpdir(), 'gina-b867cont-home-' + STAMP);
var GINA_HOME  = path.join(FAKE_HOME, '.gina');
var PROJ       = 'b867c' + STAMP;
var BUNDLE     = 'web';
var PROJ_DIR   = path.join(FAKE_HOME, 'proj');
var PORT_START = 12200;

var IN_ROOT     = 'B867-INROOT-' + STAMP;
var NJK_IN_ROOT = 'B867-NJK-INROOT-' + STAMP;
var STATIC_IN   = 'B867-STATIC-INROOT-' + STAMP;
var SHARED_ERR  = 'B867-SHARED-ERROR-PAGE-' + STAMP;
var SHALLOW     = 'B867-SHALLOW-MARKER-' + STAMP;   // <templates>/B867_SHALLOW.html — one level above the root
var DOT1        = 'B867-DOT1-MARKER-' + STAMP;      // <templates>/html.html — what `errors/..` + .html reaches
var DEEP        = 'B867-DEEP-MARKER-' + STAMP;      // <project>/B867_DEEP.html — outside the bundle
var CWD_MARK    = 'B867-CWD-MARKER-' + STAMP;       // <project>/B867_CWD.html — the bundle's cwd
var PATH_MARK   = 'B867-PATH-MARKER-' + STAMP;      // <project>/B867_PATH.html — a param.path template
var SIBLING     = 'B867-SIBLING-MARKER-' + STAMP;   // <templates>/html2/b867sib.njk — a sibling of the root
var NJK_UP      = 'B867-NJK-UP-MARKER-' + STAMP;    // <templates>/B867_NJK_UP.njk
var LINKED_OK   = 'B867-LINKED-OK-' + STAMP;        // <project>/outside/inner/b867linked.html, reached through templates/html/linked
var SYMLINK_MARK = 'B867-SYMLINK-MARKER-' + STAMP;  // <project>/outside/B867_SYMLINK.html — the symlink target's parent

var GUARD_MESSAGE = '[CVE-2023-25345] Path traversal attempt blocked: the template path of route';

var BOOT_TIMEOUT_MS  = 30000;
var POLL_INTERVAL_MS = 250;

var GINA_ROOT = process.env.B867_GINA_ROOT || path.resolve(__dirname, '../..');
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');
var CHILD_ENV = Object.assign({}, process.env, { HOME: FAKE_HOME, GINA_LOG_STDOUT: 'true' });
delete CHILD_ENV.GINA_HOMEDIR;

var skip = false, skipReason = '', setupError = null;
var bundlePort = null, webroot = '/' + BUNDLE + '/';
var results = {};   // arm key -> { status, body }
var bundleOutput = '';

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
/** GET a RAW path (query + encodings preserved — never normalised through URL()). */
function getRaw(rawPath) {
    return new Promise(function (resolve) {
        var req = http.request({ host: '127.0.0.1', port: bundlePort, path: rawPath, method: 'GET', agent: false }, function (res) {
            var data = '';
            res.on('data', function (c) { data += c; });
            res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
        });
        req.setTimeout(15000, function () { req.destroy(new Error('timeout')); });
        req.on('error', function (e) { resolve({ status: null, body: '', err: e.message }); });
        req.end();
    });
}
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), { env: CHILD_ENV, encoding: 'utf8', timeout: 90000 });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function stripLineComments(raw) { return raw.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n'); }
function injectOnce(file, anchor, code) {
    var s = fs.readFileSync(file, 'utf8');
    if (s.split(anchor).length !== 2) { throw new Error(path.basename(file) + ' anchor count ' + (s.split(anchor).length - 1)); }
    fs.writeFileSync(file, s.replace(anchor, code + anchor));
}

/** The b867 routes, controller actions, templates and markers. */
function installFixture() {
    var src = path.join(PROJ_DIR, 'src', BUNDLE);
    var tpl = path.join(src, 'templates');

    var rf = path.join(src, 'config', 'routing.json');
    var r = JSON.parse(stripLineComments(fs.readFileSync(rf, 'utf8')));
    // no namespace: controls resolve on controller.js
    r.b867st      = { url: '/b867st', method: 'GET', param: { control: 'b867setTemplate', file: 'content/b867page' } };
    // the published example: self.setTemplate('errors/' + req.params.code)
    r.b867err     = { url: '/b867err/:code', method: 'GET', requirements: { code: '/.+/' }, param: { control: 'b867errors', file: 'content/b867page', code: ':code' } };
    r.b867direct  = { url: '/b867direct', method: 'GET', param: { control: 'b867direct', file: 'content/b867page' } };
    // render-nunjucks, reached per render through setTemplate(file, '.njk')
    r.b867njk     = { url: '/b867njk', method: 'GET', param: { control: 'b867nunjucks', file: 'content/b867page' } };
    // a developer-authored param.path used as the template (render-swig's localOptions.path branch), read
    // relative to the cwd (the project dir here); ignoreWebRoot keeps the config loader's webroot rewrite off it
    r.b867path    = { url: '/b867path', method: 'GET', param: { control: 'b867show', file: 'b867pathpage', path: 'B867_PATH', ignoreWebRoot: true } };
    // an action answering 404: its custom error page lives in <sharedPath>/errors, outside the bundle
    r.b867missing = { url: '/b867missing', method: 'GET', param: { control: 'b867missing', file: 'content/b867page' } };
    // namespace 'content': controls resolve on controller.content.js
    r.b867nsdirect = { namespace: 'content', url: '/b867nsdirect', method: 'GET', param: { control: 'b867direct', file: 'b867page' } };
    r.b867nsst     = { namespace: 'content', url: '/b867nsst', method: 'GET', param: { control: 'b867setTemplate', file: 'b867page' } };
    // a developer-authored static `../` prefix that resolves back inside the root (must keep rendering)
    r.b867static   = { namespace: 'content', url: '/b867static', method: 'GET', param: { control: 'b867show', file: '../shared/b867static' } };
    fs.writeFileSync(rf, JSON.stringify(r, null, 2));

    var actions =
        "this.b867setTemplate = function(req, res) { self.setTemplate(req.get.tpl); self.render({ ok: true }); };\n    " +
        "this.b867errors = function(req, res) { self.setTemplate('errors/' + req.params.code); self.render({ ok: true }); };\n    " +
        "this.b867direct = function(req, res) { req.routing.param.file = req.get.tpl; self.render({ ok: true }); };\n    " +
        "this.b867nunjucks = function(req, res) { self.setTemplate(req.get.tpl, '.njk'); self.render({ ok: true }); };\n    " +
        "this.b867show = function(req, res) { self.render({ ok: true }); };\n    " +
        "this.b867missing = function(req, res) { self.throwError(res, 404, 'b867 missing'); };\n    ";
    injectOnce(path.join(src, 'controllers', 'controller.js'), 'this.onReady = function(req, res, next){', actions);
    injectOnce(path.join(src, 'controllers', 'controller.content.js'), '    this.home = function(req, res) {',
        "    this.b867direct = function(req, res) { req.routing.param.file = req.get.tpl; self.render({ ok: true }); };\n" +
        "    this.b867setTemplate = function(req, res) { self.setTemplate(req.get.tpl); self.render({ ok: true }); };\n" +
        "    this.b867show = function(req, res) { self.render({ ok: true }); };\n");

    // in the root
    fs.writeFileSync(path.join(tpl, 'html', 'content', 'b867page.html'), IN_ROOT + ' content\n');
    fs.mkdirSync(path.join(tpl, 'html', 'errors'), { recursive: true });
    fs.writeFileSync(path.join(tpl, 'html', 'errors', 'b867page.html'), IN_ROOT + ' errors\n');
    fs.writeFileSync(path.join(tpl, 'html', 'content', 'b867njkpage.njk'), NJK_IN_ROOT + '\n');
    fs.mkdirSync(path.join(tpl, 'html', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(tpl, 'html', 'shared', 'b867static.html'), STATIC_IN + '\n');
    // outside the root
    fs.writeFileSync(path.join(tpl, 'B867_SHALLOW.html'), SHALLOW + '\n');
    fs.writeFileSync(path.join(tpl, 'html.html'), DOT1 + '\n');
    fs.mkdirSync(path.join(tpl, 'html2'), { recursive: true });
    fs.writeFileSync(path.join(tpl, 'html2', 'b867sib.njk'), SIBLING + '\n');
    fs.writeFileSync(path.join(tpl, 'B867_NJK_UP.njk'), NJK_UP + '\n');
    fs.writeFileSync(path.join(PROJ_DIR, 'B867_DEEP.html'), DEEP + '\n');
    fs.writeFileSync(path.join(PROJ_DIR, 'B867_CWD.html'), CWD_MARK + '\n');
    fs.writeFileSync(path.join(PROJ_DIR, 'B867_PATH.html'), PATH_MARK + '\n');
    // a developer symlink inside the root, to a directory outside it: its pages render through it, but
    // a `..` behind it must not reach the target's parent (<project>/outside/B867_SYMLINK.html)
    fs.mkdirSync(path.join(PROJ_DIR, 'outside', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(PROJ_DIR, 'outside', 'inner', 'b867linked.html'), LINKED_OK + '\n');
    fs.writeFileSync(path.join(PROJ_DIR, 'outside', 'B867_SYMLINK.html'), SYMLINK_MARK + '\n');
    fs.symlinkSync(path.join(PROJ_DIR, 'outside', 'inner'), path.join(tpl, 'html', 'linked'));
    // the project's shared error pages (<sharedPath>/errors, scanned when the bundle config loads)
    fs.mkdirSync(path.join(PROJ_DIR, 'shared', 'errors'), { recursive: true });
    fs.writeFileSync(path.join(PROJ_DIR, 'shared', 'errors', '404.html'), SHARED_ERR + ' status={{ page.data.status }}\n');

    // a `.njk` section makes the bundle load nunjucks at startup (a per-render `.njk` needs the engine loaded)
    var tf = path.join(src, 'config', 'templates.json');
    var tj = JSON.parse(stripLineComments(fs.readFileSync(tf, 'utf8')));
    tj.b867njk = { ext: '.njk' };
    fs.writeFileSync(tf, JSON.stringify(tj, null, 2));
    // nunjucks is project-only: link the framework's devDependency into the project
    var njkSrc = path.join(GINA_ROOT, 'node_modules', 'nunjucks');
    if (!fs.existsSync(path.join(njkSrc, 'package.json'))) { throw new Error('nunjucks (a devDependency) is not installed under ' + GINA_ROOT); }
    fs.symlinkSync(njkSrc, path.join(PROJ_DIR, 'node_modules', 'nunjucks'));

    fs.writeFileSync(path.join(src, 'index.js'), [
        "var gina = require('gina');",
        'gina.onInitialize(function(event, app, express){ event.emit("complete", app); });',
        'gina.onError(function(err, req, res, next){ next(err); });',
        'gina.start();', ''
    ].join('\n'));
}

async function bootAndDrive() {
    var exit = null;
    // cwd inside the sandbox: a path render-swig reads relative to the cwd lands next to the markers
    var child = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], { env: CHILD_ENV, cwd: PROJ_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', function (d) { bundleOutput += d; });
    child.stderr.on('data', function (d) { bundleOutput += d; });
    child.on('exit', function (code, signal) { exit = { code: code, signal: signal }; });
    var alive = function () { return child.exitCode === null && child.signalCode === null; };
    var deadline = Date.now() + BOOT_TIMEOUT_MS, up = false;
    while (Date.now() < deadline && !exit) {
        if (await isTcpPortOpen(bundlePort)) { up = true; break; }
        await sleep(POLL_INTERVAL_MS);
    }
    if (!up) { setupError = 'the bundle did not come up: exit ' + JSON.stringify(exit) + '\n' + bundleOutput.slice(-1800); }
    else {
        await sleep(400);
        var wr = webroot.replace(/\/$/, '');
        var ARMS = {
            // controls — render before AND after the fix
            stInroot:       wr + '/b867st?tpl=content/b867page',
            stKnownNeg:     wr + '/b867st?tpl=does-not-exist-xyz',
            errInroot:      wr + '/b867err/b867page',
            directInroot:   wr + '/b867direct?tpl=content/b867page',
            nsDirectInroot: wr + '/b867nsdirect?tpl=b867page',
            nsStInroot:     wr + '/b867nsst?tpl=content/b867page',
            njkInroot:      wr + '/b867njk?tpl=content/b867njkpage',
            staticInside:   wr + '/b867static',
            symlinkLegit:   wr + '/b867st?tpl=linked/b867linked',
            sharedError:    wr + '/b867missing',
            njkUp:          wr + '/b867njk?tpl=..%2FB867_NJK_UP',
            // escapes — leak before the fix
            stShallow:      wr + '/b867st?tpl=..%2FB867_SHALLOW',
            stMid:          wr + '/b867st?tpl=content%2F..%2F..%2FB867_SHALLOW',
            stBsDeep:       wr + '/b867st?tpl=content%5C..%5C..%5C..%5C..%5C..%5CB867_DEEP',
            symlinkEsc:     wr + '/b867st?tpl=linked%5C..%5CB867_SYMLINK',
            errDot1:        wr + '/b867err/..',
            errBsShallow:   wr + '/b867err/..%5C..%5CB867_SHALLOW',
            errBsDeep:      wr + '/b867err/..%5C..%5C..%5C..%5C..%5CB867_DEEP',
            directMid:      wr + '/b867direct?tpl=content%2F..%2F..%2FB867_SHALLOW',
            directCwd:      wr + '/b867direct?tpl=.%2FB867_CWD',
            nsDirect:       wr + '/b867nsdirect?tpl=..%2F..%2FB867_SHALLOW',
            nsSt:           wr + '/b867nsst?tpl=..%2FB867_SHALLOW',
            njkSibling:     wr + '/b867njk?tpl=..%2Fhtml2%2Fb867sib',
            paramPath:      '/b867path'   // ignoreWebRoot: the route's url carries no webroot either
        };
        for (var k in ARMS) { results[k] = await getRaw(ARMS[k]); }
    }

    if (alive()) {
        try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
        var until = Date.now() + 12000;
        while (Date.now() < until && alive()) { await sleep(150); }
        if (alive()) {
            var m = bundleOutput.match(/\[ FRAMEWORK \]\[ (\d+) \]/);
            if (m) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch (e) { /* gone */ } }
            try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
        }
    }
    var free = Date.now() + 8000;
    while (Date.now() < free && await isTcpPortOpen(bundlePort)) { await sleep(150); }
}

describe('container-boot — #B867 the page template path is confined to the template root', function () {

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
        var va = runCli(['view:add', BUNDLE, '@' + PROJ]);
        if (!fs.existsSync(path.join(PROJ_DIR, 'src', BUNDLE, 'templates', 'html', 'layouts', 'main.html'))) {
            setupError = 'view:add did not install the templates: ' + (va.stdout + va.stderr).slice(-800); return;
        }
        try {
            var target = fs.realpathSync(path.join(PROJ_DIR, 'node_modules', 'gina'));
            if (target !== fs.realpathSync(GINA_ROOT)) { setupError = 'node_modules/gina resolves to ' + target + ', not ' + GINA_ROOT; return; }
        } catch (e) { setupError = 'node_modules/gina is not linked: ' + (e.message || e); return; }

        try { installFixture(); } catch (e) { setupError = 'fixture install failed: ' + (e.message || e); return; }

        var env = readJSON(projectsPath)[PROJ].def_env || 'dev';
        try { bundlePort = readJSON(portsReversePath)[key][env]['http/1.1']['http']; } catch (e) { bundlePort = null; }
        if (!bundlePort) { setupError = 'could not resolve the http/1.1 http port for ' + key; return; }
        try {
            var ss = fs.readFileSync(path.join(PROJ_DIR, 'src', BUNDLE, 'config', 'settings.server.json'), 'utf8');
            webroot = ((ss.match(/"webroot"\s*:\s*"([^"]*)"/) || [])[1] || ('/' + BUNDLE)).replace(/\/+$/, '') + '/';
        } catch (e) { webroot = '/' + BUNDLE + '/'; }

        await bootAndDrive();
    });

    after(async function () {
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* ignore */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        try { fs.rmdirSync(path.join(os.homedir(), '.' + PROJ)); } catch (e) { /* absent or non-empty: leave it */ }
    });

    function ready(t) {
        if (skip) { t.skip(skipReason); return false; }
        assert.equal(setupError, null, 'setup failed: ' + setupError);
        return true;
    }
    /** The arm rendered its in-root template. */
    function rendered(key, sentinel) {
        var r = results[key];
        assert.ok(r, key + ' ran');
        assert.equal(r.status, 200, key + ': ' + (r.err || String(r.body).slice(0, 300)));
        assert.ok(String(r.body).indexOf(sentinel) > -1, key + ': the in-root template rendered');
    }
    /** No marker in the answer, and the guard's 500 — not a render. */
    function blocked(key, sentinel) {
        var r = results[key];
        assert.ok(r, key + ' ran');
        assert.equal(String(r.body).indexOf(sentinel) > -1, false, key + ': marker LEAKED (status ' + r.status + ') — ' + String(r.body).slice(0, 200));
        assert.equal(r.status, 500, key + ': a refused template path answers 500 (got ' + r.status + ')');
    }
    /** The guard itself refused this route's template, by its full rule `<name>@<bundle>` (the message never quotes the request value). */
    function guardFired(name) {
        var rule = name + '@' + BUNDLE;
        assert.ok(bundleOutput.indexOf(GUARD_MESSAGE + ' `' + rule + '`') > -1,
            'the containment guard refused a template of route `' + rule + '` (bundle output carries its message)');
    }

    it('01 - in-root controls render on every branch: setTemplate, the published errors/ pattern, a direct write, both namespace forms, nunjucks', function (t) {
        if (!ready(t)) { return; }
        rendered('stInroot', IN_ROOT);
        rendered('errInroot', IN_ROOT);
        rendered('directInroot', IN_ROOT);
        rendered('nsDirectInroot', IN_ROOT);
        rendered('nsStInroot', IN_ROOT);
        rendered('njkInroot', NJK_IN_ROOT);
    });

    it('02 - not over-blocked: a developer-authored static `../` prefix that resolves back inside the root, and a page reached through a symlink inside the root', function (t) {
        if (!ready(t)) { return; }
        rendered('staticInside', STATIC_IN);
        rendered('symlinkLegit', LINKED_OK);
    });

    it('03 - a custom error page from <sharedPath>/errors, outside the bundle, still renders (the exemption)', function (t) {
        if (!ready(t)) { return; }
        var r = results.sharedError;
        assert.equal(r.status, 404, 'sharedError: ' + (r.err || String(r.body).slice(0, 300)));
        assert.ok(String(r.body).indexOf(SHARED_ERR + ' status=404') > -1, 'the shared 404 page rendered: ' + String(r.body).slice(0, 200));
    });

    it('04 - negative controls: an absent template and a non-sibling `..` under nunjucks leak nothing', function (t) {
        if (!ready(t)) { return; }
        [SHALLOW, DEEP, DOT1, CWD_MARK].forEach(function (m) { assert.equal(String(results.stKnownNeg.body).indexOf(m) > -1, false); });
        assert.notEqual(results.stKnownNeg.status, 200);
        blocked('njkUp', NJK_UP);
    });

    it('05 - setTemplate(<request value>) cannot leave the root — `..`, mid-string `..`, a backslash-separated `..` to the project root, and one behind a symlink inside the root', function (t) {
        if (!ready(t)) { return; }
        blocked('stShallow', SHALLOW);
        blocked('stMid', SHALLOW);
        blocked('stBsDeep', DEEP);
        blocked('symlinkEsc', SYMLINK_MARK);
        guardFired('b867st');
    });

    it('06 - the published example setTemplate(\'errors/\' + req.params.code) cannot leave the root — `..` and `%5C` segments', function (t) {
        if (!ready(t)) { return; }
        blocked('errDot1', DOT1);
        blocked('errBsShallow', SHALLOW);
        blocked('errBsDeep', DEEP);
        guardFired('b867err');
    });

    it('07 - a direct req.routing.param.file write cannot leave the root — mid-string `..`, and a leading `./` read relative to the cwd', function (t) {
        if (!ready(t)) { return; }
        blocked('directMid', SHALLOW);
        blocked('directCwd', CWD_MARK);
        guardFired('b867direct');
    });

    it('08 - the namespace branch cannot leave the root — a direct write and setTemplate', function (t) {
        if (!ready(t)) { return; }
        blocked('nsDirect', SHALLOW);
        blocked('nsSt', SHALLOW);
        guardFired('b867nsdirect');
        guardFired('b867nsst');
    });

    it('09 - render-nunjucks refuses a sibling directory whose name starts with the root\'s (the loader\'s unanchored prefix test)', function (t) {
        if (!ready(t)) { return; }
        blocked('njkSibling', SIBLING);
        guardFired('b867njk');
    });

    it('10 - a param.path template outside the root is refused too', function (t) {
        if (!ready(t)) { return; }
        blocked('paramPath', PATH_MARK);
        guardFired('b867path');
    });
});
