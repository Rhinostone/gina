'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B923 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A field carrying `data-gina-form-element-group` lists, separated by spaces, the ids of the radios
 * and checkboxes it depends on (its masters), and is enabled, and sent, while they are checked. Each
 * id was looked for anywhere in the list, so an id found inside a longer one matched too: the radio
 * `opt` drove the fields of `opt-2`, the checkbox `cb-1` those of `cb-10`, the checkbox `doc` those of
 * `doc-2`. Each id is now matched as a whole entry of the list.
 *
 *   01 #B923 — opt-2 checked in the HTML, then the radio opt: x2 is sent              (RED: x2 left out)
 *   02 #B923 — two radio groups, click opt only: x1 is sent, x2 is not              (RED: x2 sent)
 *   03 #B923 — checkbox masters, cb-10 ticked in the HTML: k10 is sent (the bind-time loop)
 *                                                                                    (RED: k10 left out)
 *   04 #B923 — both unticked, tick cb-1: k1 is sent, k10 is not                     (RED: k10 sent)
 *   05 #B923 — flow checked, doc-2 ticked in the HTML, doc unticked: d2 is sent      (RED: d2 left out)
 *   06 #B923 — flow checked, tick doc: d1 is sent, d2 is not                        (RED: d2 sent)
 *   07 CONTROL — two radio groups, click opt-2 only: x2 is sent
 *   08 CONTROL — tick cb-10 only: k10 is sent
 *   09 CONTROL — flow checked, tick doc-2: d2, which names flow and doc-2, is sent
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the element-group rules
 * whisper of #B919 (`/js/gina.onload.b919.js`, rule set `groupform`); submits go to /ac-sink, which
 * answers {}. The ids are left without a suffix: `opt` inside `opt-2` is the case under test.
 *
 * Pre-fix arm: `GINA_B923_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B923_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B923_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a radio at once
const LIVE_CHECK_WAIT = 1600;
// a realistic gap between two clicks
const CLICK_GAP = 450;

/**
 * The form bodies. `{{<id>}}` becomes ` checked` when `<id>` is listed as checked in the HTML.
 *   radios:  radios #opt-2 then #opt in one group `o`, with x2 (group opt-2) and x1 (group opt)
 *   groups:  the same two radios in two groups, `o2` and `o1`
 *   boxes:   checkbox masters #cb-10 then #cb-1, with k10 (group cb-10) and k1 (group cb-1)
 *   nested:  checkboxes #doc-2 then #doc under the radio #flow; d2 names "flow doc-2", d1 "flow doc"
 */
const BODIES = {
    radios: '<input type="radio" id="opt-2" name="o" value="2"{{opt-2}}>'
        + '<input type="hidden" id="x2" name="x2" value="vx2" data-gina-form-element-group="opt-2">'
        + '<input type="radio" id="opt" name="o" value="1"{{opt}}>'
        + '<input type="hidden" id="x1" name="x1" value="vx1" data-gina-form-element-group="opt">',
    groups: '<input type="radio" id="opt-2" name="o2" value="2">'
        + '<input type="hidden" id="x2" name="x2" value="vx2" data-gina-form-element-group="opt-2">'
        + '<input type="radio" id="opt" name="o1" value="1">'
        + '<input type="hidden" id="x1" name="x1" value="vx1" data-gina-form-element-group="opt">',
    boxes: '<input type="checkbox" id="cb-10" name="c10" value="v10"{{cb-10}}>'
        + '<input type="hidden" id="k10" name="k10" value="vk10" data-gina-form-element-group="cb-10">'
        + '<input type="checkbox" id="cb-1" name="c1" value="v1"{{cb-1}}>'
        + '<input type="hidden" id="k1" name="k1" value="vk1" data-gina-form-element-group="cb-1">',
    nested: '<input type="radio" id="flow" name="fl" value="f"{{flow}}>'
        + '<input type="radio" id="other" name="fl" value="o">'
        + '<input type="checkbox" id="doc-2" name="doc2" value="d2v" data-gina-form-element-group="flow"{{doc-2}}>'
        + '<input type="hidden" id="d2" name="d2" value="vd2" data-gina-form-element-group="flow doc-2">'
        + '<input type="checkbox" id="doc" name="doc" value="d1v" data-gina-form-element-group="flow"{{doc}}>'
        + '<input type="hidden" id="d1" name="d1" value="vd1" data-gina-form-element-group="flow doc">'
};

/**
 * The rule-bound form around one of BODIES.
 *
 * @param {string} kind - a key of BODIES
 * @param {Array<string>} checked - the ids checked in the HTML
 * @returns {string}
 */
function formOf(kind, checked) {
    const body = BODIES[kind].replace(/\{\{([a-z0-9-]+)\}\}/g, (m, id) => (checked.indexOf(id) > -1 ? ' checked' : ''));
    return '<form id="b923-form-1" method="post" action="/ac-sink" data-gina-form-rule="groupform">'
        + '<input type="text" id="ref-1" name="ref" value="">' + body
        + '<button type="submit" id="b923-submit-1">Send</button></form>';
}

/**
 * Opens a page holding `body` and waits for the form to be bound; counts the POSTs to the sink (with
 * their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} body - the page body (HTML)
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, body) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b923</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b919.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b923-form-1']
        && window.gina.validator.$forms['b923-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Fills `ref`, clicks each selector with a realistic gap, sends, and returns the posted body
 * (parsed) and the `disabled` state of the listed fields just before the click on Send.
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {Array<string>} clicks - selectors, in order
 * @param {Array<string>} fields - the ids whose `disabled` state is read
 * @returns {Promise<{body: (object|null), disabled: object}>}
 */
async function drive(page, run, clicks, fields) {
    await page.fill('#ref-1', 'x');
    await page.waitForTimeout(CLICK_GAP);
    for (const sel of clicks) {
        await page.click(sel);
        await page.waitForTimeout(CLICK_GAP);
    }
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const disabled = await page.evaluate((ids) => {
        const o = {};
        ids.forEach((id) => { o[id] = document.getElementById(id).disabled; });
        return o;
    }, fields);
    const before = run.posts.length;
    await page.click('#b923-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(run.posts.length - before, 'the click sends').toBe(1);
    return { body: JSON.parse(run.posts[run.posts.length - 1]), disabled };
}

test.describe('validator element groups — #B923, an id is matched whole, never inside a longer one', function () {

    test('01 - #B923: opt-2 checked in the HTML, then the radio opt — x2 is sent', async ({ page }) => {
        const run = await open(page, formOf('radios', ['opt-2']));
        const r = await drive(page, run, [], ['x2', 'x1']);
        expect(r.disabled).toEqual({ x2: false, x1: true });
        expect(r.body).toEqual({ ref: 'x', o: '2', x2: 'vx2' });
        expect(run.errors).toEqual([]);
    });

    test('02 - #B923: two radio groups, click opt only — x1 is sent, x2 is not', async ({ page }) => {
        const run = await open(page, formOf('groups', []));
        const r = await drive(page, run, ['#opt'], ['x2', 'x1']);
        expect(r.disabled).toEqual({ x2: true, x1: false });
        expect(r.body).toEqual({ ref: 'x', o1: '1', x1: 'vx1' });
        expect(run.errors).toEqual([]);
    });

    test('03 - #B923: checkbox masters, cb-10 ticked in the HTML — k10 is sent', async ({ page }) => {
        const run = await open(page, formOf('boxes', ['cb-10']));
        const r = await drive(page, run, [], ['k10', 'k1']);
        expect(r.disabled).toEqual({ k10: false, k1: true });
        expect(r.body).toEqual({ ref: 'x', c10: 'v10', k10: 'vk10' });
        expect(run.errors).toEqual([]);
    });

    test('04 - #B923: both unticked, tick cb-1 — k1 is sent, k10 is not', async ({ page }) => {
        const run = await open(page, formOf('boxes', []));
        const r = await drive(page, run, ['#cb-1'], ['k10', 'k1']);
        expect(r.disabled).toEqual({ k10: true, k1: false });
        expect(r.body).toEqual({ ref: 'x', c1: 'v1', k1: 'vk1' });
        expect(run.errors).toEqual([]);
    });

    test('05 - #B923: flow checked, doc-2 ticked in the HTML, doc unticked — d2 is sent', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow', 'doc-2']));
        const r = await drive(page, run, [], ['d2', 'd1']);
        expect(r.disabled).toEqual({ d2: false, d1: true });
        expect(r.body).toEqual({ ref: 'x', fl: 'f', doc2: 'd2v', d2: 'vd2' });
        expect(run.errors).toEqual([]);
    });

    test('06 - #B923: flow checked, tick doc — d1 is sent, d2 is not', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow']));
        const r = await drive(page, run, ['#doc'], ['d2', 'd1']);
        expect(r.disabled).toEqual({ d2: true, d1: false });
        expect(r.body).toEqual({ ref: 'x', fl: 'f', doc: 'd1v', d1: 'vd1' });
        expect(run.errors).toEqual([]);
    });

    test('07 - CONTROL: two radio groups, click opt-2 only — x2 is sent', async ({ page }) => {
        const run = await open(page, formOf('groups', []));
        const r = await drive(page, run, ['#opt-2'], ['x2', 'x1']);
        expect(r.disabled).toEqual({ x2: false, x1: true });
        expect(r.body).toEqual({ ref: 'x', o2: '2', x2: 'vx2' });
        expect(run.errors).toEqual([]);
    });

    test('08 - CONTROL: tick cb-10 only — k10 is sent', async ({ page }) => {
        const run = await open(page, formOf('boxes', []));
        const r = await drive(page, run, ['#cb-10'], ['k10', 'k1']);
        expect(r.disabled).toEqual({ k10: false, k1: true });
        expect(r.body).toEqual({ ref: 'x', c10: 'v10', k10: 'vk10' });
        expect(run.errors).toEqual([]);
    });

    test('09 - CONTROL: flow checked, tick doc-2 — d2, which names flow and doc-2, is sent', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow']));
        const r = await drive(page, run, ['#doc-2'], ['d2', 'd1']);
        expect(r.disabled).toEqual({ d2: false, d1: true });
        expect(r.body).toEqual({ ref: 'x', fl: 'f', doc2: 'd2v', d2: 'vd2' });
        expect(run.errors).toEqual([]);
    });
});
