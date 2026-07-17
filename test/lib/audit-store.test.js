'use strict';
/**
 * lib/audit-store — the #COMPLY2 connector-store dispatcher (the third
 * instance of the job-store / render-cache-store mould), driven BEHAVIORALLY
 * against the real module with the injected globals mocked (the
 * `state-atomic-write.test.js §03` precedent: a framework module reading
 * injected globals must have them mocked, or the test hits the REAL target).
 *
 * NOTE: no shipped connector carries a `lib/audit-store.js` yet (demand-gated)
 * — the happy path here drives a FAKE connector tree under a temp
 * GINA_FRAMEWORK_DIR, which is also what proves the resolution chain rather
 * than any one backend.
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');

var FW = require('../fw');

// Requiring the dispatcher pulls `require('./../helpers')`, which installs the
// real `_` / `getContext` / `getConfig` globals — snapshot, then override.
var AuditStore = require(path.join(FW, 'lib/audit-store.js'));

var saved = {};
var tmpFw = null;

before(function () {
    saved.getContext         = global.getContext;
    saved.getConfig          = global.getConfig;
    saved.GINA_FRAMEWORK_DIR = global.GINA_FRAMEWORK_DIR;

    // A fake framework dir carrying ONE connector with an audit-store impl.
    tmpFw = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-audit-store-'));
    var implDir = path.join(tmpFw, 'core/connectors/fakedb/lib');
    fs.mkdirSync(implDir, { recursive: true });
    fs.writeFileSync(path.join(implDir, 'audit-store.js'),
        "module.exports = function FakeAuditStore(connConf, bundle) {\n" +
        "    return { append: function (r, cb) { (cb || function(){})(null); }, close: function () {}, _connConf: connConf, _bundle: bundle };\n" +
        "};\n");

    global.GINA_FRAMEWORK_DIR = tmpFw;
    global.getContext = function () { return { bundle: 'b', env: 'test' }; };
    global.getConfig  = function () {
        return { b: { test: { content: { connectors: {
            auditDb    : { connector: 'fakedb', file: '/tmp/x.db' },
            noConnField: { file: '/tmp/y.db' },
            noImpl     : { connector: 'redis' } // a REAL connector dir with NO audit-store.js
        } } } } };
    };
});

after(function () {
    global.getContext         = saved.getContext;
    global.getConfig          = saved.getConfig;
    global.GINA_FRAMEWORK_DIR = saved.GINA_FRAMEWORK_DIR;
    try { fs.rmSync(tmpFw, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
});

describe('lib/audit-store — dispatcher resolution', function () {

    it('01. resolves entry -> connector -> <connector>/lib/audit-store.js and invokes the factory with (connConf, bundle)', function () {
        var store = AuditStore('auditDb');
        assert.equal(typeof store.append, 'function');
        assert.equal(typeof store.close, 'function');
        assert.deepEqual(store._connConf, { connector: 'fakedb', file: '/tmp/x.db' });
        assert.equal(store._bundle, 'b');
    });

    it('02. a missing connectors.json entry throws, naming the entry', function () {
        assert.throws(function () { AuditStore('nope'); }, /could not resolve `nope`/);
    });

    it('03. an entry without a `connector` field throws', function () {
        assert.throws(function () { AuditStore('noConnField'); }, /has no `connector` field/);
    });

    it('04. a connector without an audit-store implementation throws — the v1 "no connector ships one yet" boot refusal', function () {
        // `noImpl` points at a connector dir that exists in the FAKE tree only as absent —
        // exactly the shape every REAL connector has today (demand-gated backends).
        assert.throws(function () { AuditStore('noImpl'); }, /has no audit-store implementation/);
    });

    it('05. a missing / empty entry name throws the arg guard', function () {
        assert.throws(function () { AuditStore(); },   /entry name is required/);
        assert.throws(function () { AuditStore(''); }, /entry name is required/);
    });
});
