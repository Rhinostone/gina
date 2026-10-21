/**
 * #B928 — helpers/json reads the logger when a function runs.
 *
 * `lib/logger` requires the helpers, `helpers/json` among them, before it
 * assigns its exports (`module.exports = Logger()` comes last), so the logger
 * that `helpers/json` bound when it loaded was the logger's first, empty
 * exports. Every gina process loads the logger first (utils/helper does), so:
 *   - in gina-container and gina-init, whose only instance of `helpers/json`
 *     is that one, a trailing comma was REFUSED by `parseJSONWithComments()`
 *     and `requireJSON()` (the warning threw on the empty exports and the retry
 *     fell through to the parse error), and a malformed file THREW where
 *     `requireJSON()` documents « emerg + exit 1 »;
 *   - in every process, the logger's own reads while it loads (the home
 *     `settings.json`, its extension configs) refused a trailing comma: the
 *     home log level was lost, and an extension config with a comma left the
 *     process without a logger.
 * With the fix the logger is read at call time (`getLogger()`); while it is
 * still loading, a warning goes to node's own console and a failure still
 * throws into the logger's own `catch`.
 *
 * Each arm runs a child process that loads the tree the way the launchers do
 * (`require(<tree>/utils/helper)`) in a throwaway HOME, then calls the global:
 *   §01 parseJSONWithComments() on a trailing comma returns the value
 *   §02 requireJSON() on a file with a trailing comma returns the value
 *   §03 requireJSON() on a malformed file logs `emerg` and exits 1
 *   §04 the logger's own read of a home settings.json with a trailing comma
 *       keeps its log level (+ a CONTROL without the comma)
 *   §05 a malformed home settings.json is still swallowed by the logger's own
 *       read (the process goes on), and the next requireJSON() of it exits 1
 *   §06 an extension config with a trailing comma no longer stops the logger
 *   §07 a logger that cannot load (#B937) does not replace the caller's result
 *   §08 CONTROL: the helpers-first order, unchanged
 *   §09 source pin: no module-level binding of the logger
 *
 * Pre-fix (measured on 3e359749e through the seam below, under node and Bun):
 * §01–§07 and §09 fail (§05 on its second half), the §04 control and §08
 * pass. Subtracts on the fix: without the `try` in getLogger() only §07 fails;
 * reading `logger.emerg` instead of testing an own property fails §04 (node
 * prints the circular-dependency warning during the logger's own read) and §09.
 *
 * Seam: `B928_GINA_ROOT=<tree>` runs the arms against another tree.
 *
 * Run: node --test test/lib/helpers-json-logger-b928.test.js
 */
'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var ROOT    = process.env.B928_GINA_ROOT || path.resolve(__dirname, '..', '..');
var VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
var SHORT   = VERSION.split('.').slice(0, 2).join('.');
var FW      = path.join(ROOT, 'framework', 'v' + VERSION);
var TMP     = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b928-'));
var CHILD   = path.join(TMP, 'child.js');

var CIRCULAR = 'inside circular dependency';

/**
 * The child: loads the tree in the order `mode` names, runs one call, and
 * reports on stdout through synchronous writes (a `process.exit()` inside
 * `requireJSON()` would drop an asynchronous one).
 *
 * argv: <root> <fw> <mode> [file]
 *   bootstrap-pjwc         utils/helper, then parseJSONWithComments('{"a":1,}', 'x.json')
 *   bootstrap-rj           utils/helper, then requireJSON(<file>)
 *   bootstrap-logger       utils/helper, then the logger's level and whether it loaded
 *   helpers-first-rj       <fw>/helpers, then <fw>/lib/logger, then requireJSON(<file>)
 *   helpers-first-pjwc     <fw>/helpers, then <fw>/lib/logger, then the parseJSONWithComments() call
 */
var CHILD_SOURCE = [
    "'use strict';",
    "var fs = require('fs');",
    "var root = process.argv[2], fw = process.argv[3], mode = process.argv[4], file = process.argv[5];",
    "function say(s) { fs.writeSync(1, '\\n@@ ' + s + '\\n'); }",
    "process.on('exit', function (c) { say('EXIT ' + c); });",
    "function attempt(label, fn) {",
    "    try { say(label + ' RETURNED ' + JSON.stringify(fn())); }",
    "    catch (e) { say(label + ' THREW ' + String(e && e.message).split('\\n')[0].slice(0, 200)); }",
    "}",
    "if (/^bootstrap/.test(mode)) {",
    "    attempt('BOOTSTRAP', function () { require(root + '/utils/helper'); return 'ok'; });",
    "} else {",
    "    require(fw + '/helpers');",
    "    require(fw + '/lib/logger');",
    "}",
    "if (/-pjwc$/.test(mode)) { attempt('CALL', function () { return parseJSONWithComments('{\"a\":1,}', 'x.json'); }); }",
    "if (/-rj$/.test(mode)) { attempt('CALL', function () { return requireJSON(file); }); }",
    "if (mode === 'bootstrap-logger') {",
    "    attempt('LOGGER', function () {",
    "        var lg = require(fw + '/lib/logger');",
    "        return { loaded: typeof lg.warn === 'function' };",
    "    });",
    "    attempt('CALL', function () { return parseJSONWithComments('{\"a\":1,}', 'x.json'); });",
    "}",
    ""
].join('\n');

/**
 * Builds a child environment: the runner's, without its GINA_* and Node
 * settings (`bun test` injects NODE_ENV) and without LOG_LEVEL, with HOME and
 * the run, log, tmp and prefix directories pinned in the arm's home.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @returns {object}
 */
function childEnv(home) {
    var env = {};
    Object.keys(process.env).forEach(function (k) {
        if (!/^(GINA_|NODE_OPTIONS$|NODE_ENV$|NODE_SCOPE$|LOG_LEVEL$|NPM_CONFIG_PREFIX$|npm_config_prefix$)/.test(k)) {
            env[k] = process.env[k];
        }
    });
    env.HOME            = home;
    env.GINA_LOG_STDOUT = 'true';
    env.GINA_PREFIX     = path.join(home, 'prefix');
    env.GINA_RUNDIR     = path.join(home, 'run');
    env.GINA_LOGDIR     = path.join(home, 'log');
    env.GINA_TMPDIR     = path.join(home, 'tmp');
    return env;
}

/**
 * Makes a throwaway home. `files` maps a path relative to the home to its
 * content.
 *
 * @inner
 * @param {string} name - The arm's directory name
 * @param {object} [files] - Files to write
 * @returns {string} the home
 */
function makeHome(name, files) {
    var home = path.join(TMP, name);
    ['prefix', 'run', 'log', 'tmp'].forEach(function (d) { fs.mkdirSync(path.join(home, d), { recursive: true }); });
    Object.keys(files || {}).forEach(function (rel) {
        var p = path.join(home, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, files[rel]);
    });
    return home;
}

/**
 * Runs the child once. Its stdout and stderr are files, not pipes: a pipe
 * write just before `process.exit(1)` can be lost, and §03 / §05 read the
 * `emerg` line written right before that exit.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {string} mode - The child mode
 * @param {string} [file] - The file the call reads
 * @returns {{status: number, out: string, err: string, marks: string[]}}
 */
function run(home, mode, file) {
    var outFile = path.join(home, 'child.out'), errFile = path.join(home, 'child.err');
    var outFd = fs.openSync(outFile, 'w'), errFd = fs.openSync(errFile, 'w');
    var r;
    try {
        r = spawnSync(process.execPath, [CHILD, ROOT, FW, mode].concat(file ? [file] : []), {
            cwd: home, env: childEnv(home), stdio: ['ignore', outFd, errFd], timeout: 60000
        });
    } finally {
        fs.closeSync(outFd);
        fs.closeSync(errFd);
    }
    var out = fs.readFileSync(outFile, 'utf8');
    var marks = out.split('\n').filter(function (l) { return /^@@ /.test(l); }).map(function (l) { return l.slice(3); });
    return { status: r.status, out: out, err: fs.readFileSync(errFile, 'utf8'), marks: marks };
}

/**
 * Renders a child result for an assertion message.
 *
 * @inner
 * @param {object} r - A run() result
 * @returns {string}
 */
function detail(r) {
    return '\n  status=' + r.status + '\n  marks: ' + JSON.stringify(r.marks)
        + '\n  stdout: ' + r.out.slice(-900) + '\n  stderr: ' + r.err.slice(-900);
}

/**
 * The home settings.json the CLI writes, reduced to what the logger reads.
 *
 * @inner
 * @param {boolean} trailingComma - Whether to end it with a trailing comma
 * @returns {string}
 */
function homeSettings(trailingComma) {
    return '{\n    "version": "' + VERSION + '",\n    "log_level": "debug"' + (trailingComma ? ',' : '') + '\n}\n';
}

/**
 * Removes `//` and `/* *\/` comments from JavaScript source, string-aware, so a
 * pin cannot match the `was:` comments the fix keeps.
 *
 * @inner
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
    var out = '', i = 0, n = src.length, q = null;
    while (i < n) {
        var c = src[i], d = src[i + 1];
        if (q) { out += c; if (c === '\\') { out += d; i += 2; continue; } if (c === q) { q = null; } i++; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { i++; } continue; }
        if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { i++; } i += 2; continue; }
        out += c; i++;
    }
    return out;
}

describe('#B928 - helpers/json reads the logger when a function runs', function () {

    var skip = (process.platform === 'win32') ? 'the launchers are Unix-centric' : false;   // false, not null: node:test skips a test given `skip: null`

    before(function () {
        fs.writeFileSync(CHILD, CHILD_SOURCE);
    });

    after(function () {
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('§01 the launchers\' bootstrap: parseJSONWithComments() accepts a trailing comma, with a warning', { skip: skip }, function () {
        var r = run(makeHome('h01'), 'bootstrap-pjwc');
        assert.ok(r.marks.indexOf('CALL RETURNED {"a":1}') > -1, 'pre-fix: « could not parse `x.json` ».' + detail(r));
        assert.ok(/trailing comma in `x\.json`/.test(r.out + r.err), 'the warning names the text.' + detail(r));
        assert.equal((r.out + r.err).indexOf(CIRCULAR), -1, 'no read of a missing property on the loading logger.' + detail(r));
        assert.ok(r.marks.indexOf('EXIT 0') > -1, detail(r));
    });

    it('§02 the launchers\' bootstrap: requireJSON() accepts a trailing comma, with a warning', { skip: skip }, function () {
        var home = makeHome('h02', { 'f.json': '{ "a": 1, }' });
        var r = run(home, 'bootstrap-rj', path.join(home, 'f.json'));
        assert.ok(r.marks.indexOf('CALL RETURNED {"a":1}') > -1, 'pre-fix: « could not parse ».' + detail(r));
        assert.ok(/\[ requireJSON \] trailing comma in `[^`]*f\.json`/.test(r.out + r.err), detail(r));
        assert.equal((r.out + r.err).indexOf(CIRCULAR), -1, detail(r));
    });

    it('§03 the launchers\' bootstrap: requireJSON() on a malformed file logs emerg and exits 1', { skip: skip }, function () {
        var home = makeHome('h03', { 'bad.json': '{ "a": 1' });
        var r = run(home, 'bootstrap-rj', path.join(home, 'bad.json'));
        assert.equal(r.status, 1, 'pre-fix: requireJSON() threw and the child went on (exit 0).' + detail(r));
        assert.ok(r.marks.indexOf('EXIT 1') > -1, detail(r));
        assert.equal(r.marks.filter(function (m) { return /^CALL /.test(m); }).length, 0, 'the call neither returned nor threw.' + detail(r));
        assert.ok(/"level":"emerg"/.test(r.out) && /could not parse `[^`]*bad\.json`/.test(r.out), 'an emerg line naming the file.' + detail(r));
    });

    it('§04 the logger\'s own read of a home settings.json with a trailing comma keeps its log level', { skip: skip }, function () {
        var r = run(makeHome('h04', { ['.gina/' + SHORT + '/settings.json']: homeSettings(true) }), 'bootstrap-logger');
        assert.ok(r.marks.indexOf('BOOTSTRAP RETURNED "ok"') > -1, detail(r));
        assert.ok(/New Logger instance created/.test(r.out), 'the level `debug` was read: pre-fix the read failed and the level stayed `info`.' + detail(r));
        assert.ok(/\[ requireJSON \] trailing comma in `[^`]*settings\.json`/.test(r.err), 'the warning goes to node\'s console while the logger loads.' + detail(r));
        assert.equal((r.out + r.err).indexOf(CIRCULAR), -1, detail(r));
    });

    it('§04 CONTROL: the same home settings.json without the comma', { skip: skip }, function () {
        var r = run(makeHome('h04c', { ['.gina/' + SHORT + '/settings.json']: homeSettings(false) }), 'bootstrap-logger');
        assert.ok(/New Logger instance created/.test(r.out), 'the instrument reads the level.' + detail(r));
        assert.equal(/trailing comma in `[^`]*settings\.json`/.test(r.out + r.err), false, detail(r));
    });

    it('§05 a malformed home settings.json: swallowed by the logger\'s own read, refused by the next requireJSON()', { skip: skip }, function () {
        var home = makeHome('h05', { ['.gina/' + SHORT + '/settings.json']: '{ "log_level": "debug"' });
        var r = run(home, 'bootstrap-rj', path.join(home, '.gina', SHORT, 'settings.json'));
        // §05a — the logger's read still throws into its own catch: the bootstrap returns, nothing exits there
        assert.ok(r.marks.indexOf('BOOTSTRAP RETURNED "ok"') > -1, 'the bootstrap returns.' + detail(r));
        // §05b — the next reader exits as documented
        assert.equal(r.status, 1, 'pre-fix: requireJSON() threw.' + detail(r));
        assert.ok(/"level":"emerg"/.test(r.out) && /could not parse `[^`]*settings\.json`/.test(r.out), detail(r));
    });

    it('§06 a logger extension config with a trailing comma no longer stops the logger', { skip: skip }, function () {
        var r = run(makeHome('h06', { '.gina/user/extensions/logger/default/config.json': '{\n    "name": "gina",\n}\n' }), 'bootstrap-logger');
        assert.ok(r.marks.indexOf('LOGGER RETURNED {"loaded":true}') > -1, 'pre-fix: the logger failed to load (« could not parse »).' + detail(r));
        assert.ok(/trailing comma in `[^`]*config\.json`/.test(r.err), detail(r));
    });

    it('§07 a logger that cannot load does not replace the caller\'s result (#B937)', { skip: skip }, function () {
        var r = run(makeHome('h07', { '.gina/user/extensions/logger/default/config.json': '{\n    "name": "gina"\n' }), 'bootstrap-logger');
        assert.ok(/^LOGGER THREW /.test(r.marks.filter(function (m) { return /^LOGGER /.test(m); })[0] || ''), 'the instrument: this logger cannot load.' + detail(r));
        assert.ok(r.marks.indexOf('CALL RETURNED {"a":1}') > -1, 'pre-fix: « could not parse `x.json` ».' + detail(r));
        assert.ok(/trailing comma in `x\.json`/.test(r.err), 'the warning goes to node\'s console.' + detail(r));
    });

    it('§08 CONTROL: helpers loaded first — requireJSON() exits 1 on a malformed file, a trailing comma parses', { skip: skip }, function () {
        var home = makeHome('h08', { 'bad.json': '{ "a": 1' });
        var r1 = run(home, 'helpers-first-rj', path.join(home, 'bad.json'));
        assert.equal(r1.status, 1, detail(r1));
        assert.ok(/could not parse `[^`]*bad\.json`/.test(r1.out), detail(r1));
        var r2 = run(home, 'helpers-first-pjwc');
        assert.ok(r2.marks.indexOf('CALL RETURNED {"a":1}') > -1, detail(r2));
    });

    it('§09 source pin: helpers/json binds no logger when it loads', function () {
        var raw  = fs.readFileSync(path.join(FW, 'helpers', 'json', 'src', 'main.js'), 'utf8');
        var code = stripComments(raw);
        assert.ok(raw.indexOf("// was: var console = require('./../../../lib/logger');") > -1, 'control: the raw text keeps the old line as a was: comment');
        assert.equal(/\bvar\s+console\s*=/.test(code), false, 'no module-level `console` binding');
        assert.ok(/^\s*require\('\.\/\.\.\/\.\.\/\.\.\/lib\/logger'\);/m.test(code), 'the module-level require stays (load order unchanged)');
        assert.ok(/hasOwnProperty\.call\(logger,\s*'emerg'\)/.test(code), 'getLogger() tests an own property');
    });
});
