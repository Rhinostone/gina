'use strict';

/**
 * Playwright RUNTIME e2e for the validator fix #B920 (the real built gina bundle, real forms, real
 * clicks).
 *
 * A `_case_<driver>` block's conditions are tested one after the other against the driver's value.
 * Inside a matched condition, the branch for a literal rule key stored the value of the field it names
 * (a boolean when that field's own rule says isBoolean) in the variable the next condition's test
 * reads, so a later condition whose `case` equalled that field's value applied although the driver
 * did not match it. Its rules applied: here a radio group it requires refused the submit.
 *
 *   01 #B920 — mode a, note 'nv': the later 'nv' condition does not apply, the click sends
 *                                                                     (RED: refused, `choice` required)
 *   02 #B920 — the same with live check off                           (RED: refused)
 *   03 #B920 — the first condition names a ticked boolean checkbox: the later `true` case does not
 *      apply, the click sends                                         (RED: refused)
 *   04 CONTROL — note holds another value: the click sends
 *   05 CONTROL — a later condition that matches mode a still applies: refused until `choice` is picked
 *
 * Scene: inline pages served by the runtime server (`/x76-page?b64=`) with the later-condition rules
 * whisper (`/js/gina.onload.b920.js`); submits go to /ac-sink, which answers {}.
 *
 * Pre-fix arm: `GINA_B920_PREFIX_BUNDLE=<path to a pre-fix gina.min.js>` serves that bundle to the
 * page instead of the working-tree dist.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// The subtract arm: the pre-fix bundle to serve, and a hit counter proving it was served.
const PREFIX_BUNDLE = process.env.GINA_B920_PREFIX_BUNDLE ? fs.readFileSync(process.env.GINA_B920_PREFIX_BUNDLE) : null;

// Same polling kicker as the other x76-page specs: runs onGinaLoaded once the framework is there.
const KICKER = '(function(){var t=0;function k(){try{if(window.gina&&window.gina.config'
    + '&&typeof window.onGinaLoaded===\'function\'&&!window.gina.isFrameworkLoaded){'
    + 'window.onGinaLoaded(window.gina);}}catch(e){}if((!window.gina||!window.gina.isFrameworkLoaded)'
    + '&&t++<100){setTimeout(k,50);}}k();}());';

// the live check validates a typed field 1 s after its last keyup; a radio at once
const LIVE_CHECK_WAIT = 1600;
const LIVE_CHECK_OFF = ' data-gina-form-live-check-enabled="false"';

/**
 * The rule-bound form: `ref`, the radio driver `mode`, the text field `note`, the boolean checkbox
 * `flag` and the radio group `choice`, which has no rule of its own.
 *
 * @param {string} rule - the rule set named by data-gina-form-rule
 * @param {string} note - note's value
 * @param {string} [attrs] - extra attributes for the <form>
 * @returns {string}
 */
function formOf(rule, note, attrs) {
    return '<form id="b920-form-1" method="post" action="/ac-sink" data-gina-form-rule="' + rule + '"' + (attrs || '') + '>'
        + '<input type="text" id="ref-1" name="ref" value="">'
        + '<input type="radio" id="mode-a-1" name="mode" value="a"><input type="radio" id="mode-b-1" name="mode" value="b">'
        + '<input type="text" id="note-1" name="note" value="' + note + '">'
        + '<input type="checkbox" id="flag-1" name="flag">'
        + '<input type="radio" id="choice-c1-1" name="choice" value="c1"><input type="radio" id="choice-c2-1" name="choice" value="c2">'
        + '<button type="submit" id="b920-submit-1">Send</button>'
        + '</form>';
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
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>b920</title><link rel="icon" href="data:,">'
        + '<script src="/js/gina.onload.b920.js"></script><script src="/js/gina.min.js"></script>'
        + '<script>' + KICKER + '</script></head><body>' + body + '</body></html>';
    await page.goto(BASE + 'x76-page?b64=' + Buffer.from(html).toString('base64url'));
    await page.waitForFunction(() => !!(
        window.gina
        && window.gina.isFrameworkLoaded === true
        && window.gina.validator
        && window.gina.validator.$forms
        && window.gina.validator.$forms['b920-form-1']
        && window.gina.validator.$forms['b920-form-1'].binded
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
    await page.click('#b920-submit-1');
    await page.waitForTimeout(LIVE_CHECK_WAIT);
    return run.posts.length - before;
}

/** The error attribute the validator writes on the `choice` group. */
function choiceErrors(page) {
    return page.evaluate(() => document.getElementById('choice-c1-1').getAttribute('data-gina-form-errors'));
}

test.describe('validator case rules — #B920, a later condition is matched against its driver', function () {

    for (const [num, label, attrs] of [['01', 'live check on', ''], ['02', 'live check off', LIVE_CHECK_OFF]]) {
        test(num + ' - #B920: mode a, note \'nv\' (' + label + ') — the later \'nv\' condition does not apply', async ({ page }) => {
            const run = await open(page, formOf('laterform', 'nv', attrs));
            await typeInto(page, '#ref-1', 'x');
            await page.check('#mode-a-1');
            await page.waitForTimeout(LIVE_CHECK_WAIT);
            expect(await clickSends(page, run), 'choice is required only when mode is \'nv\'').toBe(1);
            expect(JSON.parse(run.posts[0])).toEqual({ ref: 'x', mode: 'a', note: 'nv', flag: false });
            // a field the pass found valid keeps an empty attribute; it is never set when no pass touched it
            expect([null, ''], 'no error on choice').toContain(await choiceErrors(page));
            expect(run.errors).toEqual([]);
        });
    }

    test('03 - #B920: the first condition names a ticked boolean checkbox — the later `true` case does not apply', async ({ page }) => {
        const run = await open(page, formOf('laterboolform', 'n'));
        await typeInto(page, '#ref-1', 'x');
        await page.check('#mode-a-1');
        await page.check('#flag-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run), 'the driver is a, not true').toBe(1);
        expect(JSON.parse(run.posts[0])).toEqual({ ref: 'x', mode: 'a', note: 'n', flag: true });
        expect(run.errors).toEqual([]);
    });

    test('04 - CONTROL: note holds another value — the click sends', async ({ page }) => {
        const run = await open(page, formOf('laterform', 'other'));
        await typeInto(page, '#ref-1', 'x');
        await page.check('#mode-a-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run)).toBe(1);
        expect(JSON.parse(run.posts[0])).toEqual({ ref: 'x', mode: 'a', note: 'other', flag: false });
        expect(run.errors).toEqual([]);
    });

    test('05 - CONTROL: a later condition that matches mode a still applies — refused until `choice` is picked', async ({ page }) => {
        const run = await open(page, formOf('matchform', 'n'));
        await typeInto(page, '#ref-1', 'x');
        await page.check('#mode-a-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run), 'both conditions match a; the second requires choice').toBe(0);
        expect(await choiceErrors(page)).toBe('isRequired');
        await page.check('#choice-c1-1');
        await page.waitForTimeout(LIVE_CHECK_WAIT);
        expect(await clickSends(page, run), 'picked').toBe(1);
        expect(JSON.parse(run.posts[0]).choice).toBe('c1');
        expect(run.errors).toEqual([]);
    });
});
