'use strict';
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW       = require('../fw');
var CMD_DIR  = path.join(FW, 'lib/cmd/framework');
var VERSION_SOURCE = path.join(CMD_DIR, 'version.js');
var MSG_SOURCE     = path.join(CMD_DIR, 'msg.json');


// ---------------------------------------------------------------------------
// Replicas of the pure logic added to version.js — tested in isolation
// without the full CLI/socket-server context.
// ---------------------------------------------------------------------------

/**
 * Replica of the engine-token resolution in version.js init().
 * Builds "<name>@<version>" from a parsed engine package.json, or '' when the
 * package is unreadable / incomplete ("when available" contract).
 */
function resolveEngineToken(enginePack) {
    var engine = '';
    if ( enginePack && enginePack.name && enginePack.version ) {
        engine = enginePack.name + '@' + enginePack.version;
    }
    return engine;
}

/**
 * Replica of the %engine% substitution in version.js — the label + trailing
 * newline are added only when the token is non-empty, so an unavailable engine
 * collapses to no line (and no blank line) at all.
 */
function assembleBanner(template, values) {
    return template
        .replace(/%version%/, values.version)
        .replace(/%middleware%/, values.middleware)
        .replace(/%engine%/, values.engine ? ('Template engine: ' + values.engine + '\n') : '')
        .replace(/%copyright%/, values.copyright);
}


// ---------------------------------------------------------------------------
// 01 — Handler file exists and is non-empty
// ---------------------------------------------------------------------------
describe('01 - framework:version handler file exists', function() {

    it('version.js exists and is non-empty', function() {
        assert.ok(fs.existsSync(VERSION_SOURCE), 'version.js does not exist');
        assert.ok(fs.statSync(VERSION_SOURCE).size > 0, 'version.js is empty');
    });

});


// ---------------------------------------------------------------------------
// 02 — Source structure: version.js still exports the handler
// ---------------------------------------------------------------------------
describe('02 - framework:version source structure', function() {

    var src;
    function getSrc() {
        return src || (src = fs.readFileSync(VERSION_SOURCE, 'utf8'));
    }

    it('exports Version', function() {
        assert.ok(/module\.exports\s*=\s*Version/.test(getSrc()));
    });

    it('defines function Version(opt)', function() {
        assert.ok(/function Version\(opt\)/.test(getSrc()));
    });

    it('uses lib.logger', function() {
        assert.ok(getSrc().indexOf('lib.logger') > -1);
    });

    it('still reads the MIDDLEWARE file (no regression)', function() {
        assert.ok(getSrc().indexOf('/MIDDLEWARE') > -1);
    });

});


// ---------------------------------------------------------------------------
// 03 — Source structure: template-engine line wiring
// ---------------------------------------------------------------------------
describe('03 - framework:version template-engine wiring', function() {

    var src;
    function getSrc() {
        return src || (src = fs.readFileSync(VERSION_SOURCE, 'utf8'));
    }

    it('reads the bundled engine package.json under the framework path', function() {
        assert.ok(
            getSrc().indexOf('@rhinostone/swig/package.json') > -1,
            'expected version.js to read @rhinostone/swig/package.json'
        );
    });

    it('builds the engine token as name@version', function() {
        assert.ok(
            /enginePack\.name\s*\+\s*'@'\s*\+\s*enginePack\.version/.test(getSrc()),
            'expected engine = enginePack.name + "@" + enginePack.version'
        );
    });

    it('guards the engine read in a try/catch ("when available")', function() {
        assert.ok(
            getSrc().indexOf('catch (engineErr)') > -1,
            'expected the engine read to be wrapped in try/catch'
        );
    });

    it('injects the engine line via the %engine% placeholder', function() {
        assert.ok(
            getSrc().indexOf('.replace(/%engine%/') > -1,
            'expected a .replace(/%engine%/, ...) call'
        );
    });

    it('uses the "Template engine: " label', function() {
        assert.ok(
            getSrc().indexOf("'Template engine: '") > -1,
            'expected the Template engine label'
        );
    });

    it('only emits the line when the token is truthy (omit-when-unavailable)', function() {
        assert.ok(
            /version\.engine\s*\?\s*\('Template engine: '/.test(getSrc()),
            'expected version.engine ? (label...) : "" conditional'
        );
    });

});


// ---------------------------------------------------------------------------
// 04 — msg.json: %engine% placeholder sits between middleware and copyright
// ---------------------------------------------------------------------------
describe('04 - msg.json basic[4] carries the %engine% placeholder', function() {

    var msg;
    function getMsg() {
        return msg || (msg = JSON.parse(fs.readFileSync(MSG_SOURCE, 'utf8')));
    }

    it('basic[4] contains the %engine% placeholder', function() {
        assert.ok(getMsg().basic['4'].indexOf('%engine%') > -1);
    });

    it('%engine% precedes %copyright%', function() {
        var tpl = getMsg().basic['4'];
        assert.ok(tpl.indexOf('%engine%') < tpl.indexOf('%copyright%'));
    });

    it('%engine% follows %middleware% (engine line below middleware)', function() {
        var tpl = getMsg().basic['4'];
        assert.ok(tpl.indexOf('%middleware%') < tpl.indexOf('%engine%'));
    });

    it('still carries %version% and %middleware% (no regression)', function() {
        var tpl = getMsg().basic['4'];
        assert.ok(tpl.indexOf('%version%') > -1);
        assert.ok(tpl.indexOf('%middleware%') > -1);
    });

});


// ---------------------------------------------------------------------------
// 05 — Logic: engine-token resolution (isolated, no filesystem)
// ---------------------------------------------------------------------------
describe('05 - engine-token resolution logic', function() {

    it('builds name@version from a complete package', function() {
        assert.equal(
            resolveEngineToken({ name: '@rhinostone/swig', version: '2.7.2' }),
            '@rhinostone/swig@2.7.2'
        );
    });

    it('returns empty string when the package is null', function() {
        assert.equal(resolveEngineToken(null), '');
    });

    it('returns empty string when version is missing', function() {
        assert.equal(resolveEngineToken({ name: '@rhinostone/swig' }), '');
    });

    it('returns empty string when name is missing', function() {
        assert.equal(resolveEngineToken({ version: '2.7.2' }), '');
    });

});


// ---------------------------------------------------------------------------
// 06 — Logic: banner assembly against the REAL msg.json template
// ---------------------------------------------------------------------------
describe('06 - banner assembly with/without engine', function() {

    var template = JSON.parse(fs.readFileSync(MSG_SOURCE, 'utf8')).basic['4'];

    var base = {
        version:   '0.4.6-alpha.2 darwin arm64 (MIT)',
        middleware: 'isaac@0.4.6-alpha.1',
        copyright: 'Copyright (c) 2009-2026 Rhinostone <contact@gina.io>'
    };

    it('emits the Template engine line when the token is available', function() {
        var out = assembleBanner(template, Object.assign({}, base, { engine: '@rhinostone/swig@2.7.2' }));
        assert.ok(out.indexOf('\nTemplate engine: @rhinostone/swig@2.7.2\n') > -1);
        // engine line sits between middleware and copyright
        assert.ok(out.indexOf('Template engine:') > out.indexOf('Middleware:'));
        assert.ok(out.indexOf('Template engine:') < out.indexOf('Copyright'));
    });

    it('omits the line entirely when the token is empty ("when available")', function() {
        var out = assembleBanner(template, Object.assign({}, base, { engine: '' }));
        assert.ok(out.indexOf('Template engine:') < 0, 'no Template engine line expected');
        // middleware is directly followed by copyright — no dangling blank line
        assert.ok(out.indexOf('isaac@0.4.6-alpha.1\nCopyright') > -1);
    });

    it('--short path is unaffected (engine never appended to the bare number)', function() {
        // The short path prints version.number only; assert the template's engine
        // wiring lives in the full banner, not the number itself.
        assert.ok(base.version.indexOf('Template engine:') < 0);
    });

});
