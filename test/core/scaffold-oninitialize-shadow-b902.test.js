/**
 * #B902 — the scaffold's commented onInitialize sample, uncommented in a bundle
 * named like one of the callback's parameters.
 *
 * `core/template/boilerplate/bundle/index.js` names the gina instance after the
 * bundle (`var ${bundle} = require('gina')`), and its sample reads the config
 * through `self.getConfig()`. When `self` is taken inside the callback
 * `function(event, app, express)`, a bundle named `event`, `app` or `express`
 * gets the parameter of that name instead of the instance, and the boot aborts
 * with « TypeError: self.getConfig is not a function ».
 *
 * Each arm takes the template's sample block (from the `var self` line or the
 * `onInitialize(` line, whichever comes first, to the `//});` that closes the
 * call), removes one `//` from each line commented once, as a user uncommenting
 * the sample would, and runs it with `require('gina')` returning a stub
 * instance whose onInitialize calls back with a stub event, middleware app and
 * express function, as gna.js does (`callback(e, instance, middleware)`).
 *   §01 the sample block is found and has live code;
 *   §02 bundle `demo` (control), §03 `app`, §04 `event`, §05 `express`: the
 *       sample reads the config from the instance and emits 'complete'.
 *
 * Run: node --test test/core/scaffold-oninitialize-shadow-b902.test.js
 */
'use strict';

var fs     = require('fs');
var path   = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW       = require('../fw');
var TEMPLATE = path.join(FW, 'core', 'template', 'boilerplate', 'bundle', 'index.js');

/**
 * Returns the sample block of the template for a bundle name, uncommented.
 *
 * @inner
 * @param {string} bundle - The bundle name substituted for `${bundle}`
 * @returns {{src: string, live: string[]}} The block's source, and its live lines
 */
function uncommentedSample(bundle) {
    var lines = fs.readFileSync(TEMPLATE, 'utf8').split('${bundle}').join(bundle).split('\n');
    var selfLine = lines.findIndex(function (l) { return /^\/\/\s*var self = /.test(l); });
    var callLine = lines.findIndex(function (l) { return l.indexOf('//' + bundle + '.onInitialize(') === 0; });
    var start = (selfLine > -1 && selfLine < callLine) ? selfLine : callLine;
    var end = -1;
    for (var i = callLine; i > -1 && i < lines.length; i++) {
        if (/^\/\/\}\);/.test(lines[i])) { end = i; break; }
    }
    if (callLine < 0 || end < 0) return { src: '', live: [] };
    var block = lines.slice(start, end + 1).map(function (l) {
        return /^\/\/(?!\s*\/\/)/.test(l) ? l.replace(/^\/\//, '') : l;
    });
    return {
        src  : block.join('\n'),
        live : block.filter(function (l) { return l.trim() && !/^\s*\/\//.test(l); })
    };
}

/**
 * Runs a bundle's uncommented sample against a stub gina instance.
 *
 * @inner
 * @param {string} bundle
 * @returns {{error: (Error|null), configReads: number, emitted: string[]}}
 */
function runSample(bundle) {
    var configReads = 0;
    var emitted = [];
    var instance = {
        getConfig: function () { configReads++; return {}; },
        onInitialize: function (callback) {
            var event      = { emit: function (name) { emitted.push(name); } };
            var middleware = { use: function () {} };
            var express    = function () {};
            callback(event, middleware, express);
        }
    };
    var stubRequire = function (name) {
        if (name === 'gina') return instance;
        throw new Error('unexpected require: ' + name);
    };
    var error = null;
    try {
        new Function('require', 'var ' + bundle + " = require('gina');\n" + uncommentedSample(bundle).src)(stubRequire);
    } catch (e) {
        error = e;
    }
    return { error: error, configReads: configReads, emitted: emitted };
}

describe('#B902 - the scaffold onInitialize sample in a bundle named like a callback parameter', function () {

    it('01 - the sample block is found and has live code', function () {
        var sample = uncommentedSample('demo');
        assert.equal(sample.live.some(function (l) { return /demo\.onInitialize\(/.test(l); }), true, sample.live.join('\n'));
        assert.equal(sample.live.some(function (l) { return /self\.getConfig\(\)/.test(l); }), true, sample.live.join('\n'));
        assert.equal(sample.live.some(function (l) { return /event\.emit\('complete'/.test(l); }), true, sample.live.join('\n'));
    });

    ['demo', 'app', 'event', 'express'].forEach(function (bundle, i) {
        var label = String(i + 2).padStart(2, '0') + ' - bundle `' + bundle + '`' + (bundle === 'demo' ? ' (control)' : '');
        it(label + ': the sample reads the config from the gina instance and emits complete', function () {
            var r = runSample(bundle);
            assert.equal(r.error, null, String(r.error && r.error.stack));
            assert.equal(r.configReads, 1);
            assert.deepEqual(r.emitted, ['complete']);
        });
    });
});
