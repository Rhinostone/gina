/**
 * #B905 — the message a command reports when a gina CLI command it ran as a child failed.
 *
 * `bundle:start` (and the other start, stop and restart commands, when gina is installed
 * globally) runs `gina framework:link-node-modules` and `gina framework:link` as children with
 * execFileSync(). A gina CLI command writes its errors on stdout, through gina's logger, so the
 * caller's message, built from the child's stderr alone, was '' and `exit('')` framed exit code 0:
 * measured on develop cd213edda, `bundle:start` exited 0 with nothing started when the
 * link-node-modules child failed. lib/cmd/framework/inc/child-failure.js builds a message that
 * is never empty: the child command and its exit code (or signal), then the child's stderr and
 * its stdout, or else the error's message. Both streams: a first version preferred stderr, and
 * the daemon test then showed Node's own « ExperimentalWarning: SQLite » there (a warning Node
 * prints on a later tick, so only in some runs) hiding the reason on stdout. The daemon path end
 * to end is test/integration/daemon-bundle-start-link-failure-b905.test.js.
 *
 * Sections:
 *   01 — stdout is used when stderr is empty (the #B905 shape), with the exit code
 *   02 — both streams, stderr first: a Node warning on stderr does not hide the reason on stdout
 *   03 — the error's message when both outputs are empty, the head alone when nothing is left
 *   04 — a signal instead of an exit code; strings as well as Buffers; never an empty string
 *   05 — a real child: execFileSync() of a node script that writes on stdout and exits 3
 *   06 — the three callers use it (source pins, comment lines removed)
 *
 * Run: node --test test/lib/child-failure-b905.test.js
 */
'use strict';

var fs     = require('fs');
var path   = require('path');
var { execFileSync } = require('child_process');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW     = require('../fw');
var MODULE = path.join(FW, 'lib/cmd/framework/inc/child-failure.js');
var describeChildFailure = require(MODULE);

var CMD = 'gina framework:link-node-modules @myproject';

/** An error shaped as execFileSync() throws it. */
function childError(fields) {
    var err = new Error(fields.message || 'Command failed: node cli link-node-modules @myproject');
    err.status = (typeof(fields.status) != 'undefined') ? fields.status : 1;
    err.signal = fields.signal || null;
    err.stdout = fields.stdout;
    err.stderr = fields.stderr;
    return err;
}

/** The source without its comment lines, so a pin cannot match a comment naming the old code. */
function codeOf(file) {
    return fs.readFileSync(file, 'utf8').split('\n')
        .filter(function (line) { return !/^\s*(\/\/|\*|\/\*)/.test(line); })
        .join('\n');
}


describe('44 - child-failure-b905 — a failed child command is described, never as an empty message (#B905)', function () {

    it('01  stderr empty (an empty Buffer), stdout carrying the error: the message names the command, the exit code and the stdout', function () {
        var msg = describeChildFailure(childError({
            stderr: Buffer.from(''),
            stdout: Buffer.from('[crit] Gina has some troubles with this command\nError: the path does not exist.\n')
        }), CMD);
        assert.equal(msg, '`' + CMD + '` failed (exit code 1):\n[crit] Gina has some troubles with this command\nError: the path does not exist.');
    });

    it('02  both streams are carried, stderr first: a warning Node wrote on stderr does not hide the reason on stdout', function () {
        var msg = describeChildFailure(childError({
            stderr: Buffer.from('(node:4242) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'),
            stdout: Buffer.from('Error: Cannot complete symlinkSync from `/home/.myproject/lib/node_modules`: the path does not exist.\n')
        }), CMD);
        assert.equal(msg, '`' + CMD + '` failed (exit code 1):\n'
            + '(node:4242) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'
            + 'Error: Cannot complete symlinkSync from `/home/.myproject/lib/node_modules`: the path does not exist.');
    });

    it('03  both outputs empty: the error\'s message; nothing left at all: the head alone', function () {
        var withMessage = describeChildFailure(childError({ stderr: Buffer.from(''), stdout: Buffer.from('  \n'), message: 'spawnSync node ENOENT' }), CMD);
        assert.equal(withMessage, '`' + CMD + '` failed (exit code 1):\nspawnSync node ENOENT');

        var bare = childError({ stderr: Buffer.from(''), stdout: Buffer.from('') });
        bare.message = '';
        assert.equal(describeChildFailure(bare, CMD), '`' + CMD + '` failed (exit code 1)');
    });

    it('04  a signal instead of an exit code; strings as well as Buffers; never an empty string', function () {
        var killed = describeChildFailure(childError({ status: null, signal: 'SIGKILL', stderr: '', stdout: 'killed while linking' }), CMD);
        assert.equal(killed, '`' + CMD + '` failed (signal SIGKILL):\nkilled while linking');

        var inputs = [undefined, null, {}, new Error(''), childError({ stderr: null, stdout: undefined, message: '' })];
        inputs.forEach(function (input) {
            var out = describeChildFailure(input, CMD);
            assert.equal(typeof out, 'string');
            assert.ok(out.length > 0, 'an empty message for ' + JSON.stringify(input));
            assert.ok(out.indexOf('`' + CMD + '` failed') === 0, out);
        });
    });

    it('05  a real child: a node script that writes on stdout only and exits 3', function () {
        var thrown = null;
        try {
            // fs.writeSync: a pipe is asynchronous on macOS, and process.exit() could drop a stdout.write()
            execFileSync(process.execPath, ['-e', 'require("fs").writeSync(1, "the reason, on stdout\\n"); process.exit(3)'], { stdio: 'pipe' });
        } catch (e) {
            thrown = e;
        }
        assert.ok(thrown, 'the child did not fail');
        assert.equal(thrown.stderr.length, 0, 'the child wrote on stderr: ' + thrown.stderr);
        var msg = describeChildFailure(thrown, CMD);
        assert.equal(msg, '`' + CMD + '` failed (exit code 3):\nthe reason, on stdout');
    });

    it('06  the three callers build their message with it, not from stderr alone', function () {
        var helper = codeOf(path.join(FW, 'lib/cmd/helper.js'));
        var link   = codeOf(path.join(FW, 'lib/cmd/framework/link.js'));
        // the raw text still holds the old expression (in the `was:` comments): the strip must not be vacuous
        assert.ok(fs.readFileSync(path.join(FW, 'lib/cmd/helper.js'), 'utf8').indexOf('linkErr.stderr.toString().trim()') > -1, 'the raw helper.js no longer names the old expression');

        assert.equal((helper.match(/describeChildFailure\(linkErr, 'gina framework:link-node-modules @'\+ cmd\.projectName\)/g) || []).length, 1, 'helper.js link-node-modules catch');
        assert.equal((helper.match(/describeChildFailure\(err, 'gina framework:link @'\+ cmd\.projectName\)/g) || []).length, 1, 'helper.js link catch');
        assert.equal((link.match(/describeChildFailure\(linkErr, 'gina framework:link-node-modules @'\+ self\.projectName\)/g) || []).length, 1, 'link.js catch');
        assert.equal((helper + link).indexOf('.stderr.toString().trim()'), -1, 'a caller still builds its message from stderr alone');
    });
});
