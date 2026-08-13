'use strict';
/**
 * Default-look CSS — the `@layer gina` override contract
 *
 * The framework's default appearance for its state-hook attributes
 * (`data-gina-loading`, `data-gina-form-submit-gated`) ships inside a CSS
 * cascade layer named `gina`. For normal declarations, any un-layered project
 * rule beats a layered one regardless of specificity or stylesheet order —
 * that IS the contract: project CSS always overrides framework defaults
 * without specificity games or load-order luck.
 *
 * Two boundaries this file locks, in both directions:
 *
 *  - §01 the default looks are INSIDE the layer — the loading rules (base +
 *    both reduced-motion variants + keyframes) and the submit-gated rule, and
 *    none of them leaks a duplicate outside the layer (a duplicate outside
 *    would win the cascade and silently void the contract);
 *  - §02 FUNCTIONAL rules stay OUTSIDE the layer — the popin scroll-lock and
 *    overlay/dialog structure must keep beating generic project resets
 *    (`body { overflow }`, `dialog { padding }`), so layering them would be a
 *    regression, not a courtesy;
 *  - §03 no `!important` inside the layer — layer priority INVERTS for
 *    important declarations, so a layered `!important` would beat un-layered
 *    project `!important`, the exact opposite of the contract;
 *  - §04 source pin: the contract originates in loading-state.scss, so a
 *    rebuild from source reproduces it.
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var FW     = require('../fw');
var SCSS   = path.join(FW, 'core/asset/plugin/src/vendor/gina/loading-state/sass/loading-state.scss');
var MINCSS = path.join(FW, 'core/asset/plugin/dist/vendor/gina/css/gina.min.css');

var css, layerBlock, outsideLayer;
before(function () {
    css = fs.readFileSync(MINCSS, 'utf8');

    var i = css.indexOf('@layer gina{');
    assert.ok(i > -1, 'gina.min.css carries the @layer gina block');

    // extract the balanced block so inside/outside assertions are structural,
    // not substring guesses over the whole file
    var start = css.indexOf('{', i);
    var depth = 0, end = -1;
    for (var k = start; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}' && --depth === 0) { end = k; break; }
    }
    assert.ok(end > -1, 'the @layer gina block is brace-balanced');
    layerBlock   = css.slice(start, end + 1);
    outsideLayer = css.slice(0, i) + css.slice(end + 1);
});

describe('loading-state CSS — @layer gina contract', function () {

    describe('§01 default looks live inside the layer', function () {
        it('the file declares exactly one layer', function () {
            assert.equal(css.split('@layer').length - 1, 1,
                'a second @layer would need its own ordering story — one layer is the contract');
        });
        it('loading base rule is layered', function () {
            assert.ok(layerBlock.indexOf('[data-gina-loading=true]{cursor:progress}') > -1);
        });
        it('both reduced-motion variants are layered', function () {
            assert.equal(layerBlock.split('prefers-reduced-motion').length - 1, 2);
        });
        it('the pulse keyframes are layered (an un-layered project @keyframes of the same name wins name resolution)', function () {
            assert.ok(layerBlock.indexOf('@keyframes gina-loading-pulse') > -1);
        });
        it('submit-gated default look is layered', function () {
            assert.ok(layerBlock.indexOf('[data-gina-form-submit-gated=true]') > -1);
        });
        it('neither state-hook selector leaks a duplicate outside the layer', function () {
            assert.equal(outsideLayer.indexOf('[data-gina-loading='), -1);
            assert.equal(outsideLayer.indexOf('data-gina-form-submit-gated'), -1);
        });
    });

    describe('§02 functional rules stay un-layered', function () {
        it('popin scroll-lock is outside (mechanism, must beat generic body resets)', function () {
            assert.ok(outsideLayer.indexOf('data-gina-popin-scroll-lock') > -1);
            assert.equal(layerBlock.indexOf('data-gina-popin-scroll-lock'), -1);
        });
        it('popin structure is outside (layout, a project dialog reset must not break it)', function () {
            assert.ok(outsideLayer.indexOf('gina-popins-overlay') > -1);
            assert.equal(layerBlock.indexOf('gina-popin'), -1);
        });
    });

    describe('§03 the important inversion guard', function () {
        it('no !important inside the layer', function () {
            assert.equal(layerBlock.indexOf('!important'), -1);
        });
    });

    describe('§04 source pins', function () {
        it('loading-state.scss opens the layer and documents the inversion ban', function () {
            var scss = fs.readFileSync(SCSS, 'utf8');
            assert.ok(/@layer gina \{/.test(scss), 'the layer is authored in source, not a build artifact');
            assert.ok(scss.indexOf('NEVER add `!important` inside this layer') > -1,
                'the ban is documented where the next rule will be written');
        });
    });
});
