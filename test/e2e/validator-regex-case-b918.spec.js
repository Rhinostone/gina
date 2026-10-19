'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B918 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A `_case_<driver>` condition whose `case` is written `/pattern/flags` applied nothing: the validator
 * compared that string with the driver's value and never matched it, so a group the condition
 * requires was not refused and a field it excludes was posted. The case is now read as a regular
 * expression and tested against the driver's value.
 *
 *   01 #B918 — mode a: '/^(A|B)$/i' requires g1, refused until it is picked
 *                                                     (RED: the click sends without g1)
 *   02 #B918 — the same with live check off           (RED: the click sends)
 *   03 #B918 — mode b, g1 picked: the body leaves x out (the condition excludes it) and has no g3
 *      (named by a regex that never matches)          (RED: x is posted)
 *   04 #B918 — a character class, '/^[ab]$/', matches a: refused until g1 is picked
 *                                                     (RED: the click sends)
 *   05 #B918 — the regex-case driver is not the last `_case_` block: refused until g1 is picked
 *                                                     (RED: the click sends)
 *   06 CONTROL — mode c: the plain 'c' condition requires g2; g1 is not required and x is posted
 *   07 CONTROL — the plain-string rule set: mode a is refused until g1 is picked, and x is left out
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the regex-case rules
 * whisper (`/js/gina.onload.b918.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B918_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B918_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B918_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a radio at once
const LIVE_CHECK_WAIT = 1600;
const LIVE_CHECK_OFF = ' data-gina-form-live-check-enabled="false"';

const FIELDS = '<input type="text" id="ref-1" name="ref" value="">'
    + '<input type="radio" id="mode-a-1" name="mode" value="a"><input type="radio" id="mode-b-1" name="mode" value="b">'
    + '<input type="radio" id="mode-c-1" name="mode" value="c">'
    + '<input type="radio" id="g1-v1-1" name="g1" value="v1"><input type="radio" id="g1-v2-1" name="g1" value="v2">'
    + '<input type="radio" id="g2-w1-1" name="g2" value="w1"><input type="radio" id="g2-w2-1" name="g2" value="w2">'
    + '<input type="radio" id="g3-z1-1" name="g3" value="z1">'
    + '<input type="text" id="x-1" name="x" value="xv">';

/**
 * The rule-bound form.
 *
 * @param {string} rule - the rule set named by data-gina-form-rule
 * @param {string} [attrs] - extra attributes for the <form>
 * @returns {string}
 */
function formOf(rule, attrs) {
    return '<form id="b918-form-1" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '"' + (attrs || '') + '>'
        + FIELDS + '<button type="submit" id="b918-submit-1">Send</button></form>';
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
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b918</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b918.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b918-form-1']
        && window.gina.validator.$forms['b918-form-1'].binded
    ), null, { timeout: 15000 });
    if (hits) { expect(hits.n, 'the pre-fix bundle was served').toBeGreaterThan(0); }
    return out;
}

/** Types into a field without leaving it: keyup drives the live check, no blur. */
async function typeInto(page, sel, text) {
    await page.focus(sel);
    await page.keyboard.type(text, { delay: 30 });
    await page.waitForTimeout(LIVE_CHECK_WAIT);
}

/** Clicks the trigger and returns how many POSTs that click sent. */
async function clickSends(page, run) {
    const before = run.posts.length;
    await page.click('#b918-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    return run.posts.length - before;
}

/** The error attribute the validator writes on a group's first member. */
function errorsOn(page, id) {
    return page.evaluate((id) => document.getElementById(id).getAttribute('data-gina-form-errors'), id);
}

/**
 * Picks `mode`, clicks once (refused, with isRequired on g1), picks g1 and clicks again (sent).
 *
 * @param {object} page
 * @param {object} run
 * @param {string} mode - a, b or c
 * @returns {Promise<object>} the posted body
 */
async function refusedUntilG1(page, run, mode) {
    await typeInto(page, '#ref-1', 'x');
    await page.check('#mode-' + mode + '-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(await clickSends(page, run), 'the condition requires g1, which is unpicked').toBe(0);
    expect(await errorsOn(page, 'g1-v1-1'), 'g1 carries its error').toBe('isRequired');
    await page.check('#g1-v1-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    expect(await clickSends(page, run), 'g1 picked').toBe(1);
    return JSON.parse(run.posts[run.posts.length - 1]);
}

test.describe('validator case rules — #B918, a `/pattern/flags` case is a regular expression', function () {

    for (const [num, label, attrs] of [['01', 'live check on', ''], ['02', 'live check off', LIVE_CHECK_OFF]]) {
        test(num + ' - #B918: mode a (' + label + ') — \'/^(A|B)$/i\' requires g1', async ({ page }) => {
            const run = await open(page, formOf('regexform', attrs));
            const body = await refusedUntilG1(page, run, 'a');
            expect(body).toEqual({ ref: 'x', mode: 'a', g1: 'v1' });
            expect(run.errors).toEqual([]);
        });
    }

    test('03 - #B918: mode b, g1 picked — x is left out and g3 is absent', async ({ page }) => {
        const run = await open(page, formOf('regexform'));
        await typeInto(page, '#ref-1', 'x');
        await page.check('#mode-b-1');
        await page.check('#g1-v2-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run)).toBe(1);
        expect(JSON.parse(run.posts[0]), 'the condition excludes x; /^z$/ never matches').toEqual({ ref: 'x', mode: 'b', g1: 'v2' });
        expect(run.errors).toEqual([]);
    });

    test('04 - #B918: a character class — \'/^[ab]$/\' matches a', async ({ page }) => {
        const run = await open(page, formOf('classform'));
        const body = await refusedUntilG1(page, run, 'a');
        expect(body).toEqual({ ref: 'x', mode: 'a', g1: 'v1', x: 'xv' });
        expect(run.errors).toEqual([]);
    });

    test('05 - #B918: the regex-case driver is not the last `_case_` block', async ({ page }) => {
        const run = await open(page, formOf('nlform'));
        const body = await refusedUntilG1(page, run, 'a');
        expect(body).toEqual({ ref: 'x', mode: 'a', g1: 'v1', x: 'xv' });
        expect(run.errors).toEqual([]);
    });

    test('06 - CONTROL: mode c — the plain \'c\' condition requires g2, and x is posted', async ({ page }) => {
        const run = await open(page, formOf('regexform'));
        await typeInto(page, '#ref-1', 'x');
        await page.check('#mode-c-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run), 'g2 is required and unpicked').toBe(0);
        expect(await errorsOn(page, 'g2-w1-1')).toBe('isRequired');
        expect([null, ''], 'g1 is not required at c').toContain(await errorsOn(page, 'g1-v1-1'));
        await page.check('#g2-w1-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run)).toBe(1);
        expect(JSON.parse(run.posts[0])).toEqual({ ref: 'x', mode: 'c', g2: 'w1', x: 'xv' });
        expect(run.errors).toEqual([]);
    });

    test('07 - CONTROL: the plain-string rule set — mode a is refused until g1 is picked, and x is left out', async ({ page }) => {
        const run = await open(page, formOf('plainform'));
        const body = await refusedUntilG1(page, run, 'a');
        expect(body).toEqual({ ref: 'x', mode: 'a', g1: 'v1' });
        expect(run.errors).toEqual([]);
    });
});
