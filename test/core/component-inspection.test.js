/**
 * #CC6 — Inspector component observability suite.
 *
 * Covers the two dev-mode surfaces:
 *  (a) the statusbar's component census — instances per custom-element tag,
 *      plus the platform ':not(:defined)' awaiting-upgrade diagnostics —
 *      shipped additively as `user.view.components` over the per-tab bound
 *      channel and rendered as a bespoke View-tab section whose undefined
 *      count surfaces in red (an undefined custom tag is otherwise a
 *      perfectly silent failure);
 *  (b) the statusbar's dispatchEvent capture of composed bubbling
 *      CustomEvents named `<tag>:<verb>` — name/target/timestamp always,
 *      `detail` values only when the server-whispered capture gate
 *      (gina.inspectorEventsCaptureArgs, mirroring the events capture-args
 *      setting) is opted in — rendered as a textContent block below the
 *      server events on the Events tab.
 *
 * Source pins + pure-logic replicas + dist propagation. No live server,
 * project, or browser required.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var FW = require('../fw');

var SB_SRC    = path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/html/statusbar.html');
var SB_DIST   = path.join(FW, 'core/asset/plugin/dist/vendor/gina/html/statusbar.html');
var INSP_SRC  = path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/js/inspector.js');
var INSP_DIST = path.join(FW, 'core/asset/plugin/dist/vendor/gina/inspector/inspector.js');
var CSS_DIST  = path.join(FW, 'core/asset/plugin/dist/vendor/gina/inspector/inspector.css');
var RS_PATH   = path.join(FW, 'core/controller/controller.render-swig.js');
var RN_PATH   = path.join(FW, 'core/controller/controller.render-nunjucks.js');

var sb   = null;
var insp = null;
function sbSrc()   { if (sb === null)   { sb = fs.readFileSync(SB_SRC, 'utf8'); }     return sb; }
function inspSrc() { if (insp === null) { insp = fs.readFileSync(INSP_SRC, 'utf8'); } return insp; }

/** Slice a 4-space top-level function body, end-anchored on the next sibling declaration. */
function fnBlock(src, name) {
    var start = src.indexOf('function ' + name);
    assert.ok(start > -1, 'expected function ' + name + ' to exist');
    var end = src.indexOf('\n    function ', start + 10);
    return (end > -1) ? src.slice(start, end) : src.slice(start);
}

// The statusbar's event-name convention filter — kept in lockstep with the
// source by the literal pin in §01; the replica cases run against this copy.
var EVT_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+:./;

describe('01 - statusbar census + dispatchEvent capture (source pins)', function () {

    it('collects the census with the platform :not(:defined) selector and a hyphen filter', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('function _ginaComponentCensus()') > -1, 'census collector exists');
        assert.ok(s.indexOf(":not(:defined)") > -1, 'uses the platform awaiting-upgrade selector');
        assert.ok(s.indexOf("tag.indexOf('-') === -1") > -1, 'custom-element hyphen filter present');
        assert.ok(s.indexOf('undefinedCount++') > -1, 'undefined counter present');
    });

    it('attaches the census additively on user.view.components', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('u.view.components = _ginaComponentCensus();') > -1,
            'census rides user.view.components');
    });

    it('runs the census before the initial publish', function () {
        var s = sbSrc();
        var attachIdx = s.indexOf('_ginaAttachCensus();');
        // the initial localStorage publish serializes `d` (the shim serializes
        // window.__ginaData) — anchor on the initial form
        var initialIdx = s.indexOf("localStorage.setItem('__ginaData', JSON.stringify(d))");
        assert.ok(attachIdx > -1 && initialIdx > -1, 'both sites exist');
        assert.ok(s.lastIndexOf('_ginaAttachCensus();', initialIdx) > -1
            && s.lastIndexOf('_ginaAttachCensus();', initialIdx) < initialIdx,
            'a census attach precedes the initial publish');
    });

    it('re-censuses on toolbar updates, with a deferred refresh for late-landing fragments', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('function _ginaScheduleCensusRefresh()') > -1, 'deferred refresh exists');
        var updateIdx = s.indexOf('update: function (section, sectionData)');
        var syncIdx = s.indexOf("localStorage.setItem('__ginaData', JSON.stringify(window.__ginaData))");
        var refreshIdx = s.indexOf('_ginaScheduleCensusRefresh();');
        assert.ok(updateIdx > -1 && syncIdx > -1 && refreshIdx > -1, 'all three sites exist');
        assert.ok(refreshIdx > updateIdx && refreshIdx < syncIdx,
            'the update() path re-censuses before its publish');
    });

    it('wraps EventTarget.prototype.dispatchEvent with the native-apply idiom', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('var _ginaNativeDispatch = EventTarget.prototype.dispatchEvent;') > -1,
            'native reference captured');
        assert.ok(s.indexOf('_ginaNativeDispatch.apply(this, arguments)') > -1,
            'delegates to the native dispatch');
        assert.ok(s.indexOf('/* observability must never break dispatch */') > -1,
            'capture failures are contained');
    });

    it('filters on composed bubbling events matching the component naming convention', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('ev.bubbles && ev.composed') > -1, 'composed+bubbling gate present');
        assert.ok(s.indexOf('/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+:./') > -1,
            'the dashed-tag:verb name filter matches the test replica');
    });

    it('captures detail values only behind the whispered gate, through the redaction walk', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('d.gina.inspectorEventsCaptureArgs === true') > -1,
            'detail capture reads the whispered gate strictly');
        assert.ok(s.indexOf('_rdc_redact(ev.detail, null)') > -1,
            'captured detail passes the redaction walk');
    });

    it('caps the rolling client-event buffer', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('var _ginaEvtMax = 200;') > -1, 'cap constant present');
        assert.ok(s.indexOf('if (_ginaEvtBuf.length > _ginaEvtMax) _ginaEvtBuf.shift();') > -1,
            'oldest entries are dropped at the cap');
    });

    it('ships the buffer as user.clientEvents with a coalesced publish', function () {
        var s = sbSrc();
        assert.ok(s.indexOf('u.clientEvents = _ginaEvtBuf;') > -1, 'buffer rides user.clientEvents');
        assert.ok(s.indexOf('function _ginaEvtPublish()') > -1
            && s.indexOf('_ginaEvtTimer = setTimeout(') > -1,
            'publishes are coalesced, not per-event');
    });

});

describe('02 - Inspector SPA rendering (source pins)', function () {

    it('skips components in the generic View sections (bespoke renderer owns it)', function () {
        var s = inspSrc();
        assert.ok(/var VIEW_SKIP = \{ scripts: 1, stylesheets: 1, components: 1 \};/.test(s),
            'components added to VIEW_SKIP');
    });

    it('renders the census as a bespoke View-tab section with a red undefined indicator', function () {
        var s = inspSrc();
        var blk = fnBlock(s, 'renderComponentsSection(census)');
        assert.ok(s.indexOf('renderComponentsSection(view.components)') > -1,
            'renderViewContent hands the census to the bespoke renderer');
        assert.ok(blk.indexOf('bm-comp-undefined') > -1, 'red undefined indicator class used');
        assert.ok(blk.indexOf('escHtml(') > -1, 'census content is escaped');
        assert.ok(blk.indexOf('undefinedCount') > -1, 'undefined total surfaced');
    });

    it('appends client component events below the server events on the Events tab', function () {
        var s = inspSrc();
        var srvIdx = s.indexOf('renderAppEvents(treeEl, u.events);');
        var cliIdx = s.indexOf('appendClientEvents(treeEl, u.clientEvents);');
        assert.ok(srvIdx > -1 && cliIdx > -1, 'both render calls exist');
        assert.ok(cliIdx > srvIdx, 'client events render after the server events');
    });

    it('renders client events via textContent only', function () {
        var s = inspSrc();
        var blk = fnBlock(s, 'appendClientEvents(el, clientEvents)');
        assert.ok(blk.indexOf('.textContent +=') > -1, 'appends via textContent');
        assert.ok(blk.indexOf('.innerHTML') === -1, 'never composes markup from event data');
    });

    it('formats client events with name, target and gated meta', function () {
        var s = inspSrc();
        var blk = fnBlock(s, 'formatClientEventBuffer(arr)');
        assert.ok(blk.indexOf('e.name') > -1 && blk.indexOf('e.target') > -1
            && blk.indexOf('e.meta') > -1, 'line carries name/target/meta');
    });

});

describe('03 - render-delegate capture-gate whisper (source pins)', function () {

    var WHISPER = '__gdGina.inspectorEventsCaptureArgs = !!(process.gina && process.gina._inspectorEventsCaptureArgs);';

    it('render-swig whispers the gate onto the payload before it is built', function () {
        var s = fs.readFileSync(RS_PATH, 'utf8');
        var wIdx = s.indexOf(WHISPER);
        var pIdx = s.indexOf('var __gdPayload = { gina: __gdGina, user: __gdUser };');
        assert.ok(wIdx > -1, 'whisper present in render-swig');
        assert.ok(pIdx > -1 && wIdx < pIdx, 'whisper precedes the payload build');
    });

    it('render-nunjucks whispers the gate onto the payload before it is built', function () {
        var s = fs.readFileSync(RN_PATH, 'utf8');
        var wIdx = s.indexOf(WHISPER);
        var pIdx = s.indexOf('var __gdPayload = { gina: __gdGina, user: __gdUser };');
        assert.ok(wIdx > -1, 'whisper present in render-nunjucks');
        assert.ok(pIdx > -1 && wIdx < pIdx, 'whisper precedes the payload build');
    });

});

describe('04 - pure-logic replicas', function () {

    /**
     * Faithful replica of the statusbar's census classifier: totals per
     * hyphenated tag, the pending (awaiting-upgrade) set counted separately,
     * defined = totals minus pending.
     * @inner
     */
    function censusReplica(allTags, pendingTags) {
        var census = { defined: {}, undefined: {}, undefinedCount: 0 };
        var totals = {};
        for (var i = 0; i < allTags.length; i++) {
            var tag = allTags[i].toLowerCase();
            if (tag.indexOf('-') === -1) continue;
            totals[tag] = (totals[tag] || 0) + 1;
        }
        for (var p = 0; p < pendingTags.length; p++) {
            var ptag = pendingTags[p].toLowerCase();
            if (ptag.indexOf('-') === -1) continue;
            census.undefined[ptag] = (census.undefined[ptag] || 0) + 1;
            census.undefinedCount++;
        }
        for (var t in totals) {
            var pend = census.undefined[t] || 0;
            if (totals[t] > pend) census.defined[t] = totals[t] - pend;
        }
        return census;
    }

    it('census: splits defined and awaiting-upgrade tags, ignores non-custom tags', function () {
        var census = censusReplica(
            ['DIV', 'X-LIVE', 'X-LIVE', 'X-GHOST', 'SPAN', 'MY-WIDGET'],
            ['X-GHOST']
        );
        assert.deepEqual(census.defined, { 'x-live': 2, 'my-widget': 1 });
        assert.deepEqual(census.undefined, { 'x-ghost': 1 });
        assert.equal(census.undefinedCount, 1);
    });

    it('census: a page with no custom elements yields an empty census', function () {
        var census = censusReplica(['DIV', 'UL', 'LI'], []);
        assert.deepEqual(census.defined, {});
        assert.deepEqual(census.undefined, {});
        assert.equal(census.undefinedCount, 0);
    });

    it('census: a tag entirely awaiting upgrade never shows as defined', function () {
        var census = censusReplica(['X-GHOST', 'X-GHOST'], ['X-GHOST', 'X-GHOST']);
        assert.deepEqual(census.defined, {});
        assert.deepEqual(census.undefined, { 'x-ghost': 2 });
        assert.equal(census.undefinedCount, 2);
    });

    it('event-name filter: accepts the component convention, rejects everything else', function () {
        assert.ok(EVT_NAME_RE.test('x-checklist:changed'));
        assert.ok(EVT_NAME_RE.test('my-widget:refresh'));
        assert.ok(EVT_NAME_RE.test('x-a:b'));
        assert.ok(!EVT_NAME_RE.test('deps.loaded'), 'internal dot-namespaced events excluded');
        assert.ok(!EVT_NAME_RE.test('click'), 'native events excluded');
        assert.ok(!EVT_NAME_RE.test('x:changed'), 'a dashless prefix is not a custom-element tag');
        assert.ok(!EVT_NAME_RE.test('x-widget'), 'no verb, no capture');
        assert.ok(!EVT_NAME_RE.test('X-Widget:Changed'), 'convention is lowercase');
    });

    it('buffer cap: the oldest entries are dropped once the cap is reached', function () {
        var buf = [];
        var MAX = 200;
        for (var i = 0; i < 250; i++) {
            buf.push({ name: 'x-a:b', t: i });
            if (buf.length > MAX) buf.shift();
        }
        assert.equal(buf.length, 200);
        assert.equal(buf[0].t, 50, 'the first 50 entries were shifted out');
        assert.equal(buf[199].t, 249);
    });

    it('detail gate: meta rides only when the gate is on', function () {
        function captureReplica(gateOn, ev) {
            var entry = { name: ev.type, t: 1, target: 'x-a' };
            if (gateOn && typeof ev.detail !== 'undefined') { entry.meta = ev.detail; }
            return entry;
        }
        var ev = { type: 'x-a:b', detail: { done: 1 } };
        assert.ok('meta' in captureReplica(true, ev));
        assert.ok(!('meta' in captureReplica(false, ev)));
    });

});

describe('05 - dist propagation', function () {

    it('the built statusbar is a verbatim copy of the source', function () {
        assert.equal(fs.readFileSync(SB_DIST, 'utf8'), sbSrc(),
            'dist statusbar.html must match src (copy phase, no transform)');
    });

    it('the built SPA is a verbatim copy of the source', function () {
        assert.equal(fs.readFileSync(INSP_DIST, 'utf8'), inspSrc(),
            'dist inspector.js must match src (copy phase, no transform)');
    });

    it('the built inspector stylesheet carries the census indicator styles', function () {
        var css = fs.readFileSync(CSS_DIST, 'utf8');
        assert.ok(css.indexOf('.bm-comp-undefined') > -1, 'undefined indicator style shipped');
        assert.ok(css.indexOf('.bm-comp-defined') > -1, 'defined list style shipped');
    });

});
