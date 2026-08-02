'use strict';
/**
 * #SPA1 Slice 4 — the `gina/nav` client navigation module.
 *
 * Covers, without a browser or a live boot:
 *  - wiring: the AMD alias in BOTH build configs (a single-file edit silently
 *    breaks the dev build — their paths maps must stay identical), the module
 *    id in core.js's require array, and the OPT-IN boot shim (marker-gated:
 *    no `data-gina-nav` region, no construction — upgrading the framework
 *    must not change navigation behaviour on existing pages);
 *  - structural invariants of the module: publish-once (#B90 — never a
 *    merge-publish), a FRESH XMLHttpRequest per navigation (#B175 — the
 *    module-scope shared-XHR shape is the defect class), both request
 *    headers (the negotiation signal + the XHR marker that keeps the
 *    layoutless body out of the render path's iframe-wrap), the
 *    `Vary: X-Gina-Navigate` protocol check, and the raw
 *    `window.addEventListener('popstate', ...)` registration
 *    (utils/events' addListener reads `element.getAttribute` at
 *    registration, which `window` lacks);
 *  - behaviour of the URL matcher, by executing the EXTRACTED shipped bytes
 *    (brace-walk extraction, no re-typed replica) over synthetic routing
 *    tables in the served-map shape: first-match-in-table-order, the bundle
 *    filter, method candidacy (single GET / single DELETE as a BLOCKING
 *    candidate / comma multi-method), comma-separated url variants,
 *    requirement regexes in both `/body/flags` and bare form, the
 *    binding-without-requirement rule, unmatchable shapes (mixed
 *    literal+param segments, keys with neither requirement nor binding),
 *    decode behaviour (including the malformed-% fallback) and the raw
 *    exact-equality short-circuit — each mirroring the server scan;
 *  - behaviour of the response discrimination (extracted onNavResponse
 *    driven with stub XHRs): fragment swap only on a negotiated 2xx, hard
 *    fallback on an un-negotiated 2xx / non-2xx / status 0, and the JSON
 *    `{location}` redirect protocol;
 *  - dist fidelity: the rebuilt bundles carry the module (string-literal
 *    needles that survive Closure SIMPLE), with a bogus-token control.
 *
 * Red-first: run with GINA_SPA_NAV_PRE_ROOT pointing at a tree of the
 * pre-slice bytes (git show HEAD:<path> extracts) — the module/wiring/dist
 * sections must fail there while the §00 controls stay green.
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');
var fs     = require('fs');

var REPO    = path.resolve(__dirname, '..', '..');
var FW_NAME = 'v' + require(path.join(REPO, 'package.json')).version;
var ROOT    = process.env.GINA_SPA_NAV_PRE_ROOT || REPO;
var FW      = path.join(ROOT, 'framework', FW_NAME);

var PLUGIN_SRC     = path.join(FW, 'core/asset/plugin/src/vendor/gina');
var CORE_PATH      = path.join(PLUGIN_SRC, 'core.js');
var BUILD_PATH     = path.join(PLUGIN_SRC, 'build.json');
var BUILD_DEV_PATH = path.join(PLUGIN_SRC, 'build.dev.json');
var NAV_PATH       = path.join(PLUGIN_SRC, 'nav/main.js');
var DIST_JS        = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.js');
var DIST_MIN_JS    = path.join(FW, 'core/asset/plugin/dist/vendor/gina/js/gina.min.js');


/**
 * Brace-walk extraction of a function expression from source — executes the
 * SHIPPED bytes (no drift-prone replica). Control-gated: the declaration must
 * appear exactly once, and the walk must close balanced. Starts the walk AT
 * the declaration with a started-flag so both `function() {` and
 * `function () {`-after-space decl shapes extract correctly.
 *
 * @param {string} src - whole module source
 * @param {string} decl - unique declaration prefix, e.g. `var matchUrl = function(pathname) {`
 * @returns {string} the `function(...) {...}` slice
 */
function extractFn(src, decl) {
    var i = src.indexOf(decl);
    assert.ok(i > -1, 'declaration not found: ' + decl);
    assert.equal(src.indexOf(decl, i + 1), -1, 'declaration must be unique: ' + decl);
    var j = i, depth = 0, started = false;
    for (; j < src.length; j++) {
        if (src[j] === '{') { depth++; started = true; }
        else if (src[j] === '}') {
            depth--;
            if (started && depth === 0) { j++; break; }
        }
    }
    assert.ok(started && depth === 0, 'unbalanced braces walking: ' + decl);
    return src.substring(i + decl.indexOf('function'), j);
}


describe('#SPA1 nav §00 — instrument: sources readable, known anchors fire', function() {

    it('core.js + build.json + dist read, known positives fire, bogus negative does not', function() {
        var coreSrc  = fs.readFileSync(CORE_PATH, 'utf8');
        var buildSrc = fs.readFileSync(BUILD_PATH, 'utf8');
        var distMin  = fs.readFileSync(DIST_MIN_JS, 'utf8');
        // known positives — pre-slice bytes carry these too, so a later 0 is
        // an absent feature, not a broken instrument
        assert.ok(coreSrc.indexOf('bootValidator();') > -1, 'core.js control anchor must fire');
        assert.ok(buildSrc.indexOf('"gina/link"') > -1, 'build.json control anchor must fire');
        assert.ok(distMin.indexOf('gina/link') > -1, 'dist control anchor must fire');
        // known negative — the instrument can also NOT fire
        assert.equal(coreSrc.indexOf('zzz-bogus-anchor-spa-nav'), -1, 'bogus anchor must not fire');
    });
});


describe('#SPA1 nav §01 — wiring: both build configs, the require array, the opt-in boot shim', function() {

    var coreSrc, buildSrc, buildDevSrc;

    before(function() {
        coreSrc     = fs.readFileSync(CORE_PATH, 'utf8');
        buildSrc    = fs.readFileSync(BUILD_PATH, 'utf8');
        buildDevSrc = fs.readFileSync(BUILD_DEV_PATH, 'utf8');
    });

    it('build.json carries the gina/nav paths alias', function() {
        assert.ok(buildSrc.indexOf('"gina/nav"') > -1, 'alias key missing from build.json');
        assert.ok(buildSrc.indexOf('vendor/gina/nav/main') > -1, 'alias target missing from build.json');
    });

    it('build.dev.json carries the SAME alias — the paths maps must stay identical', function() {
        assert.ok(buildDevSrc.indexOf('"gina/nav"') > -1, 'alias key missing from build.dev.json');
        assert.ok(buildDevSrc.indexOf('vendor/gina/nav/main') > -1, 'alias target missing from build.dev.json');
    });

    it('core.js requires gina/nav — r.js traces from `core`, an alias nothing requires never bundles', function() {
        assert.ok(coreSrc.indexOf('"gina/nav"') > -1, 'module id missing from the core.js require array');
    });

    it('the boot shim exists and is CALLED', function() {
        assert.ok(coreSrc.indexOf('var bootNav = function') > -1, 'bootNav declaration missing');
        assert.ok(coreSrc.indexOf('bootNav();') > -1, 'bootNav() call missing');
    });

    it('the shim is MARKER-GATED (opt-in per project) and idempotent on hasNavHandler', function() {
        var blk = coreSrc.substring(coreSrc.indexOf('var bootNav = function'), coreSrc.indexOf('bootNav();'));
        assert.ok(blk.indexOf('[data-gina-nav]:not([data-gina-nav="false"])') > -1,
            'the marker query must exclude the per-link "false" opt-out spelling');
        assert.ok(blk.indexOf("window['gina']['hasNavHandler']") > -1,
            'the shim must be idempotent on hasNavHandler');
        assert.ok(blk.indexOf("window['gina']['isFrameworkLoaded']") > -1,
            'the shim must defer until the framework wired the gina instance (bounded poll)');
        assert.ok(blk.indexOf('_navBootTries++ < 100') > -1,
            'the poll must stay bounded');
    });

    it('the shim constructs NOTHING when the marker is absent — the require sits AFTER the marker gate', function() {
        var blk = coreSrc.substring(coreSrc.indexOf('var bootNav = function'), coreSrc.indexOf('bootNav();'));
        var gateIdx    = blk.indexOf('[data-gina-nav]:not([data-gina-nav="false"])');
        var requireIdx = blk.indexOf("require('gina/nav')");
        assert.ok(gateIdx > -1 && requireIdx > -1);
        assert.ok(gateIdx < requireIdx, 'the marker gate must precede the module require/construction');
    });
});


describe('#SPA1 nav §02 — module structural invariants', function() {

    var src;

    before(function() {
        src = fs.readFileSync(NAV_PATH, 'utf8');
    });

    it('publishes ONCE, guarded — the #B90 popin shape, never a merge-publish', function() {
        assert.ok(src.indexOf("if ( typeof(gina.nav) == 'undefined' || !gina.nav ) {") > -1,
            'the guarded publish-once shape is required');
        assert.ok(src.indexOf('gina.nav = instance;') > -1, 'gina.nav must be the live instance');
        assert.doesNotMatch(src, /merge\(\s*gina\.nav/,
            'a merge-publish freezes accessors and scalar state (#B90)');
    });

    it('opens a FRESH XMLHttpRequest inside navigate() — #B175', function() {
        var nav = extractFn(src, 'var navigate = function(url, navOptions) {');
        assert.ok(nav.indexOf('new XMLHttpRequest()') > -1,
            'navigate must construct its own XHR per call');
        assert.ok(nav.indexOf('++_navSeq') > -1 && nav.indexOf('.abort()') > -1,
            'a new navigation must supersede (sequence) and abort the in-flight one');
    });

    it('sends BOTH headers — the negotiation signal and the XHR marker', function() {
        var nav = extractFn(src, 'var navigate = function(url, navOptions) {');
        assert.ok(nav.indexOf("setRequestHeader('X-Gina-Navigate', 'fragment')") > -1,
            'the #SPA1 negotiation signal is required');
        assert.ok(nav.indexOf("setRequestHeader('X-Requested-With', 'XMLHttpRequest')") > -1,
            'without the XHR marker the render path re-wraps the layoutless body in an <html> shell');
    });

    it('discriminates on `Vary: X-Gina-Navigate` before applying a fragment', function() {
        var resp = extractFn(src, 'var onNavResponse = function(xhr, url, isPopState, navOptions) {');
        var varyIdx  = resp.indexOf('/x-gina-navigate/i.test(vary)');
        var applyIdx = resp.indexOf('applyFragment(');
        assert.ok(varyIdx > -1, 'the Vary protocol check is required');
        assert.ok(applyIdx > varyIdx, 'the swap must sit behind the Vary check');
    });

    it('registers popstate through raw window.addEventListener, never utils/events addListener', function() {
        assert.ok(src.indexOf("window.addEventListener('popstate'") > -1,
            'popstate must attach directly on window');
        assert.doesNotMatch(src, /addListener\(\s*gina\s*,\s*window/,
            "utils/events' addListener dereferences element.getAttribute — window lacks it");
    });

    it('the delegated click handler defers to every enumerated owner and skips browser-owned clicks', function() {
        var click = extractFn(src, 'var onDocumentClick = function(event) {');
        [
            "getAttribute('data-gina-link')",
            "getAttribute('data-gina-link-url')",
            "getAttribute('data-gina-dialog')",
            "getAttribute('data-gina-dialog-src')",
            "getAttribute('data-gina-popin-name')",
            "getAttribute('data-gina-popin-url')",
            "getAttribute('data-gina-nav')",
            "getAttribute('target')",
            "getAttribute('download')"
        ].forEach(function(needle) {
            assert.ok(click.indexOf(needle) > -1, 'missing ownership/skip check: ' + needle);
        });
        assert.ok(click.indexOf('event.defaultPrevented') > -1, 'must yield to an already-handled click');
        assert.ok(click.indexOf('event.ctrlKey || event.metaKey || event.shiftKey || event.altKey') > -1,
            'modified clicks belong to the browser');
    });

    it('intercepts only a first-match route that declares negotiate === true AND accepts GET', function() {
        var click = extractFn(src, 'var onDocumentClick = function(event) {');
        assert.ok(click.indexOf('matched.route.negotiate !== true || !matched.isGet') > -1,
            'the strict negotiate + GET gate is the interception contract');
        var gateIdx   = click.indexOf('matched.route.negotiate !== true');
        var cancelIdx = click.indexOf('cancelEvent(event)');
        assert.ok(cancelIdx > gateIdx, 'the click is claimed only AFTER the gate passes');
    });

    it('reads the routing table lazily — no boot-time snapshot (the table can arrive after isFrameworkLoaded)', function() {
        var compiled = extractFn(src, 'var getCompiled = function() {');
        assert.ok(compiled.indexOf('window.gina && window.gina.config') > -1,
            'the table must be dereferenced at call time');
        assert.ok(compiled.indexOf('_compiledFor === routing') > -1,
            'the compile cache must key on table object identity');
    });
});


// ---------------------------------------------------------------------------
// Behavioural sections — the extracted REAL functions, composed with injected
// scope, driven over synthetic tables in the served-map shape.
// ---------------------------------------------------------------------------

var EX = null; // extracted sources, filled in §03

describe('#SPA1 nav §03 — extraction controls', function() {

    it('every extraction fires on exactly one declaration with balanced braces', function() {
        var src = fs.readFileSync(NAV_PATH, 'utf8');
        EX = {
            safeDecode       : extractFn(src, 'var safeDecode = function(str) {'),
            parseRequirement : extractFn(src, 'var parseRequirement = function(requirement) {'),
            compileVariant   : extractFn(src, 'var compileVariant = function(url, route) {'),
            getCompiled      : extractFn(src, 'var getCompiled = function() {'),
            matchUrl         : extractFn(src, 'var matchUrl = function(pathname) {'),
            onNavResponse    : extractFn(src, 'var onNavResponse = function(xhr, url, isPopState, navOptions) {')
        };
        for (var k in EX) {
            assert.ok(/^function/.test(EX[k]), k + ' extraction must start at the function keyword');
        }
    });
});

/**
 * Composes the extracted matcher chain over a synthetic routing table.
 *
 * @param {object} routing - synthetic table in the SERVED shape
 * @param {string} bundle - the client's current bundle
 * @returns {function} the real matchUrl, scope-injected
 */
function makeMatcher(routing, bundle) {
    var fakeWindow  = { gina: { config: { bundle: bundle, routing: routing } } };
    var _parse      = new Function('return (' + EX.parseRequirement + ');')();
    var _compile    = new Function('parseRequirement', 'return (' + EX.compileVariant + ');')(_parse);
    var _getCompiled = new Function('window', '_compiled', '_compiledFor', 'compileVariant',
        'return (' + EX.getCompiled + ');')(fakeWindow, null, null, _compile);
    var _safeDecode = new Function('return (' + EX.safeDecode + ');')();
    return new Function('getCompiled', 'safeDecode', 'return (' + EX.matchUrl + ');')(_getCompiled, _safeDecode);
}


describe('#SPA1 nav §04 — parseRequirement mirrors the server parsing', function() {

    var parse;
    before(function() {
        parse = new Function('return (' + EX.parseRequirement + ');')();
    });

    it('parses /body/ form', function() {
        var re = parse('/^\\d+$/');
        assert.ok(re instanceof RegExp);
        assert.ok(re.test('42'));
        assert.ok(!re.test('a4'));
    });

    it('honours flags — /body/i', function() {
        var re = parse('/^[a-z]+$/i');
        assert.ok(re.test('ABC'));
    });

    it('greedy body extraction keeps internal slashes — the server\'s own match(/\\/(.*)\\//) shape', function() {
        var re = parse('/^a\\/b$/');
        assert.ok(re.test('a/b'));
    });

    it('bare string feeds RegExp directly', function() {
        var re = parse('^v\\d+$');
        assert.ok(re.test('v2'));
        assert.ok(!re.test('x2'));
    });

    it('a malformed requirement returns null (fail-open to browser navigation, where the server would 500)', function() {
        assert.equal(parse('/[/'), null);
    });
});


describe('#SPA1 nav §05 — compileVariant mirrors segment semantics', function() {

    var parse, compile;
    before(function() {
        parse   = new Function('return (' + EX.parseRequirement + ');')();
        compile = new Function('parseRequirement', 'return (' + EX.compileVariant + ');')(parse);
    });

    it('pure literals compile to literal matchers', function() {
        var m = compile('/section/list', { param: {} });
        assert.equal(m.length, 3);
        assert.equal(m[1].lit, 'section');
        assert.equal(m[2].lit, 'list');
    });

    it(':key with a requirement compiles to its regex', function() {
        var m = compile('/item/:id', { param: { id: ':id' }, requirements: { id: '/^\\d+$/' } });
        assert.equal(m[2].key, 'id');
        assert.ok(m[2].re instanceof RegExp);
    });

    it(':key with a param binding but no requirement matches any non-empty segment (re null)', function() {
        var m = compile('/user/:name', { param: { name: ':name' } });
        assert.equal(m[2].key, 'name');
        assert.equal(m[2].re, null);
    });

    it(':key with NEITHER requirement nor binding is unmatchable — the fitsWithRequirements refusal', function() {
        assert.equal(compile('/user/:name', { param: {} }), null);
    });

    it('a mixed literal+param segment is unmatchable in Tier 1 (conservative, false-negative-safe)', function() {
        assert.equal(compile('/section/page:number', { param: { number: ':number' }, requirements: { number: '/^\\d+$/' } }), null);
    });

    it('a malformed requirement makes the variant unmatchable', function() {
        assert.equal(compile('/item/:id', { param: { id: ':id' }, requirements: { id: '/[/' } }), null);
    });
});


describe('#SPA1 nav §06 — matchUrl mirrors the server scan over the served table', function() {

    it('matches a literal GET route and returns its rule', function() {
        var match = makeMatcher({
            'home@demo': { url: '/', method: 'GET', bundle: 'demo', param: {} },
            'list@demo': { url: '/section/list', method: 'GET', bundle: 'demo', param: {}, negotiate: true }
        }, 'demo');
        var m = match('/section/list');
        assert.ok(m);
        assert.equal(m.rule, 'list@demo');
        assert.equal(m.route.negotiate, true);
        assert.equal(m.isGet, true);
    });

    it('first match in TABLE ORDER wins — a non-negotiable first match still blocks (the caller then does not intercept)', function() {
        var match = makeMatcher({
            'plain@demo'  : { url: '/page', method: 'GET', bundle: 'demo', param: {} },
            'shadow@demo' : { url: '/page', method: 'GET', bundle: 'demo', param: {}, negotiate: true }
        }, 'demo');
        var m = match('/page');
        assert.equal(m.rule, 'plain@demo', 'the server dispatches the FIRST matching rule — the client must agree');
        assert.equal(m.route.negotiate, undefined);
    });

    it('a foreign-bundle route is skipped; a later same-bundle route matches', function() {
        var match = makeMatcher({
            'page@other': { url: '/page', method: 'GET', bundle: 'other', param: {}, negotiate: true },
            'page@demo' : { url: '/page', method: 'GET', bundle: 'demo', param: {} }
        }, 'demo');
        var m = match('/page');
        assert.ok(m);
        assert.equal(m.rule, 'page@demo');
    });

    it('a paramless route is skipped — the server scan skips entries without param', function() {
        var match = makeMatcher({
            'noparam@demo': { url: '/page', method: 'GET', bundle: 'demo' }
        }, 'demo');
        assert.equal(match('/page'), null);
    });

    it('a single-method POST route is not a candidate for a GET navigation', function() {
        var match = makeMatcher({
            'submit@demo': { url: '/page', method: 'POST', bundle: 'demo', param: {} }
        }, 'demo');
        assert.equal(match('/page'), null);
    });

    it('a single-method DELETE route IS a blocking candidate (the server GET→DELETE override) with isGet false', function() {
        var match = makeMatcher({
            'remove@demo': { url: '/item/close', method: 'DELETE', bundle: 'demo', param: {} },
            'view@demo'  : { url: '/item/close', method: 'GET', bundle: 'demo', param: {}, negotiate: true }
        }, 'demo');
        var m = match('/item/close');
        assert.ok(m);
        assert.equal(m.rule, 'remove@demo', 'the DELETE route must BLOCK, so nav never intercepts across it');
        assert.equal(m.isGet, false);
    });

    it('a comma multi-method route is a candidate; GET in the list sets isGet', function() {
        var match = makeMatcher({
            'form@demo': { url: '/page', method: 'GET, POST', bundle: 'demo', param: {}, negotiate: true }
        }, 'demo');
        var m = match('/page');
        assert.ok(m);
        assert.equal(m.isGet, true);
    });

    it('comma-separated url variants — the second variant matches', function() {
        var match = makeMatcher({
            'item@demo': { url: '/item/:id,/item/:id/details', method: 'GET', bundle: 'demo',
                param: { id: ':id' }, requirements: { id: '/^\\d+$/' }, negotiate: true }
        }, 'demo');
        assert.ok(match('/item/42/details'));
    });

    it('a requirement regex gates the segment — /item/42 matches, /item/abc does not', function() {
        var match = makeMatcher({
            'item@demo': { url: '/item/:id', method: 'GET', bundle: 'demo',
                param: { id: ':id' }, requirements: { id: '/^\\d+$/' }, negotiate: true }
        }, 'demo');
        assert.ok(match('/item/42'));
        assert.equal(match('/item/abc'), null);
    });

    it('requirement flags apply — /body/i matches an uppercase segment', function() {
        var match = makeMatcher({
            'tag@demo': { url: '/tag/:name', method: 'GET', bundle: 'demo',
                param: { name: ':name' }, requirements: { name: '/^[a-z]+$/i' }, negotiate: true }
        }, 'demo');
        assert.ok(match('/tag/NEWS'));
    });

    it('a binding without a requirement matches any non-empty segment — and refuses the empty one', function() {
        var match = makeMatcher({
            'user@demo': { url: '/user/:name', method: 'GET', bundle: 'demo',
                param: { name: ':name' }, negotiate: true }
        }, 'demo');
        assert.ok(match('/user/anyone'));
        assert.equal(match('/user/'), null, 'an empty segment must not satisfy a placeholder');
    });

    it('segment-count mismatch never matches', function() {
        var match = makeMatcher({
            'item@demo': { url: '/item/:id', method: 'GET', bundle: 'demo',
                param: { id: ':id' }, requirements: { id: '/^\\d+$/' }, negotiate: true }
        }, 'demo');
        assert.equal(match('/item/42/extra'), null);
        assert.equal(match('/item'), null);
    });

    it('the pathname is matched DECODED — %20 decodes before the requirement test', function() {
        var match = makeMatcher({
            'tag@demo': { url: '/tag/:name', method: 'GET', bundle: 'demo',
                param: { name: ':name' }, requirements: { name: '/^[a-z ]+$/' }, negotiate: true }
        }, 'demo');
        assert.ok(match('/tag/two%20words'));
    });

    it('a malformed percent-sequence falls back to the raw string — no throw (#B30 mirror)', function() {
        var match = makeMatcher({
            'item@demo': { url: '/item/:id', method: 'GET', bundle: 'demo',
                param: { id: ':id' }, requirements: { id: '/^\\d+$/' }, negotiate: true }
        }, 'demo');
        assert.equal(match('/item/%zz'), null); // and it must not throw
    });

    it('raw exact-equality short-circuits — a client-unmatchable variant still matches on byte equality (server :6932 mirror)', function() {
        var match = makeMatcher({
            'mixed@demo': { url: '/section/page:number', method: 'GET', bundle: 'demo',
                param: { number: ':number' }, negotiate: true }
        }, 'demo');
        var m = match('/section/page:number');
        assert.ok(m, 'pathname byte-equal to the raw pattern must match even when the variant cannot compile');
        assert.equal(m.rule, 'mixed@demo');
    });

    it('no routing table yet (the async fetch has not landed) — null, never a throw', function() {
        var fakeWindow  = { gina: { config: { bundle: 'demo' } } };
        var _parse      = new Function('return (' + EX.parseRequirement + ');')();
        var _compile    = new Function('parseRequirement', 'return (' + EX.compileVariant + ');')(_parse);
        var _getCompiled = new Function('window', '_compiled', '_compiledFor', 'compileVariant',
            'return (' + EX.getCompiled + ');')(fakeWindow, null, null, _compile);
        var _safeDecode = new Function('return (' + EX.safeDecode + ');')();
        var match = new Function('getCompiled', 'safeDecode', 'return (' + EX.matchUrl + ');')(_getCompiled, _safeDecode);
        assert.equal(match('/anything'), null);
    });
});


describe('#SPA1 nav §07 — response discrimination (extracted onNavResponse, stub XHRs)', function() {

    /**
     * Drives the extracted onNavResponse with a stub XHR and recording spies.
     *
     * @param {object} xhrShape - { status, contentType, vary, body }
     * @returns {object} { applied, fell, redirectedTo }
     */
    function drive(xhrShape) {
        var applied = null, fell = null;
        var fakeWindow = { location: { href: '' } };
        var onNavResponse = new Function('applyFragment', 'fallback', 'window',
            'return (' + EX.onNavResponse + ');')(
            function(html, url, isPopState) { applied = { html: html, url: url }; },
            function(url, isPopState, errorData) { fell = { url: url, errorData: errorData }; },
            fakeWindow
        );
        var xhr = {
            status: xhrShape.status,
            statusText: xhrShape.statusText || '',
            responseText: xhrShape.body || '',
            getResponseHeader: function(name) {
                if (/content-type/i.test(name)) { return xhrShape.contentType || null; }
                if (/vary/i.test(name)) { return xhrShape.vary || null; }
                return null;
            }
        };
        onNavResponse(xhr, '/target', false, null);
        return { applied: applied, fell: fell, redirectedTo: fakeWindow.location.href };
    }

    it('a negotiated 2xx HTML answer is applied', function() {
        var r = drive({ status: 200, contentType: 'text/html; charset=utf-8', vary: 'X-Gina-Navigate', body: '<p>frag</p>' });
        assert.ok(r.applied);
        assert.equal(r.applied.html, '<p>frag</p>');
        assert.equal(r.fell, null);
    });

    it('the Vary check accepts the LIST form — an appended value still negotiates', function() {
        var r = drive({ status: 200, contentType: 'text/html', vary: 'Origin, X-Gina-Navigate', body: 'x' });
        assert.ok(r.applied);
    });

    it('a 2xx WITHOUT the Vary advertisement falls back — the matcher false-positive recovery', function() {
        var r = drive({ status: 200, contentType: 'text/html', vary: 'Origin', body: '<html>full page</html>' });
        assert.equal(r.applied, null);
        assert.ok(r.fell);
        assert.equal(r.fell.url, '/target');
    });

    it('a JSON {location} answer hard-follows the redirect — the established XHR protocol', function() {
        var r = drive({ status: 200, contentType: 'application/json', body: '{"status":200,"location":"/next"}' });
        assert.equal(r.applied, null);
        assert.equal(r.fell, null);
        assert.equal(r.redirectedTo, '/next');
    });

    it('a JSON answer without location falls back', function() {
        var r = drive({ status: 200, contentType: 'application/json', body: '{"status":200}' });
        assert.ok(r.fell);
    });

    it('a non-2xx falls back', function() {
        var r = drive({ status: 404, contentType: 'text/html', body: 'nope' });
        assert.ok(r.fell);
        assert.equal(r.fell.errorData.status, 404);
    });

    it('status 0 (network failure / timeout abort) falls back', function() {
        var r = drive({ status: 0 });
        assert.ok(r.fell);
        assert.equal(r.fell.errorData.status, 0);
    });
});


describe('#SPA1 nav §08 — dist fidelity (needles survive Closure SIMPLE: ids, string literals)', function() {

    var distJs, distMin;

    before(function() {
        distJs  = fs.readFileSync(DIST_JS, 'utf8');
        distMin = fs.readFileSync(DIST_MIN_JS, 'utf8');
    });

    it('the module id, the marker attribute and the negotiation header ship in BOTH bundles', function() {
        ['gina/nav', 'data-gina-nav', 'X-Gina-Navigate'].forEach(function(needle) {
            assert.ok(distJs.indexOf(needle) > -1, 'gina.js missing: ' + needle);
            assert.ok(distMin.indexOf(needle) > -1, 'gina.min.js missing: ' + needle);
        });
    });

    it('the boot shim ships — gina.js keeps the name, gina.min.js keeps the console literal', function() {
        assert.ok(distJs.indexOf('bootNav();') > -1, 'unminified dist must carry the shim call');
        assert.ok(distMin.indexOf('nav boot failed') > -1,
            'the minified dist pin must be a Closure-surviving string literal (var names are renamed)');
    });

    it('control — a bogus needle does not fire', function() {
        assert.equal(distMin.indexOf('zzz-bogus-dist-needle-spa-nav'), -1);
    });
});
