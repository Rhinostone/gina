'use strict';

/**
 * Playwright RUNTIME e2e for #CC2 — form-associated custom element (FACE)
 * participation in FormValidator (real built gina bundle).
 *
 * Confirms, end-to-end in a real browser, what the bind-layer widening claims:
 *   - hazard (c): a form-associated custom element really joins form.elements
 *     (the platform behaviour gina's read-side code relies on) — the one-shot
 *     empirical confirmation;
 *   - the widened bind layer picks the FACE up: it is auto-ided (`face.*`),
 *     registered for live-check, and tracked in the form's fieldsSet;
 *   - live-check runs on the FACE's composed bubbling `change` (a REAL click on
 *     its toggle) — the required error clears and the submit control enables;
 *   - the FACE value rides the always-XHR submit payload;
 *   - it participates alongside a reassociated (`form="parent"`) native control.
 *
 * Harness (runtime-server.js): dist gina.min.js + a NON-EMPTY forms whisper
 * (/js/gina.onload.face.js) so core.js actually binds the form, + the FACE
 * definition (fixtures/x-agree.js). The submit posts application/json to
 * /face-sink; the spec reads the outgoing request body.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/**
 * Navigate to the FACE harness and wait for the FACE definition, the framework
 * boot, AND the validator to have bound #parent (gina.validator.$forms.parent).
 */
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
        ),
        null,
        { timeout: 15000 }
    );
}

test.beforeEach(async ({ page }) => {
    await gotoFaceAndBoot(page);
});

test.describe('#CC2 FACE participation (real bundle)', () => {

    test('hazard c: the FACE joins form.elements (membership + named access)', async ({ page }) => {
        const r = await page.evaluate(() => {
            const form  = document.getElementById('parent');
            const agree = form.querySelector('x-agree');
            return {
                defined    : agree.matches(':defined'),
                tag        : agree.tagName,
                inElements : Array.from(form.elements).indexOf(agree) > -1,
                byName     : form.elements['agree'] === agree
            };
        });
        expect(r.defined).toBe(true);
        expect(r.tag).toBe('X-AGREE');
        expect(r.inElements).toBe(true);   // the load-bearing platform fact (hazard c)
        expect(r.byName).toBe(true);
    });

    test('bind: the FACE is auto-ided, registered for live-check, and tracked in fieldsSet', async ({ page }) => {
        const r = await page.evaluate(() => {
            const agree = document.querySelector('#parent x-agree');
            const form  = window.gina.validator.$forms['parent'];
            return {
                id         : agree.id,
                registered : !!(window.gina.events && window.gina.events['registered.' + agree.id]),
                inFieldsSet: !!(form.fieldsSet && form.fieldsSet[agree.id])
            };
        });
        expect(r.id).toMatch(/^face\./);   // the FACE-specific auto-id prefix
        expect(r.registered).toBe(true);
        expect(r.inFieldsSet).toBe(true);
    });

    test('live-check: a real toggle commits the FACE and clears the required error', async ({ page }) => {
        // initially invalid: agree='' fails isRequired, so the submit control is gated
        const before = await page.evaluate(() => {
            const btn = document.getElementById('parent-submit');
            return { gated: btn.getAttribute('data-gina-form-submit-gated') };
        });
        expect(before.gated).toBe('true');

        // a REAL click on the FACE's toggle (send/live-check read window.event)
        await page.click('#parent x-agree button');

        // the FACE now reports 'yes' → the agree error clears and the submit enables
        await expect.poll(async () => page.evaluate(() => {
            const errs = window.gina.validator.$forms['parent'].errors;
            return !!(errs && errs['agree']);
        })).toBe(false);

        await expect.poll(async () => page.evaluate(() =>
            document.getElementById('parent-submit').getAttribute('data-gina-form-submit-gated')
        )).not.toBe('true');
    });

    test('submit: the engaged FACE value rides the always-XHR payload', async ({ page }) => {
        await page.click('#parent x-agree button');   // engage → valid
        await expect.poll(async () => page.evaluate(() =>
            document.getElementById('parent-submit').getAttribute('data-gina-form-submit-gated')
        )).not.toBe('true');

        const [req] = await Promise.all([
            page.waitForRequest((r) => r.url().indexOf('/face-sink') > -1 && r.method() === 'POST', { timeout: 15000 }),
            page.click('#parent-submit')
        ]);
        const body = JSON.parse(req.postData());
        expect(body.agree).toBe('yes');
    });

    test('reassociated coexistence: a form="parent" native control rides the payload beside the FACE', async ({ page }) => {
        // the reassociated note input lives OUTSIDE #parent's subtree
        const membership = await page.evaluate(() => {
            const form = document.getElementById('parent');
            const note = document.getElementById('note');
            return {
                reassociated : !form.contains(note),      // truly out of subtree
                inElements   : Array.from(form.elements).indexOf(note) > -1
            };
        });
        expect(membership.reassociated).toBe(true);
        expect(membership.inElements).toBe(true);

        await page.fill('#note', 'hello');
        await page.click('#parent x-agree button');   // engage the required FACE → form valid
        await expect.poll(async () => page.evaluate(() =>
            document.getElementById('parent-submit').getAttribute('data-gina-form-submit-gated')
        )).not.toBe('true');

        const [req] = await Promise.all([
            page.waitForRequest((r) => r.url().indexOf('/face-sink') > -1 && r.method() === 'POST', { timeout: 15000 }),
            page.click('#parent-submit')
        ]);
        const body = JSON.parse(req.postData());
        expect(body.agree).toBe('yes');
        expect(body.note).toBe('hello');
    });
});
