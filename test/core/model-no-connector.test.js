'use strict';
/**
 * core/model/index.js — the "No connector found" error branch must emit a null
 * connection, not an undefined `conn`.
 *
 * The else branch fires when a connector's lib/connector.js does not exist (e.g.
 * an object-valued connectors.json key lacking a `.connector` field). It
 * previously passed `conn` — only ever a parameter of the inner
 * onConnect(err, conn) callback, undefined in the else scope — as the 4th emit
 * arg, throwing a ReferenceError in the error path itself (masking the real "No
 * connector found" diagnostic and crashing the model load). Both sibling error
 * emits (the connect-error case and the no-configuration case) correctly pass
 * null.
 *
 * Strategy: source inspection (Model.init is not unit-isolatable without a full
 * framework bootstrap — getPath/_/fs/connector loading).
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW          = require('../fw');
var MODEL_INDEX = path.join(FW, 'core/model/index.js');


describe('01 - core/model/index.js: "No connector found" emits null, not conn', function() {

    var src;
    before(function() { src = fs.readFileSync(MODEL_INDEX, 'utf8'); });

    it('the "No connector found" emit passes null as the connection arg', function() {
        assert.match(src, /No connector found'\),\s*self\.bundle,\s*self\.name,\s*null\)/);
    });

    it('the "No connector found" emit no longer passes the undefined `conn`', function() {
        assert.doesNotMatch(src, /No connector found'\),\s*self\.bundle,\s*self\.name,\s*conn\)/);
    });

    it('sibling error emits also pass null (consistency)', function() {
        // connect-error case (onConnect err branch)
        assert.match(src, /self\.emit\('model#ready',\s*err,\s*self\.bundle,\s*self\.name,\s*null\)/);
        // no-configuration case
        assert.match(src, /No configuration found[^\n]*self\.name,\s*null\)/);
    });
});
