'use strict';
/**
 * #B137 — `Env.getConf` merged-process branch: a sibling bundle's routing
 * table must never be aliased to the starting app's.
 *
 * In a merged-process project (every bundle on the SAME port, so
 * `isStandalone` stays true and one process serves the project), getConf's
 * merged branch historically reassigned the TARGET bundle's
 * `content.routing` to the STARTING app's table — a reference assignment,
 * permanent for the process lifetime. Under per-bundle `rule@bundle` keying
 * the starting app's table cannot contain a sibling's keys, so the first
 * cross-bundle getUrl both inflicted the clobber and failed: every
 * cross-bundle link rendered the literal `404:[<METHOD>]<rule>@<bundle>`
 * marker, and merged-mode inbound statics dispatch (which resolves the
 * sibling's slot via getRouting) could match requests against the wrong
 * bundle's table. The fix drops the routing reassignment; the hostname
 * share stays (same host:port in merged mode). The merged view of all
 * bundles' rules lives in the global `envConf.routing`, not in any
 * per-bundle slot.
 *
 * §01 pins the source (active alias gone, hostname share + clean branch
 * intact). §02/§03 execute the REAL extracted getConf bytes over a
 * two-bundle fixture (merged + non-merged arms). §04 is the subtract
 * control: the same replica run against a composed pre-fix variant must
 * detect the clobber — proving the harness can fail.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');
var FW     = require('../fw');

var CONFIG_PATH = path.join(FW, 'core', 'config.js');
var SRC         = fs.readFileSync(CONFIG_PATH, 'utf8');

// ─── extraction: the real getConf bytes ─────────────────────────────────────

var GETCONF_START = 'getConf : function(bundle, env) {';
var GETCONF_END   = 'getDefault : function()';

function extractGetConf(src) {
    var start = src.indexOf(GETCONF_START);
    var end   = src.indexOf(GETCONF_END, start);
    assert.ok(start > -1, 'getConf start marker found');
    assert.ok(end > start, 'getConf end marker (getDefault) found after it');
    var body = src.substring(start, end);
    // strip the trailing "}," separator (+ whitespace) that precedes getDefault
    body = body.replace(/\},\s*$/, '}');
    // "getConf : function(...) {...}" → bare function expression
    return body.replace(/^getConf\s*:\s*/, '');
}

function buildGetConf(fnSrc, selfObj) {
    // getConf references `self` throughout; `getContext`/`__stack` only in
    // the no-bundle worker fallback, which these tests never enter (bundle
    // is always passed) — stubs keep compilation honest.
    var factory = new Function('self', 'getContext', '__stack',
        'return (' + fnSrc + ');');
    return factory(
        selfObj,
        function () { return { config: { bundles: [] } }; },
        []
    );
}

// Two-bundle fixture: `web` is the starting app, `api` the sibling.
// Shapes mirror what the merged branch actually reads (content.settings.server,
// server, host, port) — nothing more.
function makeSelf(standalone) {
    return {
        isStandalone : standalone,
        startingApp  : 'web',
        bundle       : 'web',
        envConf      : {
            web : { dev : {
                host     : 'localhost',
                hostname : '',
                server   : { protocol: 'http/1.1', scheme: 'http', port: 3100 },
                content  : {
                    settings : { server: { protocol: 'http/1.1', scheme: 'http' } },
                    routing  : {
                        'homepage@web' : { url: '/' },
                        'probe@web'    : { url: '/probe' }
                    }
                }
            } },
            api : { dev : {
                host     : 'localhost',
                hostname : '',
                server   : { protocol: 'http/1.1', scheme: 'http', port: 3100 },
                content  : {
                    settings : { server: { protocol: 'http/1.1', scheme: 'http' } },
                    routing  : {
                        'homepage@api' : { url: '/' }
                    }
                }
            } }
        }
    };
}

// Line-anchored comment strip: removes `//`-opened comment LINES only, so
// mid-line `'://'` string content (the hostname scheme separator) survives.
function stripLineComments(src) {
    return src.split('\n').filter(function (ln) {
        return !/^\s*\/\//.test(ln);
    }).join('\n');
}

// ─── §01 — source pins ──────────────────────────────────────────────────────

describe('#B137 §01 — source pins on the merged (isStandalone) branch', function () {

    var fnSrc     = extractGetConf(SRC);
    var activeSrc = stripLineComments(fnSrc);

    it('the routing alias is GONE from active code (comment-stripped)', function () {
        assert.equal(
            activeSrc.indexOf('content.routing = self.envConf[self.startingApp]'),
            -1
        );
    });

    it('the drop is documented in place (#B137 remnant comment)', function () {
        assert.ok(fnSrc.indexOf('#B137') > -1);
    });

    it('the hostname share is KEPT', function () {
        assert.ok(activeSrc.indexOf(
            'self.envConf[bundle][env].hostname = self.envConf[self.startingApp][env].hostname;'
        ) > -1);
    });

    it('the clean (non-merged) branch is untouched', function () {
        assert.ok(SRC.indexOf(
            'return ( typeof(self.envConf) != \'undefined\' ) ? self.envConf[bundle][env]  : null;'
        ) > -1);
    });
});

// ─── §02 — merged mode, real extracted bytes ────────────────────────────────

describe('#B137 §02 — merged mode: the sibling keeps its OWN table', function () {

    it('getConf(sibling) returns the sibling conf with its own routing (not aliased)', function () {
        var self    = makeSelf(true);
        var getConf = buildGetConf(extractGetConf(SRC), self);

        var conf = getConf('api', 'dev');

        assert.strictEqual(conf, self.envConf.api.dev);
        assert.notStrictEqual(
            self.envConf.api.dev.content.routing,
            self.envConf.web.dev.content.routing,
            'sibling routing must NOT be reference-equal to the starting app\'s'
        );
        assert.deepEqual(
            Object.keys(self.envConf.api.dev.content.routing),
            ['homepage@api'],
            'sibling keys intact'
        );
    });

    it('the hostname share still happens (same host:port in merged mode)', function () {
        var self    = makeSelf(true);
        var getConf = buildGetConf(extractGetConf(SRC), self);

        getConf('api', 'dev');

        assert.equal(self.envConf.web.dev.hostname, 'http://localhost:3100');
        assert.equal(self.envConf.api.dev.hostname, 'http://localhost:3100');
    });

    it('repeat + self calls stay clean (idempotent, self-assign benign)', function () {
        var self    = makeSelf(true);
        var getConf = buildGetConf(extractGetConf(SRC), self);

        getConf('api', 'dev');
        getConf('web', 'dev');
        getConf('api', 'dev');

        assert.deepEqual(Object.keys(self.envConf.api.dev.content.routing), ['homepage@api']);
        assert.deepEqual(
            Object.keys(self.envConf.web.dev.content.routing),
            ['homepage@web', 'probe@web']
        );
    });
});

// ─── §03 — non-merged (distinct ports): the clean branch ────────────────────

describe('#B137 §03 — non-merged mode: clean branch, no writes', function () {

    it('getConf(sibling) returns the conf without touching hostname or routing', function () {
        var self    = makeSelf(false);
        var getConf = buildGetConf(extractGetConf(SRC), self);

        var conf = getConf('api', 'dev');

        assert.strictEqual(conf, self.envConf.api.dev);
        assert.equal(self.envConf.api.dev.hostname, '', 'clean branch writes nothing');
        assert.deepEqual(Object.keys(self.envConf.api.dev.content.routing), ['homepage@api']);
    });
});

// ─── §04 — subtract control: the pre-fix variant must clobber ───────────────

describe('#B137 §04 — subtract: the replica detects the pre-fix clobber', function () {

    var ANCHOR = 'self.envConf[bundle][env].hostname = self.envConf[self.startingApp][env].hostname;';
    var ALIAS  = 'self.envConf[bundle][env].content.routing = self.envConf[self.startingApp][env].content.routing;';

    it('re-inserting the historical alias line reproduces the clobber (control can fail)', function () {
        var fnSrc = extractGetConf(SRC);

        // count-guarded compose: the anchor must appear exactly once
        assert.equal(fnSrc.split(ANCHOR).length - 1, 1, 'hostname-share anchor appears exactly once');
        var preFixSrc = fnSrc.replace(ANCHOR, ANCHOR + '\n                    ' + ALIAS);
        assert.notEqual(preFixSrc, fnSrc, 'pre-fix variant composed');

        var self    = makeSelf(true);
        var getConf = buildGetConf(preFixSrc, self);

        getConf('api', 'dev');

        assert.strictEqual(
            self.envConf.api.dev.content.routing,
            self.envConf.web.dev.content.routing,
            'pre-fix: sibling table reference-aliased to the starting app\'s'
        );
        assert.deepEqual(
            Object.keys(self.envConf.api.dev.content.routing),
            ['homepage@web', 'probe@web'],
            'pre-fix: sibling keys replaced by the starting app\'s'
        );
    });
});
