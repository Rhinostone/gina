/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';

/**
 * #STO1 slice 1 — the upload-group → storage-driver binding lint, and the
 * #B224 config-surface resolution that rides with it.
 *
 * `validateConfig` gains `context.groupBindings`: NEUTRAL `{owner, driver,
 * path}` tuples the gna.js boot block builds from every bundle's
 * `upload.groups.<g>.driver` keys — the lib never reads gina config. A
 * binding naming a driver that does not exist (including ANY binding when no
 * `storage`/`drivers` block is configured) is FATAL: a driver-routed group is
 * configured behaviour that can otherwise never happen. A binding whose
 * staging `path` sits INSIDE its driver's root only WARNS — the pair is
 * legal (`path` is the parse-time staging dir for a routed group), but
 * staging inside the store tree strands files no key references.
 *
 * The lint is driven BEHAVIOURALLY (fatal/warning strings are runtime
 * values). The gna.js caller, the scaffold-template retire (#B224) and the
 * schema declaration are pinned to source — there the invariant genuinely is
 * "the shape is present".
 */

var { describe, it } = require('node:test');
var assert   = require('node:assert');
var fs       = require('node:fs');
var nodePath = require('node:path');

var FW      = require('../fw');
var storage = require(nodePath.join(FW, 'lib', 'storage'));

var ROOT    = nodePath.resolve(FW, '..', '..');
var GNA_SRC = fs.readFileSync(nodePath.join(FW, 'core', 'gna.js'), 'utf8');
var TPL_RAW = fs.readFileSync(nodePath.join(FW, 'core', 'template', 'conf', 'settings.json'), 'utf8');
var SCHEMA  = JSON.parse(
    fs.readFileSync(nodePath.join(ROOT, 'schema', 'settings.json'), 'utf8')
        .split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n')
);

function good() {
    return {
        default: 'assets',
        drivers: { assets: { adapter: 'local', strategy: 'sharded', root: '/var/data/assets' } }
    };
}

describe('01 - a dangling driver reference is FATAL, wherever the gap is', function () {

    it('a binding with NO storage block at all refuses the boot', function () {
        var v = storage.validateConfig(undefined, {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: null }]
        });
        assert.ok(v.fatal, 'must be fatal');
        assert.ok(v.fatal.indexOf('app/upload.groups/docs') > -1, 'names the config site');
        assert.ok(v.fatal.indexOf('assets') > -1, 'names the missing driver');
        assert.ok(v.fatal.indexOf('no `storage` block') > -1, 'names the gap');
    });

    it('a binding with a storage block but no drivers map refuses the boot', function () {
        var v = storage.validateConfig({ default: undefined }, {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: null }]
        });
        assert.ok(v.fatal, 'must be fatal');
        assert.ok(v.fatal.indexOf('declares no `drivers`') > -1, 'names the gap');
    });

    it('a binding naming an undefined driver refuses the boot, listing what IS defined', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'ghost', path: null }]
        });
        assert.ok(v.fatal, 'must be fatal');
        assert.ok(v.fatal.indexOf('ghost') > -1, 'names the dangling driver');
        assert.ok(v.fatal.indexOf('assets') > -1, 'lists the defined drivers');
    });

    it('control: the same configs WITHOUT bindings keep their historical verdicts', function () {
        assert.equal(storage.validateConfig(undefined).fatal, null, 'feature-off stays clean');
        var v = storage.validateConfig({ default: undefined });
        assert.equal(v.fatal, null, 'a drivers-less block stays a warning');
        assert.equal(v.warnings.length, 1);
    });
});

describe('02 - a valid binding passes; path beside driver is legal', function () {

    it('a binding naming a defined driver is clean', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: null }]
        });
        assert.equal(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
    });

    it('a staging path OUTSIDE the driver root earns no warning — the pair composes', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: '/var/tmp/staging' }]
        });
        assert.equal(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
    });
});

describe('03 - a staging path INSIDE the driver root warns (strays no key references)', function () {

    it('a path under the root warns, naming the site and the driver', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: '/var/data/assets/staging' }]
        });
        assert.equal(v.fatal, null, 'legal — a warning, never a fatal');
        assert.equal(v.warnings.length, 1);
        assert.ok(v.warnings[0].indexOf('app/upload.groups/docs') > -1);
        assert.ok(v.warnings[0].indexOf('sits inside driver') > -1);
        assert.ok(v.warnings[0].indexOf('staging dir') > -1, 'explains what path means for a routed group');
    });

    it('a path EQUAL to the root warns too (identical-to-base is inside)', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: '/var/data/assets' }]
        });
        assert.equal(v.warnings.length, 1);
    });

    it('a sibling-prefix path does NOT warn (the confinement guard is separator-aware)', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: '/var/data/assets-siblings' }]
        });
        assert.deepStrictEqual(v.warnings, []);
    });

    it('an unresolved-placeholder path is skipped, never false-warned', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [{ owner: 'app/upload.groups/docs', driver: 'assets', path: '${tmpPath}' }]
        });
        assert.deepStrictEqual(v.warnings, []);
    });
});

describe('04 - back-compat: the context extension changes nothing for binding-less callers', function () {

    it('a plain validateConfig(good()) with no context stays clean', function () {
        var v = storage.validateConfig(good());
        assert.equal(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
        assert.equal(v.driverCount, 1);
    });

    it('an empty bindings array behaves as absent', function () {
        var v = storage.validateConfig(good(), { groupBindings: [] });
        assert.equal(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
    });

    it('a malformed binding entry (no driver string) is skipped, not crashed on', function () {
        var v = storage.validateConfig(good(), {
            groupBindings: [null, { owner: 'x' }, { owner: 'y', driver: '' }]
        });
        assert.equal(v.fatal, null);
        assert.deepStrictEqual(v.warnings, []);
    });
});

describe('05 - gna.js caller pins: the bindings build feeds the lint', function () {

    it('builds neutral tuples from every bundle\'s upload groups', function () {
        assert.ok(GNA_SRC.indexOf('_stoBindings.push({') > -1,
            'the boot block must collect binding tuples');
    });

    it('injects the tuples into validateConfig', function () {
        assert.ok(GNA_SRC.indexOf('groupBindings: _stoBindings') > -1,
            'the lint must receive the bindings');
    });

    it('the gate widens so a binding with NO storage block still validates (and fatals)', function () {
        var buildIdx = GNA_SRC.indexOf('var _stoBindings = []');
        var gateIdx  = GNA_SRC.indexOf('if ( _stoSettings || _stoBindings.length ) {');
        assert.ok(buildIdx > -1, 'the bindings build must exist');
        assert.ok(gateIdx > buildIdx, 'the widened gate must follow the build');
    });
});

describe('06 - #B224 pins: the scaffold template advertises only keys the runtime reads', function () {

    it('the inert per-group sample keys are retired', function () {
        assert.ok(TPL_RAW.indexOf('"filePrefix"') === -1,
            'filePrefix has no read site — the sample must not advertise it');
        assert.ok(TPL_RAW.indexOf('"subFolder"') === -1,
            'subFolder has no read site — the sample must not advertise it');
    });

    it('the inert block-level encoding key is retired', function () {
        assert.ok(TPL_RAW.indexOf('"encoding"') === -1,
            'upload.encoding has no read site (busboy hardcodes defParamCharset utf8)');
    });

    it('the false per-group-redefinability comments are gone (both spellings)', function () {
        assert.ok(TPL_RAW.indexOf('redefined under the group') === -1);
        assert.ok(TPL_RAW.indexOf('redifined under the group') === -1);
    });

    it('the sample now advertises the driver binding instead', function () {
        assert.ok(TPL_RAW.indexOf('"driver": "assets"') > -1,
            'the commented sample must show the #STO1 group binding');
    });
});

describe('07 - schema pins: the upload block declares the REAL key set', function () {

    var upload = SCHEMA.properties.upload;

    it('declares every framework-read block-level key', function () {
        var keys = Object.keys(upload.properties);
        ['tmpPath', 'uploadDir', 'maxFieldsSize', 'maxFields', 'maxTextFields',
         'maxTextFieldSize', 'autoTmpCleanupTimeout', 'groups'].forEach(function (k) {
            assert.ok(keys.indexOf(k) > -1, 'upload schema must declare `' + k + '`');
        });
    });

    it('keeps additionalProperties true at BOTH levels — applications own their extra keys', function () {
        assert.strictEqual(upload.additionalProperties, true);
        assert.strictEqual(upload.properties.groups.additionalProperties.additionalProperties, true);
    });

    it('declares every framework-read group-level key, including the driver binding', function () {
        var g = upload.properties.groups.additionalProperties.properties;
        ['path', 'allowedExtensions', 'isMultipleAllowed', 'driver', 'simulateWriteError'].forEach(function (k) {
            assert.ok(g[k], 'group schema must declare `' + k + '`');
        });
        assert.ok(g.driver.description.indexOf('storage.drivers') > -1,
            'the driver key must point at the storage block');
        assert.ok(g.isMultipleAllowed.description.indexOf('OMITTED means multiple files are allowed') > -1,
            'the permissive-when-omitted default must be stated (the reference-page claim was wrong)');
    });

    it('the storage block no longer disclaims the upload path', function () {
        var desc = SCHEMA.properties.storage.description;
        assert.ok(desc.indexOf('Slice 0 does not touch the upload path') === -1,
            'the slice-0 disclaimer is stale once the binding ships');
        assert.ok(desc.indexOf('upload.groups.<name>.driver') > -1,
            'the storage block must name the binding instead');
    });
});
