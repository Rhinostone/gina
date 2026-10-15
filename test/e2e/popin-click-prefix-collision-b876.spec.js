'use strict';

/**
 * Playwright RUNTIME e2e for gh#86 / #B876 — a popin's document click proxy must claim only the
 * triggers of its OWN instance (the real built bundle, real pointer clicks, real XHRs).
 *
 * Every `new Popin()` adds a document click listener that decides whether a clicked legacy
 * trigger is its own with `_rePopinClick`, built from the instance id. Instance ids are
 * `'gina-popins-' + _nextId()` from ONE counter that trigger ids also draw from, and a trigger id
 * is `popin.click.gina-popin-<instance.id>-<_nextId()>-<name>`. With no delimiter after the
 * instance id, the regex of `gina-popins-gp-1` also matched the triggers of `gina-popins-gp-14`,
 * so one click dispatched the trigger twice. The fix ends the regex with `instance.id + '-'`.
 *
 * WHAT THE SECOND DISPATCH COSTS depends on the trigger (measured on the pre-fix bundle in this
 * harness, the scene below):
 *   - a <button> the click did not warm (`data-gina-dialog-preload="false"`): TWO GETs for the
 *     popin URL; the second answer re-injects the content after the first was bound, the
 *     validator keeps the detached form, and the submit is a native POST that navigates to the
 *     form action (the reported symptom);
 *   - an <a>: the second dispatch still happens, but the #B298 gate stops the second load
 *     (armPopinTrigger has already marked the <a> aria-disabled), so ONE GET;
 *   - a trigger the click warmed (default preload): the second dispatch adopts the same
 *     in-flight preload, so ONE GET.
 * Arm 01 is therefore the user-visible failure, and arm 02 pins the dispatch itself, which no
 * load count can see on an <a>.
 *
 * WHY test/e2e: the collision needs the real id counter of the real bundle (bindOpen draws the
 * trigger ids at bind time, in document order) and a real click through two document proxies.
 * The unit test (test/core/popin-click-prefix-collision-b876.test.js) pins the regex itself.
 *
 * SCENE: the boot popin (`gina-dialog-boot`, constructed by core.js) is popin A, and it binds
 * the N legacy triggers named after it, each drawing one id. Popin B is constructed afterwards
 * with the validator, so the form its content carries is bound. N = 12 gives A = gp-1 and
 * B = gp-14 (a prefix pair); N = 2 gives B = gp-4 (no prefix — the control). The ids are READ
 * from the page and checked first: an arm whose ids drift out of that relationship is void, not
 * passing. Legacy triggers must be in the served HTML (bindOpen is not delegated), so the page is
 * route-fulfilled; `data-gina-dialog-preload="false"` keeps the pointer's hover from warming the
 * fetch (see above). The `gina.onload.hform.js` whisper is what boots `gina.validator`.
 *
 * Arms:
 *   01 prefix pair, <button>  -> 1 dispatch, 1 GET, the bound form is the open popin's, XHR
 *                                submit, no navigation (pre-fix: 2 dispatches, 2 GETs, a
 *                                detached bound form, a native POST that navigates away)
 *   02 prefix pair, <a>       -> 1 dispatch (pre-fix: 2); 1 GET on both sides (#B298)
 *   03 control, no prefix     -> 1 dispatch, 1 GET, XHR submit on both sides
 *
 * Red-first: B876_PREFIX_BUNDLE=<path to a pre-fix gina.min.js> serves those bytes through
 * page.route (nothing written to disk; the route hit is asserted). Measured on develop's
 * c3573e2a7 dist (md5 887513e8…) and on the published 0.7.3 client (47af0fa4…): 01 and 02 fail
 * on their defect readings, 03 passes.
 *
 * Run:
 *   npx playwright test test/e2e/popin-click-prefix-collision-b876.spec.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

const FRAG_DELAY_MS = 300;    // the frag answer is held, so a double dispatch has both GETs in flight
const SETTLE_MS = 1500;

// Calls onGinaLoaded when the route-fulfilled page beat the framework to it (the gh#76 harness).
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// Popin B's content: a form that opts in (a `data-gina-form-*` attribute), so the validator
// given to the popin binds it at load.
const FRAG = '<div id="b876-frag"><p>popin content</p>'
    + '<form id="pform" data-gina-form-rule="pform" action="/b876/save" method="post">'
    + '<input name="ref" value="in-popin"><button id="pform-submit" type="submit">Save</button></form></div>';

/**
 * The scene page: N legacy triggers of the boot popin (never clicked), then one legacy trigger of
 * popin B. Every trigger opts out of the preload, so no hover warms a fetch.
 *
 * @param {{ nBoot: number, tag: string }} o - boot-trigger count, and the tag of B's trigger
 * @returns {string} the HTML document
 */
function buildPage(o) {
    var boot = '';
    for (var i = 0; i < o.nBoot; i++) {
        boot += '<a href="#" data-gina-popin-name="gina-dialog-boot" data-gina-popin-url="/b876/boot-frag.html"'
              + ' data-gina-dialog-preload="false">boot ' + i + '</a> ';
    }
    var href = (o.tag === 'a') ? ' href="#"' : '';
    var trigger = '<' + o.tag + ' data-probe="t"' + href + ' data-gina-dialog-preload="false"'
                + ' data-gina-popin-name="b876" data-gina-popin-url="/b876/frag.html">Open</' + o.tag + '>';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b876</title>'
        + '<link rel="icon" href="data:,"><link rel="stylesheet" href="/css/vendor/gina/gina.min.css">'
        + '<script src="/js/gina.onload.hform.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body><h1>b876</h1>'
        + '<p>' + boot + '</p><p>' + trigger + '</p></body></html>';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Boot the scene, construct popin B, click its trigger once, then submit the form it loaded.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ nBoot: number, tag: string }} o
 * @returns {Promise<object>} the ids, the counts, the form binding, the submit request(s) and
 *          the page path afterwards
 */
async function drive(page, o) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
    let routeHits = 0, gets = 0, bootGets = 0;
    const saves = [];

    if (process.env.B876_PREFIX_BUNDLE) {
        const body = fs.readFileSync(process.env.B876_PREFIX_BUNDLE);
        await page.route('**/js/gina.min.js', (r) => {
            routeHits++;
            r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: body });
        });
    }
    await page.route('**/b876', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: buildPage(o) }));
    await page.route('**/b876/frag.html', async (r) => {
        gets++;
        await sleep(FRAG_DELAY_MS);
        await r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FRAG });
    });
    await page.route('**/b876/boot-frag.html', (r) => {
        bootGets++;
        r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<p>boot</p>' });
    });
    await page.route('**/b876/save', (r) => {
        const q = r.request();
        saves.push({ type: q.resourceType(), xrw: q.headers()['x-requested-with'] || null });
        r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: '{"ok":true}' });
    });

    await page.goto(BASE + '/b876');
    await page.waitForFunction(() => !!(window.gina && window.gina.isFrameworkLoaded === true
        && window.gina.hasPopinHandler === true && window.gina.validator), null, { timeout: 15000 });
    await sleep(500);

    // Popin B, then a counter on the trigger's own `popin.click.*` event (target phase): every
    // proxy that claims the trigger dispatches that event on it once.
    const ids = await page.evaluate(() => new Promise((resolve) => {
        setTimeout(() => resolve(null), 8000);
        window.require(['gina/popin'], function (Popin) {
            var p = new Popin({ name: 'b876', validator: window.gina.validator });
            p.on('ready', function () {
                var t = document.querySelector('[data-probe="t"]');
                window.__b876Dispatches = 0;
                t.addEventListener(t.id, function () { window.__b876Dispatches++; });
                resolve({ a: window.gina.popin.id, b: p.id, trigger: t.id });
            });
        });
    }));

    await page.click('[data-probe="t"]');
    await sleep(FRAG_DELAY_MS + SETTLE_MS);

    const opened = await page.evaluate(() => {
        var f = window.gina.validator.$forms && window.gina.validator.$forms['pform'];
        var inPopin = document.querySelector('dialog[open] #pform');
        return {
            dispatches: window.__b876Dispatches,
            openDialogs: document.querySelectorAll('dialog[open]').length,
            formsInOpenPopin: document.querySelectorAll('dialog[open] #pform').length,
            // the form the validator bound is the one the user sees (a re-injection leaves it detached)
            boundFormIsShown: !!(f && f.target && inPopin && f.target === inPopin && f.target.isConnected)
        };
    });

    await page.click('dialog[open] #pform-submit');
    await sleep(SETTLE_MS);

    return Object.assign({
        ids: ids, routeHits: routeHits, gets: gets, bootGets: bootGets, saves: saves,
        path: new URL(page.url()).pathname, errors: errors
    }, opened);
}

/**
 * Scene control: ids read from the page. `prefixPair` = B's instance id starts with A's and
 * A's id + '-' does not start B's (gp-1 / gp-14); B's trigger carries B's id plus the delimiter.
 *
 * @param {{ a: string, b: string, trigger: string }} ids
 * @returns {{ prefixPair: boolean, triggerOwned: boolean }}
 */
function sceneOf(ids) {
    return {
        prefixPair: ids.b !== ids.a && ids.b.indexOf(ids.a) === 0 && ids.b.indexOf(ids.a + '-') !== 0,
        triggerOwned: ids.trigger.indexOf('popin.click.gina-popin-' + ids.b + '-') === 0
    };
}

function expectBundle(r) {
    if (process.env.B876_PREFIX_BUNDLE) {
        expect(r.routeHits, 'the pre-fix bundle was not served').toBeGreaterThan(0);
    }
}

test.describe('gh#86 / #B876 — a popin claims only its own triggers', () => {

    test('01 prefix-pair ids, <button> trigger: one dispatch, one GET, the bound form submits by XHR', async ({ page }) => {
        const r = await drive(page, { nBoot: 12, tag: 'button' });
        expectBundle(r);
        expect(r.ids, 'popin B registered').not.toBeNull();
        expect(sceneOf(r.ids), 'scene: A\'s id is a prefix of B\'s (' + r.ids.a + ' / ' + r.ids.b + ')')
            .toEqual({ prefixPair: true, triggerOwned: true });

        expect({
            dispatches: r.dispatches, gets: r.gets, bootGets: r.bootGets, openDialogs: r.openDialogs,
            formsInOpenPopin: r.formsInOpenPopin, boundFormIsShown: r.boundFormIsShown,
            saves: r.saves, path: r.path, errors: r.errors
        }).toEqual({
            dispatches: 1, gets: 1, bootGets: 0, openDialogs: 1,
            formsInOpenPopin: 1, boundFormIsShown: true,
            saves: [{ type: 'xhr', xrw: 'XMLHttpRequest' }], path: '/b876', errors: []
        });
    });

    test('02 prefix-pair ids, <a> trigger: one dispatch (its load count is held at 1 by the #B298 gate either way)', async ({ page }) => {
        const r = await drive(page, { nBoot: 12, tag: 'a' });
        expectBundle(r);
        expect(r.ids, 'popin B registered').not.toBeNull();
        expect(sceneOf(r.ids), 'scene: A\'s id is a prefix of B\'s (' + r.ids.a + ' / ' + r.ids.b + ')')
            .toEqual({ prefixPair: true, triggerOwned: true });

        expect({ dispatches: r.dispatches, gets: r.gets, openDialogs: r.openDialogs, errors: r.errors })
            .toEqual({ dispatches: 1, gets: 1, openDialogs: 1, errors: [] });
    });

    test('03 CONTROL — no prefix pair: one dispatch, one GET, XHR submit (both sides of the fix)', async ({ page }) => {
        const r = await drive(page, { nBoot: 2, tag: 'button' });
        expectBundle(r);
        expect(r.ids, 'popin B registered').not.toBeNull();
        expect(sceneOf(r.ids), 'scene: no prefix pair (' + r.ids.a + ' / ' + r.ids.b + ')')
            .toEqual({ prefixPair: false, triggerOwned: true });

        expect({
            dispatches: r.dispatches, gets: r.gets, bootGets: r.bootGets, openDialogs: r.openDialogs,
            boundFormIsShown: r.boundFormIsShown, saves: r.saves, path: r.path, errors: r.errors
        }).toEqual({
            dispatches: 1, gets: 1, bootGets: 0, openDialogs: 1,
            boundFormIsShown: true, saves: [{ type: 'xhr', xrw: 'XMLHttpRequest' }], path: '/b876', errors: []
        });
    });
});
