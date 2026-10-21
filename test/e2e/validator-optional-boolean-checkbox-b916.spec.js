'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B916 (the real built gina bundle, real forms, real
 * clicks).
 *
 *  - #B916 — a boolean checkbox posts its live state, `false` when unticked (#49). forEachField
 *    replaced the rule of an unticked checkbox whose rule says `isRequired: false` with
 *    `{ exclude: true }`, so the box was left out of the posted data. The collector already rewrote
 *    a boolean checkbox's rule that lacks `isBoolean` to `isRequired: true`, so the box was left out
 *    only when its rule declares `isBoolean` with `isRequired: false`. The arm now leaves a boolean
 *    checkbox alone; a disabled box and an unticked value-carrying one are still left out.
 *
 *   01 #B916 — `isBoolean` + `isRequired: false`, value "true", unticked: posts false
 *                                                                     (RED: the body lacks it)
 *   02 #B916 — the same with no `value` attribute                     (RED: the body lacks it)
 *   03 #B916 — ticked, then unticked again before the click           (RED: the body lacks it)
 *   04 #B916 — live check off: the submit pass alone                  (RED: the body lacks it)
 *   05 CONTROL — the same box ticked posts true
 *   06 CONTROL — the same box disabled is not posted
 *   07 CONTROL — `isRequired: false` alone, value "true", unticked: posts false
 *   08 CONTROL — a value-carrying box (value "42") left unticked is not posted
 *   09 CONTROL — the value-carrying box ticked posts its value
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the
 * optional-boolean-checkbox rules whisper (`/js/gina.onload.b916.js`); submits go to /ac-sink,
 * which answers {}.
 *
 * Pre-fix arm: `GINA_B916_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist; arms 01–04 must fail there and the controls pass.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B916_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B916_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a checkbox at once
const LIVE_CHECK_WAIT = 1600;

/**
 * One rule-bound form with a submit trigger: a required text field `ref` and the checkbox `agree`.
 *
 * @param {number} n - the suffix every id carries
 * @param {string} rule - the rule set named by data-gina-form-rule
 * @param {string} agreeAttrs - the checkbox's extra attributes (`value`, `disabled`)
 * @param {string} [formAttrs] - extra attributes for the <form>
 * @returns {string}
 */
function formOf(n, rule, agreeAttrs, formAttrs) {
    return '<form id="b916-form-' + n + '" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '"' + (formAttrs || '') + '>'
        + '<input type="text" id="ref-' + n + '" name="ref" value="">'
        + '<input type="checkbox" id="agree-' + n + '" name="agree"' + agreeAttrs + '>'
        + '<button type="submit" id="b916-submit-' + n + '">Send</button>'
        + '</form>';
}

/**
 * Opens a page holding `body` and waits for the forms `ids` to be bound; counts the POSTs to the
 * sink (with their bodies) and the page errors.
 *
 * @param {object} page
 * @param {string} body - the page body (HTML)
 * @param {Array<string>} ids - the form ids to wait for
 * @returns {Promise<{posts: Array<string>, errors: Array<string>}>}
 */
async function open(page, body, ids) {
    let hits = null;
    if (PREFIX_BUNDLE) {
        hits = { n: 0 };
        await page.route('**/js/gina.min.js', (r) => { hits.n++; r.fulfill({ status: 200, contentType: 'application/javascript', body: PREFIX_BUNDLE }); });
    }
    const out = { posts: [], errors: [] };
    page.on('request', (r) => { if (r.url().indexOf('/ac-sink') > -1 && r.method() === 'POST') { out.posts.push(String(r.postData() || '')); } });
    page.on('pageerror', (e) => { out.errors.push(String(e && e.message)); });
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b916</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b916.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction((list) => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && list.every(function (id) { return window.gina.validator.$forms[id] && window.gina.validator.$forms[id].binded; })
    ), ids, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/** Types into a field without leaving it: keyup drives the live check, no blur. */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(LIVE_CHECK_WAIT);
}

/** Clicks form `n`'s trigger and returns how many POSTs that click sent. */
async function clickSends(page, run, n) {
    const before = run.posts.length;
    await page.click('#b916-submit-' + n);
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    return run.posts.length - before;
}

const LIVE_CHECK_OFF = ' data-gina-form-live-check-enabled="false"';

test.describe('validator optional boolean checkbox — #B916', function () {

    // [num, label, rule set, checkbox attributes, form attributes, what happens to the box, posted body]
    for (const [num, label, rule, agreeAttrs, formAttrs, act, body] of [
        ['01', '#B916: `isBoolean` + `isRequired: false`, value "true", unticked: posts false', 'optform', ' value="true"', '', 'none', { ref: 'x', agree: false }],
        ['02', '#B916: the same with no `value` attribute', 'optform', '', '', 'none', { ref: 'x', agree: false }],
        ['03', '#B916: ticked, then unticked again before the click', 'optform', ' value="true"', '', 'tick-untick', { ref: 'x', agree: false }],
        ['04', '#B916: live check off, the submit pass alone', 'optform', ' value="true"', LIVE_CHECK_OFF, 'none', { ref: 'x', agree: false }],
        ['05', 'CONTROL: the same box ticked posts true', 'optform', ' value="true"', '', 'tick', { ref: 'x', agree: true }],
        ['06', 'CONTROL: the same box disabled is not posted', 'optform', ' value="true" disabled', '', 'none', { ref: 'x' }],
        ['07', 'CONTROL: `isRequired: false` alone, value "true", unticked: posts false', 'reqfform', ' value="true"', '', 'none', { ref: 'x', agree: false }],
        ['08', 'CONTROL: a value-carrying box left unticked is not posted', 'reqfform', ' value="42"', '', 'none', { ref: 'x' }],
        ['09', 'CONTROL: the value-carrying box ticked posts its value', 'reqfform', ' value="42"', '', 'tick', { ref: 'x', agree: '42' }]
    ]) {
        test(num + ' - ' + label, async ({ page }) => {
            const run = await open(page, formOf(1, rule, agreeAttrs, formAttrs), ['b916-form-1']);
            await typeInto(page, '#ref-1', 'x');
            if (act === 'tick' || act === 'tick-untick') {
                await page.check('#agree-1');
                await page.waitForTimeout(LIVE_CHECK_WAIT);
            }
            if (act === 'tick-untick') {
                await page.uncheck('#agree-1');
                await page.waitForTimeout(LIVE_CHECK_WAIT);
            }
            expect(await clickSends(page, run, 1)).toBe(1);
            expect(JSON.parse(run.posts[0])).toEqual(body);
            expect(run.errors).toEqual([]);
        });
    }
});
