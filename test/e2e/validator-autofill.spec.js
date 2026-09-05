'use strict';

/**
 * Playwright RUNTIME e2e for #B478 - the autofill signal and the withheld-value carve-out
 * (the real built gina bundle, the real served stylesheet, real POSTs).
 *
 * A browser autofill lands with no keystroke and - on Chrome - no `input`/`change` until a
 * later gesture, so the live check never re-ran and the submit trigger kept its bind-time
 * gated look on a visibly complete form. The fix: gina.min.css gives every autofilled control
 * a 1ms keyframe named `gina-autofill-start`, and the validator's form-level `animationstart`
 * proxy routes it into the control's own live check (readable value) or into a silent gate
 * re-derivation (value withheld by the browser).
 *
 * WHAT IS SIMULATED, AND WHY: automation cannot put a control into the browser's real
 * `:autofill` state and a fresh profile carries no saved credentials, so
 *  - a fill is performed through the NATIVE prototype value setter (no event, and it bypasses
 *    gina's per-element value observer, which would dispatch `change.<id>` itself and mask
 *    the signal under test);
 *  - the SERVED keyframe is applied through a harness class (`.af-simulate` in the fixture
 *    references the name gina.min.css declares) - the animationstart event, the proxy, the
 *    live check and the gate are all the shipped code;
 *  - Chrome's withheld state (`:-webkit-autofill` matches, `.value` reads '') is simulated by
 *    patching `Element.prototype.matches` for one control.
 *
 * Arms (each a control for the others):
 *   01 baseline            -> gated after bind (the defect's starting state)
 *   02 readable valid fill  -> the gate OPENS (the reported symptom, fixed); still gated
 *                             before the keyframe fires (the defect's shape)
 *   03 readable INVALID fill-> the field renders its error and the gate stays
 *   04 other keyframe name  -> ignored (the proxy is keyed on the name)
 *   05 withheld secret      -> the gate opens WITHOUT an error on the withheld field, and the
 *                             click does NOT post the empty credential (the safety property)
 *   06 released, same click -> posts exactly once (positive control for arm 05's sink)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

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
    // the bind-time silent pass gates the empty form
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

/** Apply the served keyframe (or the control keyframe) through the harness class. */
async function fireKeyframe(page, id, cls) {
    await page.evaluate(([id, cls]) => { document.getElementById(id).classList.add(cls); }, [id, cls || 'af-simulate']);
}

function gated(page) {
    return page.evaluate(() => document.getElementById('afform-submit').getAttribute('data-gina-form-submit-gated'));
}

function wrapperClass(page, id) {
    return page.evaluate((id) => document.getElementById(id).parentNode.className, id);
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

test.describe('#B478 - autofill signal', () => {

    test('01 baseline: an empty rule-bound form boots gated', async ({ page }) => {
        await gotoAndBoot(page);
        expect(await gated(page)).toBe('true');
    });

    test('02 a readable no-keystroke fill opens the gate once the served keyframe fires', async ({ page }) => {
        await gotoAndBoot(page);
        await nativeFill(page, 'af-email', 'someone@example.com');
        await nativeFill(page, 'af-secret', 'hunter2');
        // the defect's shape: values landed, nothing re-ran the live check
        await page.waitForTimeout(400);
        expect(await gated(page)).toBe('true');
        await fireKeyframe(page, 'af-email');
        await fireKeyframe(page, 'af-secret');
        await waitOpen(page);
        expect(await gated(page)).toBeNull();
        expect(await wrapperClass(page, 'af-email')).not.toMatch(/form-item-error/);
    });

    test('03 a readable INVALID fill renders the field error and keeps the gate', async ({ page }) => {
        await gotoAndBoot(page);
        await nativeFill(page, 'af-email', 'not-an-email');
        await nativeFill(page, 'af-secret', 'hunter2');
        await fireKeyframe(page, 'af-email');
        await fireKeyframe(page, 'af-secret');
        await page.waitForFunction(
            () => /form-item-(error|warning)/.test(document.getElementById('af-email').parentNode.className),
            null, { timeout: 5000 });
        expect(await gated(page)).toBe('true');
    });

    test('04 control: a keyframe of another name is ignored', async ({ page }) => {
        await gotoAndBoot(page);
        await nativeFill(page, 'af-email', 'someone@example.com');
        await nativeFill(page, 'af-secret', 'hunter2');
        await fireKeyframe(page, 'af-email', 'af-other');
        await fireKeyframe(page, 'af-secret', 'af-other');
        await page.waitForTimeout(600);
        expect(await gated(page)).toBe('true');
    });

    test('05 withheld secret: the gate opens with no error on that field, and the click refuses to post the empty credential', async ({ page }) => {
        await gotoAndBoot(page);
        const posts = countPosts(page);
        await page.evaluate(() => {
            const orig = Element.prototype.matches;
            Element.prototype.matches = function (sel) {
                if (this.id === 'af-secret' && /autofill/.test(sel)) { return true; }
                return orig.call(this, sel);
            };
        });
        await nativeFill(page, 'af-email', 'someone@example.com');
        await fireKeyframe(page, 'af-email');
        await fireKeyframe(page, 'af-secret');
        await waitOpen(page);
        expect(await wrapperClass(page, 'af-secret')).not.toMatch(/form-item-error/);
        await page.click('#afform-submit');
        await page.waitForFunction(
            () => /form-item-error/.test(document.getElementById('af-secret').parentNode.className),
            null, { timeout: 5000 });
        await page.waitForTimeout(400);
        expect(posts.length).toBe(0);
    });

    test('06 positive control: once released, the same click posts exactly once', async ({ page }) => {
        await gotoAndBoot(page);
        const posts = countPosts(page);
        await nativeFill(page, 'af-email', 'someone@example.com');
        await nativeFill(page, 'af-secret', 'hunter2');
        await fireKeyframe(page, 'af-email');
        await fireKeyframe(page, 'af-secret');
        await waitOpen(page);
        await page.click('#afform-submit');
        await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
    });
});
