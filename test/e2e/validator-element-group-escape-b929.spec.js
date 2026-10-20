'use strict';

/**
 * validator element groups — a master id holding a regexp character (#B929), driven in Chromium.
 *
 * Pages are built by the spec and served by the runtime server (`/x76-page?b64=`) with the
 * element-group rules whisper of #B919 (`/js/gina.onload.b919.js`, rule set `groupform`); submits
 * go to /ac-sink, which answers {}. The ids hold the characters the old escape left raw: `plan+1`,
 * `opt*2`, `fl(ow`; a field names each.
 *
 * Pre-fix arm: `GINA_B929_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist. On it, `plan+1` drives f1x (its pattern matches `plan1`) and
 * never f1, which is left as rendered and sent whatever the radio's state; `opt*2` drives k0 (`opt2`);
 * `fl(ow` stops the form from binding.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

const PREFIX_BUNDLE = process.env.GINA_B929_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B929_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

const LIVE_CHECK_WAIT = 1600;
const CLICK_GAP = 450;

/**
 * The form bodies. `{{<id>}}` becomes ` checked` when `<id>` is listed as checked in the HTML.
 *   plus:   radios #plan+1 then #plan in one group `p`, with f1 (group plan+1), f0 (group plan) and f1x
 *           (group plan1, disabled in the HTML: what the pattern `plan+1` matched before the change)
 *   star:   checkbox masters #opt*2 then #opt2, with k2 (group opt*2) and k0 (group opt2)
 *   paren:  the checkbox #doc under the radio #fl(ow; d1 names "fl(ow doc"
 *   plain:  radios #plan-1 then #plan, with f1 (group plan-1) and f0 (group plan) — the control
 */
const BODIES = {
    plus: '<input type="radio" id="plan+1" name="p" value="1"{{plan+1}}>'
        + '<input type="hidden" id="f1" name="f1" value="vf1" data-gina-form-element-group="plan+1">'
        + '<input type="radio" id="plan" name="p" value="0"{{plan}}>'
        + '<input type="hidden" id="f0" name="f0" value="vf0" data-gina-form-element-group="plan">'
        + '<input type="hidden" id="f1x" name="f1x" value="vf1x" data-gina-form-element-group="plan1" disabled>',
    star: '<input type="checkbox" id="opt*2" name="o2" value="v2"{{opt*2}}>'
        + '<input type="hidden" id="k2" name="k2" value="vk2" data-gina-form-element-group="opt*2">'
        + '<input type="checkbox" id="opt2" name="o0" value="v0"{{opt2}}>'
        + '<input type="hidden" id="k0" name="k0" value="vk0" data-gina-form-element-group="opt2">',
    paren: '<input type="radio" id="fl(ow" name="fl" value="f"{{fl(ow}}>'
        + '<input type="radio" id="other" name="fl" value="o">'
        + '<input type="checkbox" id="doc" name="doc" value="dv" data-gina-form-element-group="fl(ow"{{doc}}>'
        + '<input type="hidden" id="d1" name="d1" value="vd1" data-gina-form-element-group="fl(ow doc">',
    plain: '<input type="radio" id="plan-1" name="p" value="1"{{plan-1}}>'
        + '<input type="hidden" id="f1" name="f1" value="vf1" data-gina-form-element-group="plan-1">'
        + '<input type="radio" id="plan" name="p" value="0"{{plan}}>'
        + '<input type="hidden" id="f0" name="f0" value="vf0" data-gina-form-element-group="plan">'
};

/**
 * The rule-bound form around one of BODIES.
 *
 * @param {string} kind - a key of BODIES
 * @param {Array<string>} checked - the ids checked in the HTML
 * @returns {string}
 */
function formOf(kind, checked) {
    const body = BODIES[kind].replace(/\{\{([^}]+)\}\}/g, (m, id) => (checked.indexOf(id) > -1 ? ' checked' : ''));
    return '<form id="b929-form-1" method="post" action="/ac-sink" data-gina-form-rule="groupform">'
        + '<input type="text" id="ref-1" name="ref" value="">' + body
        + '<button type="submit" id="b929-submit-1">Send</button></form>';
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
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b929</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b919.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b929-form-1']
        && window.gina.validator.$forms['b929-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/**
 * Fills `ref`, clicks each id with a realistic gap, sends, and returns the posted body (parsed) and
 * the `disabled` state of the listed fields just before the click on Send. Ids are clicked through
 * an attribute selector, since the ids under test are not valid CSS identifiers.
 *
 * @param {object} page
 * @param {{posts: Array<string>}} run
 * @param {Array<string>} clicks - ids, in order
 * @param {Array<string>} fields - the ids whose `disabled` state is read
 * @returns {Promise<{body: (object|null), disabled: object}>}
 */
async function drive(page, run, clicks, fields) {
    await page.fill('#ref-1', 'x');
    await page.waitForTimeout(CLICK_GAP);
    for (const id of clicks) {
        await page.click('[id="' + id + '"]');
        await page.waitForTimeout(CLICK_GAP);
    }
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    const disabled = await page.evaluate((ids) => {
        const o = {};
        ids.forEach((id) => { o[id] = document.getElementById(id).disabled; });
        return o;
    }, fields);
    const before = run.posts.length;
    await page.click('#b929-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(run.posts.length - before, 'the click sends').toBe(1);
    return { body: JSON.parse(run.posts[run.posts.length - 1]), disabled };
}

test.describe('validator element groups — #B929, a master id holding a regexp character is matched literally', function () {

    test('01 - #B929: the radio plan+1 checked in the HTML — f1 is sent; f1x, which names plan1, stays as rendered', async ({ page }) => {
        const run = await open(page, formOf('plus', ['plan+1']));
        const r = await drive(page, run, [], ['f1', 'f0', 'f1x']);
        expect(r.disabled).toEqual({ f1: false, f0: true, f1x: true });
        expect(r.body).toEqual({ ref: 'x', p: '1', f1: 'vf1' });
        expect(run.errors).toEqual([]);
    });

    test('02 - #B929: click the radio plan+1 — f1 is sent; f1x, which names plan1, stays as rendered', async ({ page }) => {
        const run = await open(page, formOf('plus', []));
        const r = await drive(page, run, ['plan+1'], ['f1', 'f0', 'f1x']);
        expect(r.disabled).toEqual({ f1: false, f0: true, f1x: true });
        expect(r.body).toEqual({ ref: 'x', p: '1', f1: 'vf1' });
        expect(run.errors).toEqual([]);
    });

    test('03 - #B929: tick the checkbox master opt*2 — k2 is sent, k0 is not', async ({ page }) => {
        const run = await open(page, formOf('star', []));
        const r = await drive(page, run, ['opt*2'], ['k2', 'k0']);
        expect(r.disabled).toEqual({ k2: false, k0: true });
        expect(r.body).toEqual({ ref: 'x', o2: 'v2', k2: 'vk2' });
        expect(run.errors).toEqual([]);
    });

    test('04 - #B929: the radio fl(ow checked in the HTML and doc ticked — the form binds and d1 is sent', async ({ page }) => {
        const run = await open(page, formOf('paren', ['fl(ow', 'doc']));
        const r = await drive(page, run, [], ['d1']);
        expect(r.disabled).toEqual({ d1: false });
        expect(r.body).toEqual({ ref: 'x', fl: 'f', doc: 'dv', d1: 'vd1' });
        expect(run.errors).toEqual([]);
    });

    test('05 - CONTROL: the radio plan-1 checked in the HTML — f1 is sent, f0 is not, as before', async ({ page }) => {
        const run = await open(page, formOf('plain', ['plan-1']));
        const r = await drive(page, run, [], ['f1', 'f0']);
        expect(r.disabled).toEqual({ f1: false, f0: true });
        expect(r.body).toEqual({ ref: 'x', p: '1', f1: 'vf1' });
        expect(run.errors).toEqual([]);
    });

    test('06 - #B929: click the radio plan — f0 is sent, and f1, which names plan+1, is not', async ({ page }) => {
        const run = await open(page, formOf('plus', []));
        const r = await drive(page, run, ['plan'], ['f1', 'f0']);
        expect(r.disabled).toEqual({ f1: true, f0: false });
        expect(r.body).toEqual({ ref: 'x', p: '0', f0: 'vf0' });
        expect(run.errors).toEqual([]);
    });
});
