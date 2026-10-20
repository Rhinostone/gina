'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B919 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A field carrying `data-gina-form-element-group="<id>"` depends on the radio or checkbox with that id
 * (its master): it is enabled, and sent, while the master is checked. Every radio, at bind and on each
 * click, disabled and excluded EVERY grouped field that is not a radio or a checkbox, and re-enabled
 * only its own. So a click on any other radio, or a radio bound after a checked master, left that
 * master's fields out of the posted data; a checkbox master's fields too, and a field whose group
 * names no element. Removing that also needs a disabled checkbox to count as unticked for the fields
 * naming it, or a field naming a radio master and a checkbox under it is sent after the radio is
 * switched away (07, 08).
 *
 *   01 #B919 — master ma checked, then a radio of another group: h1 is still sent  (RED: h1 left out)
 *   02 #B919 — ma checked in the HTML, radios after it: h1 is sent                  (RED)
 *   03 #B919 — three masters in one group, the first checked in the HTML: its fields are sent (RED)
 *   04 #B919 — a checked checkbox master in a form with a radio: its field is sent  (RED)
 *   05 #B919 — tick the checkbox master, then click a radio: its field is still sent (RED)
 *   06 #B919 — a checkbox ticked in the HTML under the checked master: the field naming both is sent (RED)
 *   07 #B919 — tick that checkbox, then check the other master: the field is not sent
 *                                (CONTROL on the pre-fix bundle; RED with the first change alone)
 *   08 #B919 — the other master checked in the HTML, the checkbox ticked: not sent (same as 07)
 *   09 #B919 — a checkbox under an unticked checkbox, ticked in the HTML: the field naming both is
 *      not sent                                                                    (RED: sent)
 *   10 #B919 — untick the outer checkbox: the field naming both is not sent        (RED: sent)
 *   11 #B919 — a field whose group names no element, in a form with a radio: sent as rendered (RED)
 *   12 CONTROL — the last of three masters checked in the HTML: its field is sent
 *   13 CONTROL — click ma, then mb: h1 is not sent
 *   14 CONTROL — a checked checkbox master in a form without radios: its field is sent
 *   15 CONTROL — click the second master: only its field is sent
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the element-group rules
 * whisper (`/js/gina.onload.b919.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B919_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B919_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B919_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a radio at once
const LIVE_CHECK_WAIT = 1600;
// a realistic gap between two clicks
const CLICK_GAP = 450;

const U = '<input type="radio" id="u1-1" name="u" value="u1"><input type="radio" id="u2-1" name="u" value="u2">';

/**
 * The form bodies. `{{<id>}}` becomes ` checked` when `<id>` is listed as checked in the HTML.
 *   reported: masters `action` (#ma-1, #mb-1), h1 under #ma-1, then the radio group `u`
 *   tabs:     masters `tab` (#tab-a-1, #tab-b-1, #tab-c-1); a1 (hidden) + a2 (text), b1, c1 (select)
 *   cbm:      a checkbox master #cbm-1 with a hidden h2; the radio group `u` when `withRadio`
 *   orphan:   a hidden h3 whose group names no element, and the radio group `u`
 *   nested:   a checkbox #doc-1 under master #flow-a-1, amend naming both, fb under #flow-b-1
 *   boxes:    a checkbox #inner-1 under the checkbox #outer-1, ih naming both
 */
const BODIES = {
    reported: '<input type="radio" id="ma-1" name="action" value="A"{{ma-1}}>'
        + '<input type="hidden" id="h1-1" name="h1" value="vh1" data-gina-form-element-group="ma-1">'
        + '<input type="radio" id="mb-1" name="action" value="B">' + U,
    tabs: '<input type="radio" id="tab-a-1" name="tab" value="a"{{tab-a-1}}>'
        + '<input type="hidden" id="a1-1" name="a1" value="va1" data-gina-form-element-group="tab-a-1">'
        + '<input type="text" id="a2-1" name="a2" value="va2" data-gina-form-element-group="tab-a-1">'
        + '<input type="radio" id="tab-b-1" name="tab" value="b"{{tab-b-1}}>'
        + '<input type="hidden" id="b1-1" name="b1" value="vb1" data-gina-form-element-group="tab-b-1">'
        + '<input type="radio" id="tab-c-1" name="tab" value="c"{{tab-c-1}}>'
        + '<select id="c1-1" name="c1" data-gina-form-element-group="tab-c-1"><option value="vc1" selected>c</option></select>',
    cbm: '<input type="checkbox" id="cbm-1" name="cbm" value="yes"{{cbm-1}}>'
        + '<input type="hidden" id="h2-1" name="h2" value="vh2" data-gina-form-element-group="cbm-1">{{U}}',
    orphan: '<input type="hidden" id="h3-1" name="h3" value="vh3" data-gina-form-element-group="no-such-master">' + U,
    nested: '<input type="radio" id="flow-a-1" name="flow" value="a"{{flow-a-1}}>'
        + '<input type="checkbox" id="doc-1" name="doc" value="d1" data-gina-form-element-group="flow-a-1"{{doc-1}}>'
        + '<input type="hidden" id="amend-1" name="amend" value="vam" data-gina-form-element-group="flow-a-1 doc-1">'
        + '<input type="radio" id="flow-b-1" name="flow" value="b"{{flow-b-1}}>'
        + '<input type="hidden" id="fb-1" name="fb" value="vfb" data-gina-form-element-group="flow-b-1">',
    boxes: '<input type="checkbox" id="outer-1" name="outer" value="o"{{outer-1}}>'
        + '<input type="checkbox" id="inner-1" name="inner" value="i" data-gina-form-element-group="outer-1"{{inner-1}}>'
        + '<input type="hidden" id="ih-1" name="ih" value="vih" data-gina-form-element-group="outer-1 inner-1">'
};

/**
 * The rule-bound form around one of BODIES.
 *
 * @param {string} kind - a key of BODIES
 * @param {Array<string>} checked - the ids checked in the HTML
 * @param {boolean} [withRadio] - the `cbm` body only: add the radio group `u`
 * @returns {string}
 */
function formOf(kind, checked, withRadio) {
    const body = BODIES[kind].replace('{{U}}', withRadio ? U : '')
        .replace(/\{\{([a-z0-9-]+)\}\}/g, (m, id) => (checked.indexOf(id) > -1 ? ' checked' : ''));
    return '<form id="b919-form-1" method="post" action="/ac-sink" data-gina-form-rule="groupform">'
        + '<input type="text" id="ref-1" name="ref" value="">' + body
        + '<button type="submit" id="b919-submit-1">Send</button></form>';
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
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b919</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b919.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b919-form-1']
        && window.gina.validator.$forms['b919-form-1'].binded
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
    await page.click('#b919-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(run.posts.length - before, 'the click sends').toBe(1);
    return { body: JSON.parse(run.posts[run.posts.length - 1]), disabled };
}

test.describe('validator element groups — #B919, a field follows only the master it names', function () {

    test('01 - #B919: master ma checked, then a radio of another group — h1 is still sent', async ({ page }) => {
        const run = await open(page, formOf('reported', []));
        const r = await drive(page, run, ['#ma-1', '#u1-1'], ['h1-1']);
        expect(r.disabled).toEqual({ 'h1-1': false });
        expect(r.body).toEqual({ ref: 'x', action: 'A', h1: 'vh1', u: 'u1' });
        expect(run.errors).toEqual([]);
    });

    test('02 - #B919: ma checked in the HTML, radios after it — h1 is sent', async ({ page }) => {
        const run = await open(page, formOf('reported', ['ma-1']));
        const r = await drive(page, run, [], ['h1-1']);
        expect(r.disabled).toEqual({ 'h1-1': false });
        expect(r.body).toEqual({ ref: 'x', action: 'A', h1: 'vh1' });
        expect(run.errors).toEqual([]);
    });

    test('03 - #B919: the first of three masters checked in the HTML — its fields are sent, the others not', async ({ page }) => {
        const run = await open(page, formOf('tabs', ['tab-a-1']));
        const r = await drive(page, run, [], ['a1-1', 'a2-1', 'b1-1', 'c1-1']);
        expect(r.disabled).toEqual({ 'a1-1': false, 'a2-1': false, 'b1-1': true, 'c1-1': true });
        expect(r.body).toEqual({ ref: 'x', tab: 'a', a1: 'va1', a2: 'va2' });
        expect(run.errors).toEqual([]);
    });

    test('04 - #B919: a checked checkbox master in a form with a radio — its field is sent', async ({ page }) => {
        const run = await open(page, formOf('cbm', ['cbm-1'], true));
        const r = await drive(page, run, [], ['h2-1']);
        expect(r.disabled).toEqual({ 'h2-1': false });
        expect(r.body).toEqual({ ref: 'x', cbm: 'yes', h2: 'vh2' });
        expect(run.errors).toEqual([]);
    });

    test('05 - #B919: tick the checkbox master, then click a radio — its field is still sent', async ({ page }) => {
        const run = await open(page, formOf('cbm', [], true));
        const r = await drive(page, run, ['#cbm-1', '#u1-1'], ['h2-1']);
        expect(r.disabled).toEqual({ 'h2-1': false });
        expect(r.body).toEqual({ ref: 'x', cbm: 'yes', h2: 'vh2', u: 'u1' });
        expect(run.errors).toEqual([]);
    });

    test('06 - #B919: a checkbox ticked in the HTML under the checked master — the field naming both is sent', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow-a-1', 'doc-1']));
        const r = await drive(page, run, [], ['doc-1', 'amend-1', 'fb-1']);
        expect(r.disabled).toEqual({ 'doc-1': false, 'amend-1': false, 'fb-1': true });
        expect(r.body).toEqual({ ref: 'x', flow: 'a', doc: 'd1', amend: 'vam' });
        expect(run.errors).toEqual([]);
    });

    test('07 - #B919: tick that checkbox, then check the other master — the field naming both is not sent', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow-a-1']));
        const r = await drive(page, run, ['#doc-1', '#flow-b-1'], ['doc-1', 'amend-1', 'fb-1']);
        expect(r.disabled).toEqual({ 'doc-1': true, 'amend-1': true, 'fb-1': false });
        expect(r.body).toEqual({ ref: 'x', flow: 'b', fb: 'vfb' });
        expect(run.errors).toEqual([]);
    });

    test('08 - #B919: the other master checked in the HTML, the checkbox ticked — the field naming both is not sent', async ({ page }) => {
        const run = await open(page, formOf('nested', ['flow-b-1', 'doc-1']));
        const r = await drive(page, run, [], ['doc-1', 'amend-1', 'fb-1']);
        expect(r.disabled).toEqual({ 'doc-1': true, 'amend-1': true, 'fb-1': false });
        expect(r.body).toEqual({ ref: 'x', flow: 'b', fb: 'vfb' });
        expect(run.errors).toEqual([]);
    });

    test('09 - #B919: a checkbox under an unticked checkbox, ticked in the HTML — the field naming both is not sent', async ({ page }) => {
        const run = await open(page, formOf('boxes', ['inner-1']));
        const r = await drive(page, run, [], ['inner-1', 'ih-1']);
        expect(r.disabled).toEqual({ 'inner-1': true, 'ih-1': true });
        expect(r.body).toEqual({ ref: 'x' });
        expect(run.errors).toEqual([]);
    });

    test('10 - #B919: untick the outer checkbox — the field naming both is not sent', async ({ page }) => {
        const run = await open(page, formOf('boxes', ['outer-1', 'inner-1']));
        const r = await drive(page, run, ['#outer-1'], ['inner-1', 'ih-1']);
        expect(r.disabled).toEqual({ 'inner-1': true, 'ih-1': true });
        expect(r.body).toEqual({ ref: 'x' });
        expect(run.errors).toEqual([]);
    });

    test('11 - #B919: a field whose group names no element, in a form with a radio — sent as rendered', async ({ page }) => {
        const run = await open(page, formOf('orphan', []));
        const r = await drive(page, run, ['#u1-1'], ['h3-1']);
        expect(r.disabled).toEqual({ 'h3-1': false });
        expect(r.body).toEqual({ ref: 'x', h3: 'vh3', u: 'u1' });
        expect(run.errors).toEqual([]);
    });

    test('12 - CONTROL: the last of three masters checked in the HTML — its field is sent', async ({ page }) => {
        const run = await open(page, formOf('tabs', ['tab-c-1']));
        const r = await drive(page, run, [], ['a1-1', 'a2-1', 'b1-1', 'c1-1']);
        expect(r.disabled).toEqual({ 'a1-1': true, 'a2-1': true, 'b1-1': true, 'c1-1': false });
        expect(r.body).toEqual({ ref: 'x', tab: 'c', c1: 'vc1' });
        expect(run.errors).toEqual([]);
    });

    test('13 - CONTROL: click ma, then mb — h1 is not sent', async ({ page }) => {
        const run = await open(page, formOf('reported', []));
        const r = await drive(page, run, ['#ma-1', '#mb-1'], ['h1-1']);
        expect(r.disabled).toEqual({ 'h1-1': true });
        expect(r.body).toEqual({ ref: 'x', action: 'B' });
        expect(run.errors).toEqual([]);
    });

    test('14 - CONTROL: a checked checkbox master in a form without radios — its field is sent', async ({ page }) => {
        const run = await open(page, formOf('cbm', ['cbm-1'], false));
        const r = await drive(page, run, [], ['h2-1']);
        expect(r.disabled).toEqual({ 'h2-1': false });
        expect(r.body).toEqual({ ref: 'x', cbm: 'yes', h2: 'vh2' });
        expect(run.errors).toEqual([]);
    });

    test('15 - CONTROL: click the second master — only its field is sent', async ({ page }) => {
        const run = await open(page, formOf('tabs', []));
        const r = await drive(page, run, ['#tab-b-1'], ['a1-1', 'a2-1', 'b1-1', 'c1-1']);
        expect(r.disabled).toEqual({ 'a1-1': true, 'a2-1': true, 'b1-1': false, 'c1-1': true });
        expect(r.body).toEqual({ ref: 'x', tab: 'b', b1: 'vb1' });
        expect(run.errors).toEqual([]);
    });
});
