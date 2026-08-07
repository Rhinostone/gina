'use strict';

/**
 * Playwright RUNTIME e2e for #B294 — a submit trigger whose NODE is replaced after
 * binding must keep working (the real built gina bundle, a real click, a real POST).
 *
 * The defect: submit binding is TWO-STAGE and only the first stage is delegated.
 *   1. the native `click` proxy is registered on the FORM (main.js:8090, under the
 *      ":8083 Form-level proxies" comment), so it survives any re-render;
 *   2. the actual work hangs off a per-NODE custom `submit.<triggerId>` event, whose
 *      only listener `bindSubmitEl` attaches to that specific node (main.js:8231).
 *
 * `gina.events` is a NAME -> id-STRING registry (utils/events.js:42), so the
 * `submit.<id>` key outlives the node. After `cloneNode(true)` + `replaceChild` — the
 * shape an AJAX or popin re-render produces — the dispatch gate at :8037 therefore
 * still passes: `cancelEvent` suppresses the native submit and `triggerEvent` fires at
 * the clone, while the listener sits on the detached original. Nobody answers, and the
 * form does not even fall back to a native submit. Measured pre-existing: identical on
 * published 0.6.3, so it is not a 0.6.4 regression.
 *
 * Nothing self-heals: `bindForm` is entered only under `if (!$form.binded)` (:585) and
 * latches `binded = true` (:8580), cleared only by `unbindForm` (:6169). There is no
 * MutationObserver and no isConnected check anywhere in the bind/dispatch path.
 *
 * Fix: mark the bound node with a JS EXPANDO (measured: `cloneNode(true)` copies
 * `data-*` attributes but NOT expandos — which is exactly why the inherited
 * `dataset.ginaFormSubmitTriggerFor` was a red herring for this bug), and re-bind the
 * live node at dispatch time when the marker is absent. Chosen over delegating the
 * custom event to the form because that variant was measured to retain the
 * `gina.events` key past `unbind`, which would have required editing `unbindForm`'s
 * removal loop — six guard variants all keyed on `gina.events[name] == element.id`.
 *
 * Arms (one variable each, every one a control for the others):
 *   01 node replaced once   -> must SEND     (the regression arm; RED before the fix)
 *   02 node untouched       -> must SEND     (positive control: the scene can send)
 *   03 node replaced twice  -> must SEND     (the re-bind must not wedge on its marker)
 *   04 replaced + INVALID   -> must NOT send (the re-bind must not bypass validation)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** Navigate to the FACE harness and wait for the validator to have bound #parent. */
async function gotoFaceAndBoot(page) {
    await page.goto(BASE + 'face');
    await page.waitForFunction(() => !!customElements.get('x-agree'), null, { timeout: 15000 });
    await page.waitForFunction(
        () => !!(
            window.gina
            && window.gina.isFrameworkLoaded === true
            && window.gina.validator
            && window.gina.validator.$forms
            && window.gina.validator.$forms['parent']
        ), null, { timeout: 15000 });
}

/** Satisfy the FACE so the form is genuinely valid, and wait for the marker to clear. */
async function makeValid(page) {
    await page.click('#parent x-agree button');
    await page.waitForFunction(() => {
        const b = document.getElementById('parent-submit');
        return b && b.getAttribute('data-gina-form-submit-gated') !== 'true';
    }, null, { timeout: 10000 });
}

/** The AJAX / popin re-render shape: same id, same markup, different node. */
async function replaceTriggerNode(page, times) {
    for (let i = 0; i < times; i++) {
        await page.evaluate(() => {
            const old = document.getElementById('parent-submit');
            old.parentNode.replaceChild(old.cloneNode(true), old);
        });
        await page.waitForTimeout(200);
    }
    // the replacement must really have happened, or every arm below is vacuous
    const isFresh = await page.evaluate(() => {
        const b = document.getElementById('parent-submit');
        return !!b && b.isConnected;
    });
    expect(isFresh, 'the replaced trigger must be present and connected').toBe(true);
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(1); }
    });
    return posts;
}

test.describe('#B294 — a replaced submit trigger node keeps working', function () {

    test('01 - a trigger whose node was replaced still sends (the regression arm)', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);
        await replaceTriggerNode(page, 1);

        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 'a replaced trigger must still reach send()').toBeGreaterThan(0);
    });

    test('02 - positive control: an untouched trigger sends', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);

        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 'the node replacement is the only variable vs 01').toBeGreaterThan(0);
    });

    test('03 - replaced twice still sends (the re-bind must not wedge)', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);
        await replaceTriggerNode(page, 2);

        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 'a second replacement must re-bind too').toBeGreaterThan(0);
    });

    test('04 - a replaced trigger on an INVALID form still does not send', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        // the FACE is deliberately NOT engaged, so the form is invalid
        await replaceTriggerNode(page, 1);

        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 're-binding must not bypass validation').toBe(0);
    });
});
