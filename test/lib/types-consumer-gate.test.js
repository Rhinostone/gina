'use strict';

/**
 * Suite wrapper for the consumer-resolution type gate (#DTO3b — Half A).
 *
 * The gate itself lives in `script/check_types_consumer.js` (also run as a
 * dedicated CI step via `npm run types:check`); this wrapper makes the
 * local full-suite command cover it too, so a pre-publish suite run cannot
 * go green while the published declarations fail a real consumer compile.
 *
 * The driver carries its own can-fail control (a known-bad program must
 * produce TS2339 + TS2304) — a zero exit here therefore certifies both
 * that the fixture compiled AND that the instrument can fire.
 *
 * Run with:
 *   node --test test/lib/types-consumer-gate.test.js
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var { execFile } = require('child_process');

var REPO_ROOT = path.resolve(__dirname, '../..');
var DRIVER    = path.join(REPO_ROOT, 'script', 'check_types_consumer.js');

describe('01 - consumer-resolution type gate (tsc over the published declarations)', function () {

    it('script/check_types_consumer.js exits 0 (fixture clean + control fired)', function (t, done) {
        execFile(process.execPath, [DRIVER], { cwd: REPO_ROOT, encoding: 'utf8' },
            function (err, stdout, stderr) {
                if (err) {
                    assert.fail('type gate failed (exit ' + (err.code === undefined ? 'signal' : err.code) + '):\n' +
                        String(stdout) + String(stderr));
                }
                assert.match(String(stdout), /consumer fixture: clean/);
                assert.match(String(stdout), /can-fail control: fired/);
                done();
            });
    });
});
