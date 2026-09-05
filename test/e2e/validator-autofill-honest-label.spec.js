'use strict';

/**
 * Playwright RUNTIME e2e for #B341 - the honest label for a withheld browser autofill at
 * submit time (the real built gina bundle, the real served stylesheet, real POSTs).
 *
 * Since #B478 a control the browser autofilled but still withholds from script is kept out
 * of the live checks, while the submit collectors stay strict: a click while the value is
 * still withheld fails `isRequired` (correct - the empty credential is never posted) but
 * used to render the PLAIN required label on a control the user can see is filled. The
 * engine now composes that one message from the `isRequiredAutofill` label and marks the
 * control `data-gina-form-autofill-withheld="true"`.
 *
 * Locale-agnostic by construction: no English string is asserted. The plain label is READ
 * off the same page first (the secret, empty and readable, live-checked once), and the honest
 * render is asserted to differ from it and to carry the marker; the marker is the signal.
 *
 * Simulation (same as validator-autofill.spec.js): a native-setter fill, the served keyframe
 * applied through the fixture's `.af-simulate` class (re-armed by toggling the class), and
 * Chrome's withheld state through a patched `Element.prototype.matches` for one control.
 *
 * Arms:
 *   01 honest label      -> the plain label first (readable-empty live check), then withheld
 *                          + gate open + click: the message changes, the marker appears, no
 *                          POST; released + click: marker gone, one POST
 *   02 control           -> the plain path is untouched: readable-empty live check renders
 *                          the plain label with no marker, and a valid form posts once
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';
const ATTR = 'data-gina-form-autofill-withheld';

async function gotoAndBoot(page) {
    await page.goto(BASE + 'autofill');
    await page.waitForFunction(
        () => !!(
            window.gina
            && window.gina.isFrameworkLoaded === true
            && window.gina.validator
            && window.gina.validator.$forms
            && window.gina.validator.$forms['afform']
        ), null, { timeout: 15000 });
    await page.waitForFunction(
        () => document.getElementById('afform-submit').getAttribute('data-gina-form-submit-gated') === 'true',
        null, { timeout: 10000 });
}

/** A browser-shaped fill: native prototype setter, no keystroke, no event. */
async function nativeFill(page, id, value) {
    await page.evaluate(([id, value]) => {
        const el = document.getElementById(id);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
    }, [id, value]);
}

/** Apply the served keyframe through the harness class; toggling re-arms a second fire. */
async function fireKeyframe(page, id) {
    await page.evaluate((id) => {
        const el = document.getElementById(id);
        el.classList.remove('af-simulate');
        void el.offsetWidth; // reflow, so re-adding restarts the animation
        el.classList.add('af-simulate');
    }, id);
}

/** Simulate Chrome's withheld state for one control (`:autofill` matches, value reads ''). */
async function setWithheld(page, id, on) {
    await page.evaluate(([id, on]) => {
        if (!window.__afOrigMatches) { window.__afOrigMatches = Element.prototype.matches; }
        const orig = window.__afOrigMatches;
        Element.prototype.matches = on
            ? function (sel) { if (this.id === id && /autofill/.test(sel)) { return true; } return orig.call(this, sel); }
            : orig;
    }, [id, on]);
}

function messagesOf(page, id) {
    return page.evaluate((id) => {
        const wrap = document.getElementById(id).parentNode;
        return Array.prototype.map.call(wrap.querySelectorAll('.form-item-error-message p'), (p) => p.textContent);
    }, id);
}
function markerOf(page, id) {
    return page.evaluate(([id, attr]) => document.getElementById(id).getAttribute(attr), [id, ATTR]);
}
function gated(page) {
    return page.evaluate(() => document.getElementById('afform-submit').getAttribute('data-gina-form-submit-gated'));
}
function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/af-sink') > -1 && r.method() === 'POST') { posts.push(1); }
    });
    return posts;
}
async function waitOpen(page) {
    await page.waitForFunction(
        () => document.getElementById('afform-submit').getAttribute('data-gina-form-submit-gated') !== 'true',
        null, { timeout: 5000 });
}
async function waitMessage(page, id) {
    await page.waitForFunction(
        (id) => document.getElementById(id).parentNode.querySelector('.form-item-error-message p') !== null,
        id, { timeout: 5000 });
}

test.describe('#B341 - honest label for a withheld autofill at submit', () => {

    test('01 withheld at click: the message changes from the plain label, the marker appears, nothing posts; released: marker gone, one post', async ({ page }) => {
        await gotoAndBoot(page);
        const posts = countPosts(page);

        // the email is valid so that only the secret decides the gate
        await nativeFill(page, 'af-email', 'someone@example.com');
        await fireKeyframe(page, 'af-email');

        // the PLAIN label, read off this very page: the secret, readable and empty, live-checked
        await fireKeyframe(page, 'af-secret');
        await waitMessage(page, 'af-secret');
        const plain = await messagesOf(page, 'af-secret');
        expect(plain.length).toBe(1);
        expect(await markerOf(page, 'af-secret')).toBeNull();
        expect(await gated(page)).toBe('true');

        // now the secret is withheld: the silent pass opens the gate without touching the display
        await setWithheld(page, 'af-secret', true);
        await fireKeyframe(page, 'af-secret');
        await waitOpen(page);
        expect(await markerOf(page, 'af-secret')).toBeNull();

        // the click: strict submit collection -> isRequired fails on the withheld secret -> honest label
        await page.click('#afform-submit');
        await page.waitForFunction(
            ([id, attr]) => document.getElementById(id).getAttribute(attr) === 'true',
            ['af-secret', ATTR], { timeout: 5000 });
        const honest = await messagesOf(page, 'af-secret');
        expect(honest.length).toBe(1);
        expect(honest[0]).not.toBe(plain[0]);
        expect(await markerOf(page, 'af-email')).toBeNull();
        await page.waitForTimeout(400);
        expect(posts.length).toBe(0);

        // released: the next adjudication clears the marker and the error, and the click posts once
        await setWithheld(page, 'af-secret', false);
        await nativeFill(page, 'af-secret', 'hunter2');
        await fireKeyframe(page, 'af-secret');
        await page.waitForFunction(
            ([id, attr]) => document.getElementById(id).getAttribute(attr) === null
                && !/form-item-error/.test(document.getElementById(id).parentNode.className),
            ['af-secret', ATTR], { timeout: 5000 });
        await waitOpen(page);
        await page.click('#afform-submit');
        await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
    });

    test('02 control: the plain path is untouched - no marker on a readable empty field, and a valid form posts once', async ({ page }) => {
        await gotoAndBoot(page);
        const posts = countPosts(page);
        await fireKeyframe(page, 'af-secret');
        await waitMessage(page, 'af-secret');
        expect(await markerOf(page, 'af-secret')).toBeNull();
        expect(await gated(page)).toBe('true');
        await nativeFill(page, 'af-email', 'someone@example.com');
        await nativeFill(page, 'af-secret', 'hunter2');
        await fireKeyframe(page, 'af-email');
        await fireKeyframe(page, 'af-secret');
        await waitOpen(page);
        expect(await markerOf(page, 'af-secret')).toBeNull();
        await page.click('#afform-submit');
        await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
        expect(await markerOf(page, 'af-secret')).toBeNull();
    });
});
