'use strict';

/**
 * Playwright RUNTIME e2e for #B293 — a consumer double-submit guard must not kill the
 * submit (the real built gina bundle, real pointer clicks, real POST).
 *
 * 0.6.4's #B246 gate refuses a click when `isTriggerDisabled($el)` is true, and that
 * predicate accepted the NATIVE `disabled` attribute as well as gina's own
 * `aria-disabled` marker. The near-universal double-submit guard — a click listener on
 * the submit button that sets `disabled` immediately — runs first, synchronously, inside
 * the very click being handled (it is bound to the button; gina's proxy is delegated on
 * the form). By the time the proxy reached the gate, `getAttribute('disabled')` was
 * "disabled", so the click was cancelled, `send()` never ran, and the consumer's own
 * handler cleared the attribute again — leaving nothing marked, a normal-looking button,
 * and EVERY click dead. Forms shipped on 0.6.3 broke silently on 0.6.4.
 *
 * Fix: the native attribute counts only where `disabled` is NOT a real IDL property.
 * On a genuine form control the browser suppresses the click entirely (measured: a
 * natively-disabled <button> delivers no click to JS at all), so the only way that arm
 * could fire there was a listener setting it DURING the dispatch — precisely the guard.
 * On an <a> / custom element the browser enforces nothing, so the attribute still counts.
 *
 * WHY THIS LIVES IN test/e2e AND NOT test/core: the defect is an ordering interaction
 * between a consumer's own bubble-phase listener and gina's delegated proxy, observable
 * only when the real bundle handles a real click. `validator-submit-trigger-state.test.js`
 * covers the same gate with REPLICAS and was green throughout the regression — including
 * two tests named as controls for the working case. A replica cannot catch this.
 *
 * Arms (one variable each, every one a control for the others):
 *   01 guard + gina        -> must SEND (the regression arm; RED before the fix)
 *   02 guard neutralised   -> must SEND (subtract control: proves the guard is the variable)
 *   03 invalid form        -> must NOT send (proves #B246's intent survives the fix)
 *   04 no guard, valid     -> must SEND (positive control: the instrument can see a send)
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

/** Satisfy the FACE so the form is genuinely valid, and wait for gina's marker to clear. */
async function makeValid(page) {
    await page.click('#parent x-agree button');
    await page.waitForFunction(() => {
        const b = document.getElementById('parent-submit');
        return b && b.getAttribute('aria-disabled') !== 'true';
    }, null, { timeout: 10000 });
}

/** The consumer double-submit guard: native `disabled`, set inside its own click listener. */
async function installGuard(page) {
    await page.evaluate(() => {
        const b = document.getElementById('parent-submit');
        b.addEventListener('click', function () {
            this.setAttribute('disabled', 'disabled');
            // a real guard releases on completion/error; the button then looks normal again
            setTimeout(() => this.removeAttribute('disabled'), 250);
        });
    });
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(1); }
    });
    return posts;
}

test.describe('#B293 — a consumer double-submit guard must not kill the submit', function () {

    test('01 - a guarded click still sends (the regression arm)', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);
        await installGuard(page);

        // the guard sets native `disabled` mid-dispatch; nothing is marked beforehand
        const before = await page.evaluate(() => {
            const b = document.getElementById('parent-submit');
            return { aria: b.getAttribute('aria-disabled'), disabled: b.getAttribute('disabled') };
        });
        expect(before.aria, 'no gina marker before the click').toBeNull();
        expect(before.disabled, 'no native disabled before the click').toBeNull();

        await page.click('#parent-submit');
        await page.waitForTimeout(900);
        expect(posts.length, 'a guarded click must reach send()').toBeGreaterThan(0);
    });

    test('02 - subtract control: without the guard it sends too', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);

        await page.click('#parent-submit');
        await page.waitForTimeout(900);
        expect(posts.length, 'the guard is the only variable between 01 and 02').toBeGreaterThan(0);
    });

    test('03 - #B246 intent survives: an invalid form still does not send', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);

        // the FACE is deliberately NOT engaged, so gina marks the trigger
        const aria = await page.evaluate(() =>
            document.getElementById('parent-submit').getAttribute('aria-disabled'));
        expect(aria, 'gina marks an invalid form aria-disabled').toBe('true');

        await page.click('#parent-submit', { force: true });   // aria-disabled fails actionability
        await page.waitForTimeout(900);
        expect(posts.length, 'the aria-disabled arm must still gate an invalid form').toBe(0);
    });

    test('04 - positive control: the instrument can observe a send', async ({ page }) => {
        const posts = countPosts(page);
        await gotoFaceAndBoot(page);
        await makeValid(page);

        await page.evaluate(() => window.gina.validator.$forms['parent'].submit());
        await page.waitForTimeout(900);
        expect(posts.length, 'a known-good submit must be visible to the counter').toBeGreaterThan(0);
    });
});
