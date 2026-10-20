/**
 * #B934 — bin/gina-init reads its JSON files the way gina reads its others.
 *
 * gina-init parsed its config file (`GINA_INIT_CONFIG` / `--config`) and the
 * previous `settings.json` (for the `bind_host` it keeps, #B161) with a plain
 * `JSON.parse`. So a trailing comma or a `//` comment in the config file
 * stopped it (« failed to parse config file: <reason> », naming no file), and a
 * trailing comma in the previous `settings.json` silently reset an operator's
 * `bind_host` to the loopback default. Both now go through the
 * `parseJSONWithComments` global (comments and a trailing comma accepted, with
 * a warning; an error that names the file).
 *
 * The arms run the REAL bin/gina-init in a throwaway home:
 *   §01 the config file with a trailing comma: completes, a warning names it
 *   §02 the config file with a `//` comment line: completes
 *   §03 the config file malformed: exits 1, and the message names the file
 *   §04 the previous settings.json with `bind_host` and a trailing comma: kept
 *   §05 CONTROL: a valid config file completes
 *   §06 CONTROL: the previous settings.json without the comma keeps `bind_host`
 *
 * Pre-fix (measured on 3e359749e through the seam below): §01–§04 fail, the
 * controls pass.
 *
 * Seam: `B934_GINA_ROOT=<tree>` runs THAT tree's bin/gina-init.
 *
 * Run: node --test test/bin/gina-init-json-files-b934.test.js
 */
'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var { spawnSync } = require('child_process');
var { describe, it, after } = require('node:test');
var assert = require('node:assert/strict');

var TREE      = process.env.B934_GINA_ROOT || path.resolve(__dirname, '..', '..');
var GINA_INIT = path.join(TREE, 'bin', 'gina-init');
var SHORT     = JSON.parse(fs.readFileSync(path.join(TREE, 'package.json'), 'utf8')).version.split('.').slice(0, 2).join('.');
var TMP       = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gina-b934-init-'));

var VALID = '{\n    "project_name": "b934i",\n    "bundles": "demo"\n}\n';

/**
 * Builds a child environment: the runner's, without its GINA_* and Node
 * settings (`bun test` injects NODE_ENV), with every gina directory in the
 * arm's home.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {object} [extra] - Variables to add
 * @returns {object}
 */
function childEnv(home, extra) {
    var env = {};
    Object.keys(process.env).forEach(function (k) {
        if (!/^(GINA_|NODE_OPTIONS$|NODE_ENV$|NODE_SCOPE$|NPM_CONFIG_PREFIX$|npm_config_prefix$)/.test(k)) {
            env[k] = process.env[k];
        }
    });
    return Object.assign(env, {
        HOME              : home,
        GINA_HOMEDIR      : path.join(home, '.gina'),
        GINA_PROJECT_PATH : path.join(home, 'app'),
        GINA_PROJECT_HOME : path.join(home, '.b934i'),
        GINA_RUNDIR       : path.join(home, 'run'),
        GINA_LOGDIR       : path.join(home, 'log'),
        GINA_TMPDIR       : path.join(home, 'tmp'),
        GINA_PREFIX       : path.join(home, 'prefix')
    }, extra || {});
}

/**
 * Runs bin/gina-init once.
 *
 * @inner
 * @param {string} home - The arm's HOME
 * @param {object} [extra] - Variables to add to the child environment
 * @returns {{status: number, out: string}}
 */
function runInit(home, extra) {
    var r = spawnSync(process.execPath, [GINA_INIT], { cwd: home, env: childEnv(home, extra), encoding: 'utf8', timeout: 60000 });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * Makes a throwaway home with a config file holding `config` (unless null).
 *
 * @inner
 * @param {string} name - The arm's directory name
 * @param {string|null} config - The config file's content
 * @returns {{home: string, config: string}}
 */
function makeHome(name, config) {
    var home = path.join(TMP, name);
    ['app', 'tmp'].forEach(function (d) { fs.mkdirSync(path.join(home, d), { recursive: true }); });
    var file = path.join(home, 'init.json');
    if (config !== null) { fs.writeFileSync(file, config); }
    return { home: home, config: file };
}

/**
 * Runs gina-init once to write a settings.json, rewrites it with
 * `bind_host: 0.0.0.0` (and a trailing comma when asked), runs it again and
 * returns the `bind_host` it wrote back.
 *
 * @inner
 * @param {string} name - The arm's directory name
 * @param {boolean} trailingComma - Whether the previous settings.json ends with one
 * @returns {{first: object, second: object, bindHost: *}}
 */
function bindHostRoundTrip(name, trailingComma) {
    var h = makeHome(name, null);
    var env = { GINA_PROJECT_NAME: 'b934i', GINA_BUNDLES: 'demo' };
    var first = runInit(h.home, env);
    var file = path.join(h.home, '.gina', SHORT, 'settings.json');
    var obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    obj.bind_host = '0.0.0.0';
    var text = JSON.stringify(obj, null, 4);
    if (trailingComma) { text = text.replace(/\n\}$/, ',\n}'); }
    fs.writeFileSync(file, text + '\n');
    var second = runInit(h.home, env);
    return { first: first, second: second, bindHost: JSON.parse(fs.readFileSync(file, 'utf8')).bind_host };
}

function detail(r) { return '\n  status=' + r.status + '\n  output: ' + String(r.out).slice(-900); }

describe('#B934 - bin/gina-init reads its JSON files the way gina reads its others', function () {

    var skip = (process.platform === 'win32') ? 'gina-init is Unix-centric' : false;   // false, not null: node:test skips a test given `skip: null`

    after(function () {
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('§01 a config file with a trailing comma: gina-init completes, and a warning names the file', { skip: skip }, function () {
        var h = makeHome('a01', VALID.replace('"demo"\n', '"demo",\n'));
        var r = runInit(h.home, { GINA_INIT_CONFIG: h.config });
        assert.equal(r.status, 0, 'pre-fix: « failed to parse config file ».' + detail(r));
        assert.ok(JSON.parse(fs.readFileSync(path.join(h.home, '.gina', 'projects.json'), 'utf8')).b934i, 'the project is registered.' + detail(r));
        assert.ok(r.out.indexOf('trailing comma in `' + h.config + '`') > -1, detail(r));
    });

    it('§02 a config file with a // comment line: gina-init completes', { skip: skip }, function () {
        var h = makeHome('a02', '// written by hand\n' + VALID);
        var r = runInit(h.home, { GINA_INIT_CONFIG: h.config });
        assert.equal(r.status, 0, 'pre-fix: « Unexpected token \'/\' ».' + detail(r));
        assert.ok(JSON.parse(fs.readFileSync(path.join(h.home, '.gina', 'projects.json'), 'utf8')).b934i, detail(r));
    });

    it('§03 a malformed config file: exits 1, and the message names the file', { skip: skip }, function () {
        var h = makeHome('a03', VALID.slice(0, VALID.lastIndexOf('}')));
        var r = runInit(h.home, { GINA_INIT_CONFIG: h.config });
        assert.equal(r.status, 1, detail(r));
        var expected = '[gina-init] failed to parse config file: could not parse `' + h.config + '`';
        assert.ok(r.out.indexOf(expected) > -1, 'pre-fix: the message names no file; expected « ' + expected + ' ».' + detail(r));
    });

    it('§04 a trailing comma in the previous settings.json no longer drops its bind_host', { skip: skip }, function () {
        var rt = bindHostRoundTrip('a04', true);
        assert.equal(rt.first.status, 0, detail(rt.first));
        assert.equal(rt.second.status, 0, detail(rt.second));
        assert.equal(rt.bindHost, '0.0.0.0', 'pre-fix: reset to the loopback default.' + detail(rt.second));
    });

    it('§05 CONTROL: a valid config file completes', { skip: skip }, function () {
        var h = makeHome('a05', VALID);
        var r = runInit(h.home, { GINA_INIT_CONFIG: h.config });
        assert.equal(r.status, 0, detail(r));
        assert.equal(/trailing comma|failed to parse/.test(r.out), false, detail(r));
    });

    it('§06 CONTROL: the previous settings.json without the comma keeps its bind_host', { skip: skip }, function () {
        var rt = bindHostRoundTrip('a06', false);
        assert.equal(rt.second.status, 0, detail(rt.second));
        assert.equal(rt.bindHost, '0.0.0.0', detail(rt.second));
    });
});
