/**
 * #B687 — gina-init, gina-container and the install step write `~/.gina` state files whole.
 *
 * Three writers rewrote state files in place with a bare `fs.writeFileSync`, whose
 * O_TRUNC leaves the file empty, then half written, while another process (a container
 * sharing `~/.gina`, a CLI command during an install) may be parsing it, and every state
 * read is fatal on a parse error (#B43):
 *   - bin/gina-init           writeJSON(): projects.json, ports.json, ports.reverse.json,
 *                             <short>/settings.json
 *   - bin/gina-container      §3b: main.json, when def_framework is stale
 *   - script/post_install.js  main.json and <short>/main.json (def_framework, the
 *                             frameworks list, def_global_mode)
 * Each now writes a temp file in the same directory and renames it into place, the
 * #B43 shape, and an existing file keeps its mode.
 *
 * Harness: the REAL bin/gina-init and bin/gina-container, run with the current runtime
 * in a temp HOME and GINA_HOMEDIR, with a preloaded spy that records every
 * `fs.writeFileSync(<path>)` and `fs.renameSync(<from>, <to>)`. post_install.js needs
 * npm lifecycle state to run, so its sites are pinned in source.
 *
 *   §00 controls: the spy records a direct write it is given; gina-init writes its 4 files
 *   §01 gina-init: each file is renamed in from a sibling temp, never written directly
 *                                                                          [red pre-fix]
 *   §02 gina-container: main.json is renamed in from a sibling temp, and def_framework
 *       is synced                                                          [red pre-fix]
 *   §03 an existing file keeps its mode (gina-init and gina-container)
 *   §04 post_install.js: no main.json is written in place, and its helper renames
 *                                                                          [red pre-fix]
 *
 * Run: node --test test/bin/state-write-atomic-b687.test.js
 */
'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync } = require('child_process');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');

var TREE         = path.resolve(__dirname, '..', '..');
var GINA_INIT    = path.join(TREE, 'bin', 'gina-init');
var CONTAINER    = path.join(TREE, 'bin', 'gina-container');
var POST_INSTALL = path.join(TREE, 'script', 'post_install.js');
var VERSION      = require(path.join(TREE, 'package.json')).version;
var SHORT        = VERSION.split('.').slice(0, 2).join('.');
var PRELOAD      = process.versions.bun ? '--preload' : '--require';
var SKIP         = (process.platform === 'win32') ? 'gina-init and gina-container are Unix-centric' : false;   // false, not null
var TMP          = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b687-'));
var SPY          = path.join(TMP, 'spy.js');
var STALE_MAIN   = JSON.stringify({ def_framework: '0.0.1', frameworks: { '0.0': ['0.0.1'] } }, null, 4);

fs.writeFileSync(SPY, [
    "'use strict';",
    "var fs = require('fs');",
    "var fd = fs.openSync(process.env.B687_SPY_LOG, 'a');",
    "var origWrite = fs.writeFileSync, origRename = fs.renameSync;",
    "function rec(o) { fs.writeSync(fd, JSON.stringify(o) + '\\n'); }",
    "fs.writeFileSync = function (p) { if (typeof p === 'string') rec({ fn: 'writeFileSync', path: p }); return origWrite.apply(this, arguments); };",
    "fs.renameSync = function (a, b) { rec({ fn: 'renameSync', from: String(a), to: String(b) }); return origRename.apply(this, arguments); };"
].join('\n'));

after(function () {
    fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Creates a temp HOME with an empty `.gina` for one arm.
 *
 * @inner
 * @param {string} label - the arm's directory name
 * @returns {{base: string, home: string, gh: string}} the arm root, HOME and GINA_HOMEDIR
 */
function makeHome(label) {
    var base = path.join(TMP, label);
    var home = path.join(base, 'home');
    var gh   = path.join(home, '.gina');
    fs.mkdirSync(gh, { recursive: true });
    return { base: base, home: home, gh: gh };
}

/**
 * Runs a gina binary in an arm's home, with the spy preloaded when `spyLog` is given.
 *
 * @inner
 * @param {string} bin      - absolute path of bin/gina-init or bin/gina-container
 * @param {object} h        - the arm's home, from makeHome()
 * @param {string} [spyLog] - file the spy appends its records to
 * @returns {object} the spawnSync result (status, stdout, stderr)
 */
function runBin(bin, h, spyLog) {
    var env = Object.assign({}, process.env, {
        HOME              : h.home,
        GINA_HOMEDIR      : h.gh,
        // minimal bootstrap identity — gina-init refuses to run without a project
        GINA_PROJECT_NAME : 'demo',
        GINA_BUNDLES      : 'web'
    });
    delete env.GINA_INIT_CONFIG;
    delete env.GINA_BIND_HOST;
    if (spyLog) env.B687_SPY_LOG = spyLog;
    var args = (spyLog ? [PRELOAD, SPY] : []).concat([bin]);
    return spawnSync(process.execPath, args, { env: env, encoding: 'utf8', timeout: 60000 });
}

/**
 * Reads the spy's records.
 *
 * @inner
 * @param {string} spyLog - the spy's log file
 * @returns {object[]} one `{fn, path}` or `{fn, from, to}` record per call
 */
function readRecords(spyLog) {
    if (!fs.existsSync(spyLog)) return [];
    return fs.readFileSync(spyLog, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

/**
 * Counts how a file was reached: written directly, or renamed in from a sibling temp
 * (`<file>.<suffix>`).
 *
 * @inner
 * @param {object[]} records - the spy's records
 * @param {string}   target  - the file's absolute path
 * @returns {{direct: number, renamedFromSibling: number}}
 */
function writesTo(records, target) {
    return {
        direct: records.filter(function (r) { return r.fn === 'writeFileSync' && r.path === target; }).length,
        renamedFromSibling: records.filter(function (r) {
            return r.fn === 'renameSync' && r.to === target && r.from.indexOf(target + '.') === 0;
        }).length
    };
}

/**
 * Lists the `.tmp` files left under a directory, as paths relative to it.
 *
 * @inner
 * @param {string} dir - the directory to walk
 * @returns {string[]}
 */
function leftoverTmp(dir) {
    var out = [];
    (function walk(d) {
        fs.readdirSync(d).forEach(function (name) {
            var p = path.join(d, name);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (/\.tmp$/.test(name)) out.push(path.relative(dir, p));
        });
    })(dir);
    return out;
}

describe('00 - #B687: controls', function () {

    it('the spy records a direct write it is given', { skip: SKIP }, function () {
        var h      = makeHome('control');
        var spyLog = path.join(h.base, 'spy.log');
        var target = path.join(h.base, 'direct.json');
        var r = spawnSync(process.execPath, [PRELOAD, SPY, '-e', 'require("fs").writeFileSync(' + JSON.stringify(target) + ', "{}")'],
            { env: Object.assign({}, process.env, { B687_SPY_LOG: spyLog }), encoding: 'utf8', timeout: 30000 });
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(writesTo(readRecords(spyLog), target), { direct: 1, renamedFromSibling: 0 });
    });

    it('gina-init writes its four files', { skip: SKIP }, function () {
        var h = makeHome('ready');
        var r = runBin(GINA_INIT, h);
        assert.equal(r.status, 0, r.stdout + r.stderr);
        ['projects.json', 'ports.json', 'ports.reverse.json', SHORT + '/settings.json'].forEach(function (f) {
            assert.doesNotThrow(function () { JSON.parse(fs.readFileSync(path.join(h.gh, f), 'utf8')); }, f);
        });
    });
});

describe('01 - #B687: gina-init writes each file whole', function () {

    var h = null, run = null, records = [];
    before(function () {
        if (SKIP) return;
        h = makeHome('init');
        var spyLog = path.join(h.base, 'spy.log');
        run = runBin(GINA_INIT, h, spyLog);
        records = readRecords(spyLog);
    });

    it('exits 0', { skip: SKIP }, function () {
        assert.equal(run.status, 0, run.stdout + run.stderr);
    });

    ['projects.json', 'ports.json', 'ports.reverse.json', SHORT + '/settings.json'].forEach(function (f) {
        it(f + ' is renamed in from a sibling temp, never written directly', { skip: SKIP }, function () {
            assert.deepEqual(writesTo(records, path.join(h.gh, f)), { direct: 0, renamedFromSibling: 1 });
        });
    });

    it('leaves no temp file behind', { skip: SKIP }, function () {
        assert.deepEqual(leftoverTmp(h.gh), []);
    });
});

describe('02 - #B687: gina-container writes main.json whole', function () {

    var h = null, run = null, records = [], main = null;
    before(function () {
        if (SKIP) return;
        h = makeHome('container');
        assert.equal(runBin(GINA_INIT, h).status, 0, 'gina-init failed');
        fs.writeFileSync(path.join(h.gh, 'main.json'), STALE_MAIN);
        var spyLog = path.join(h.base, 'spy.log');
        // no `<bundle> @<project>`: §3b syncs main.json, then §4 prints the usage line
        run = runBin(CONTAINER, h, spyLog);
        records = readRecords(spyLog);
        main = JSON.parse(fs.readFileSync(path.join(h.gh, 'main.json'), 'utf8'));
    });

    it('syncs def_framework, then stops at the usage line', { skip: SKIP }, function () {
        assert.equal(main.def_framework, VERSION);
        assert.match(run.stdout, /Usage: gina-container/);
    });

    it('main.json is renamed in from a sibling temp, never written directly', { skip: SKIP }, function () {
        assert.deepEqual(writesTo(records, path.join(h.gh, 'main.json')), { direct: 0, renamedFromSibling: 1 });
    });

    it('leaves no temp file behind', { skip: SKIP }, function () {
        assert.deepEqual(leftoverTmp(h.gh), []);
    });
});

describe('03 - #B687: an existing file keeps its mode', function () {

    it('gina-init keeps projects.json at 0600', { skip: SKIP }, function () {
        var h = makeHome('mode-init');
        assert.equal(runBin(GINA_INIT, h).status, 0);
        var p = path.join(h.gh, 'projects.json');
        fs.chmodSync(p, 0o600);
        assert.equal(runBin(GINA_INIT, h).status, 0);
        assert.equal((fs.statSync(p).mode & 0o777).toString(8), '600');
    });

    it('gina-container keeps main.json at 0600', { skip: SKIP }, function () {
        var h = makeHome('mode-container');
        assert.equal(runBin(GINA_INIT, h).status, 0);
        var p = path.join(h.gh, 'main.json');
        fs.writeFileSync(p, STALE_MAIN);
        fs.chmodSync(p, 0o600);
        runBin(CONTAINER, h);
        assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).def_framework, VERSION, 'main.json was not rewritten');
        assert.equal((fs.statSync(p).mode & 0o777).toString(8), '600');
    });
});

describe('04 - #B687: post_install.js writes main.json whole', function () {

    var src    = fs.readFileSync(POST_INSTALL, 'utf8');
    var start  = src.indexOf('// Sync main.json def_framework to the installed version.');
    var end    = src.indexOf('Could not seed def_global_mode');
    var region = (start > -1 && end > start) ? src.slice(start, end) : '';
    var code   = region.replace(/\/\/.*$/gm, '');   // the region's comments are all `//`

    it('the main.json region is found and still names both paths', function () {
        assert.ok(region.length > 0, 'the def_framework / def_global_mode region was not found');
        assert.match(code, /_mainJsonPath/);
        assert.match(code, /_versionMainPath/);
    });

    it('no main.json path is written in place', function () {
        assert.doesNotMatch(code, /fs\.writeFileSync\(\s*(_mainJsonPath|_versionMainPath)\b/);
    });

    it('the four writes go through the helper', function () {
        assert.equal((code.match(/_writeMainJSON\(\s*(_mainJsonPath|_versionMainPath)\s*,/g) || []).length, 4);
    });

    it('the helper writes a sibling temp, keeps the mode and renames it into place', function () {
        var m = src.match(/var _writeMainJSON = function\s*\(target, data\)\s*\{[\s\S]*?\n\s*\};/);
        assert.ok(m, '_writeMainJSON was not found');
        assert.match(m[0], /var _tmp = target \+ '\.' \+ process\.pid \+ '\.tmp'/);
        assert.match(m[0], /fs\.writeFileSync\(\s*_tmp\s*,/);
        assert.match(m[0], /fs\.chmodSync\(\s*_tmp\s*,\s*fs\.statSync\(target\)\.mode & 0o777\s*\)/);
        assert.match(m[0], /fs\.renameSync\(\s*_tmp\s*,\s*target\s*\)/);
        assert.match(m[0], /fs\.unlinkSync\(\s*_tmp\s*\)/);
    });
});
