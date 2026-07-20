'use strict';
/**
 * #B133 — the framework env template (core/template/conf/env.json) shipped a
 * hardcoded `accept-language` RESPONSE header default. Accept-Language is a
 * REQUEST header (a client preference) — on a response it is meaningless
 * noise, and because the template is runtime-merged for every bundle,
 * completeHeaders emitted it on EVERY response, error responses included.
 * Removed (#B133). The response.header block itself stays (empty): a
 * project/bundle env.json may still declare any response header there —
 * live-verified 2026-07-20 on an isolated boot (framework default gone from
 * the wire; a project-declared accept-language emitted verbatim) — and the
 * controller's request-fallback read derefs `server.response.header`, so the
 * block's existence is load-bearing.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW = require('../fw');

var TPL_SRC  = fs.readFileSync(path.join(FW, 'core/template/conf/env.json'), 'utf8');
var CTRL_SRC = fs.readFileSync(path.join(FW, 'core/controller/controller.js'), 'utf8');

describe('#B133 — no hardcoded accept-language response header in the env template', function () {

    it('the quoted key is globally zero in the template (code and comments)', function () {
        assert.ok(TPL_SRC.indexOf('"accept-language"') < 0,
            'the env template must not declare an accept-language response header');
    });

    it('the response.header block survives (empty) — the override path + the controller deref need it', function () {
        assert.ok(TPL_SRC.indexOf('"response": {') > -1);
        assert.ok(TPL_SRC.indexOf('"header": {') > -1);
    });

    it('the controller keeps honoring a project-DECLARED value as its request fallback', function () {
        assert.ok(
            CTRL_SRC.indexOf("local.options.conf.server.response.header['accept-language']") > -1,
            'a value a project env.json declares in server.response.header must stay readable as the accept-language fallback'
        );
    });
});
