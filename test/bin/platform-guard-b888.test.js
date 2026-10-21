/**
 * #B888 — on native Windows, every installed command and both install scripts
 * stop first, with one message.
 *
 * Measured on a windows-latest runner (2026-10-15): the npm preinstall threw
 * `Windows in not yet fully supported` with a stack trace, and an install that
 * skipped the install scripts (a Bun install, or `npm install --ignore-scripts`)
 * reached a first-run crash in `bin/cli`. `bin/gina`, `bin/gina-init`,
 * `bin/gina-container`, `script/pre_install.js` and `script/post_install.js`
 * now open with the same inlined check. It is inlined, not required, so each
 * file keeps working when a test or a tool copies it on its own.
 *
 *   01 — each entry point, run with process.platform forced to win32, exits 1
 *        with the message and nothing else: no stack trace, nothing on stdout,
 *        nothing written to the home directory
 *   02 — the inlined block, run alone, refuses win32 and lets linux and darwin through
 *   03 — source pins: the block is the first statement of each entry point,
 *        and it is byte-identical in all five
 *
 * Section 01 forces the platform with a preload and runs the real entry points,
 * so HOME, USERPROFILE and GINA_HOMEDIR point into a temp directory: if the
 * check ever stopped running first, nothing would land in the real ~/.gina.
 */

'use strict';

var fs        = require('fs');
var os        = require('os');
var path      = require('path');
var spawnSync = require('child_process').spawnSync;
var { describe, it, before, after } = require('node:test');
var assert    = require('node:assert/strict');

var ROOT       = path.resolve(__dirname, '..', '..');
var GUARD_LINE = "if ( process.platform === 'win32' ) {";
var MESSAGE    = 'gina does not run natively on Windows.\n'
               + 'Run it inside WSL2 or a Docker container: https://gina.io/docs/getting-started/installation#windows\n';
var ENTRIES    = [
    'bin/gina',
    'bin/gina-init',
    'bin/gina-container',
    'script/pre_install.js',
    'script/post_install.js'
];

var tmp, preloads = {};

before(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-b888-'));
    ['win32', 'linux', 'darwin'].forEach(function (p) {
        preloads[p] = path.join(tmp, 'force-' + p + '.js');
        fs.writeFileSync(preloads[p], 'Object.defineProperty(process, \'platform\', { value: ' + JSON.stringify(p) + ' });\n');
    });
});

after(function () {
    fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Environment for a child process: the parent's, with the home directories
 * moved into the temp dir and npm's lifecycle and the test runner's variables
 * dropped.
 *
 * @param {string} homeDir - The temp home directory for this child.
 * @returns {object} The child environment.
 */
function childEnv(homeDir) {
    var env = Object.assign({}, process.env, {
        HOME         : homeDir,
        USERPROFILE  : homeDir,
        GINA_HOMEDIR : path.join(homeDir, '.gina')
    });
    Object.keys(env).forEach(function (k) {
        if ( /^npm_/i.test(k) || k === 'NODE_TEST_CONTEXT' ) {
            delete env[k];
        }
    });
    return env;
}

/**
 * Runs node with `args` in a child process, with a fresh temp home.
 *
 * @param {string[]} args - Arguments for node.
 * @returns {{ r: object, home: string }} The `spawnSync` result and the home used.
 */
function runNode(args) {
    var home = fs.mkdtempSync(path.join(tmp, 'home-'));
    var r = spawnSync(process.execPath, args, {
        cwd      : tmp,
        env      : childEnv(home),
        encoding : 'utf8',
        timeout  : 30000
    });
    return { r: r, home: home };
}

/**
 * The first code line of a source: not blank, not a comment, not the shebang,
 * not `'use strict';`.
 *
 * @param {string} src - A JavaScript source.
 * @returns {string|null} That line, trimmed, or null when there is none.
 */
function firstCodeLine(src) {
    var lines = src.split('\n'), inBlock = false;
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (inBlock) {
            if (l.indexOf('*/') > -1) inBlock = false;
            continue;
        }
        if (l.indexOf('/*') === 0) {
            if (l.indexOf('*/') === -1) inBlock = true;
            continue;
        }
        if (l === '' || l.indexOf('//') === 0 || l.indexOf('#!') === 0 || l === "'use strict';") continue;
        return l;
    }
    return null;
}

/**
 * The inlined check of an entry point: from its `if` line to its closing brace.
 *
 * @param {string} src - The entry point's source.
 * @returns {string|null} The block, or null when the source has none.
 */
function guardBlock(src) {
    var start = src.indexOf(GUARD_LINE);
    if (start < 0) return null;
    var end = src.indexOf('\n}\n', start);
    return end < 0 ? null : src.slice(start, end + 3);
}

/**
 * An entry point's source with LF line endings: `script/post_install.js` is a
 * CRLF file, and its block carries CRLF like the rest of it.
 *
 * @param {string} entry - Path of the entry point, from the repository root.
 * @returns {string} The source, CRLF turned into LF.
 */
function readEntry(entry) {
    return fs.readFileSync(path.join(ROOT, entry), 'utf8').replace(/\r\n/g, '\n');
}


describe('01 - each entry point stops first on win32', function () {

    ENTRIES.forEach(function (entry) {
        it(entry, function () {
            var run = runNode(['-r', preloads.win32, path.join(ROOT, entry), 'version']);
            assert.equal(run.r.error, undefined, String(run.r.error));
            assert.equal(run.r.status, 1, 'exit code; stderr: ' + run.r.stderr);
            assert.equal(run.r.stderr, MESSAGE, 'the refusal and nothing else on stderr');
            assert.equal(run.r.stdout, '', 'nothing on stdout');
            assert.deepEqual(fs.readdirSync(run.home), [], 'nothing written to the home directory');
        });
    });
});


describe('02 - the inlined block, run alone', function () {

    var block;
    before(function () {
        block = guardBlock(readEntry('bin/gina'));
        assert.ok(block, 'bin/gina carries the block');
    });

    function runBlock(platform) {
        var script = path.join(tmp, 'block-' + platform + '.js');
        fs.writeFileSync(script, block + "process.stdout.write('continued');\n");
        return runNode(['-r', preloads[platform], script]).r;
    }

    it('refuses win32 with exit 1 and the message', function () {
        var r = runBlock('win32');
        assert.equal(r.status, 1, r.stderr);
        assert.equal(r.stderr, MESSAGE);
        assert.equal(r.stdout, '');
    });

    ['linux', 'darwin'].forEach(function (p) {
        it('lets ' + p + ' through', function () {
            var r = runBlock(p);
            assert.equal(r.status, 0, r.stderr);
            assert.equal(r.stdout, 'continued');
            assert.equal(r.stderr, '');
        });
    });
});


describe('03 - source pins', function () {

    it('the instruments tell a guarded source from an unguarded one', function () {
        var unguarded = "#!/usr/bin/env node\n'use strict';\n/**\n * doc\n */\nvar fs = require('fs');\n";
        var guarded   = "'use strict';\n// note\n" + GUARD_LINE + "\n    process.exit(1);\n}\nvar fs = require('fs');\n";
        assert.equal(firstCodeLine(unguarded), "var fs = require('fs');");
        assert.equal(firstCodeLine(guarded), GUARD_LINE);
        assert.equal(guardBlock(unguarded), null);
        assert.equal(guardBlock(guarded), GUARD_LINE + '\n    process.exit(1);\n}\n');
    });

    ENTRIES.forEach(function (entry) {
        it(entry + ': the block is the first statement', function () {
            assert.equal(firstCodeLine(readEntry(entry)), GUARD_LINE);
        });
    });

    it('the block is byte-identical in all five entry points', function () {
        var reference = guardBlock(readEntry(ENTRIES[0]));
        assert.ok(reference && reference.indexOf('process.exit(1);') > -1, reference);
        ENTRIES.slice(1).forEach(function (entry) {
            assert.equal(guardBlock(readEntry(entry)), reference, entry);
        });
    });
});
