'use strict';

/**
 * Playwright RUNTIME e2e for #B308 — the per-form `submit` proxy must honor the
 * disabled gate for USER GESTURES with the same predicate and the same answer
 * as the click path (#B246): cancel + reveal, read from the LIVE registered
 * trigger.
 *
 * THE DEFECT. The proxy's old guard parsed a DOMParser copy of the form's
 * innerHTML and tested only native `.disabled` on the copy — blind to the
 * `aria-disabled` marker (the gate's own vocabulary), while SIGHTED on a native
 * `disabled` written mid-dispatch by a double-submit guard (the exact attribute
 * #B293 ruled must not count on a real form control). A wrapped-label click
 * (`<button type="submit"><span>`, whose click surfaces as a submit event
 * because the span has no `.type`) therefore ran the full collect -> validate
 * cycle for a gated trigger — and SENT whenever the values validated.
 *
 * SCENE — why the arms pin an INVALID form, not a stale marker. Two measured
 * facts rule the stale scene out as a deterministic fixture:
 *   (1) a page-level `.value =` write on a bound field IS heard — the value
 *       property is instrumented and the silent live validation repairs the
 *       marker SYNCHRONOUSLY inside the write (arm 05 leans on exactly this);
 *   (2) the one constructible stale combination (protocol-level fill on a
 *       validateFormById-bound injected form, which wires no input listeners)
 *       is racy BY CONSTRUCTION: a delayed silent global pass (~0.4-1s,
 *       timing-dependent) can heal the marker between the fill and the click.
 * So the arms keep the form genuinely invalid — `agree` stays empty, the
 * marker is gina's own bind-time verdict and cannot heal — and discriminate on
 * EVENT EMISSION, not POSTs: with no `on('submit')` bound, a completed
 * validation cycle fires `validate.<id>` as a CustomEvent on the form element
 * (main.js — the no-`on('submit')` branch), catchable with a plain
 * addEventListener; the post-fix refusal answers with revealValidationState,
 * which is display-only (pinned by test/core/validator-submit-trigger-state
 * .test.js: no dispatch, no send) and fires nothing. An invalid form never
 * POSTs on either side, so the event count alone is the red/green line for
 * the gesture arms.
 *
 * ENTER ANATOMY (probe-measured on both bundles, Chromium). Which gate a
 * gated form's Enter needs depends on whether the form owns a native submit
 * button:
 *   - WITH one (arm 02): implicit submission synthesizes ONE trusted click on
 *     the default button and never forms a submit event — the #B246 CLICK
 *     guard eats the click while the marker stands, pre-fix included. (An
 *     earlier stale-scene reproduction that recorded Enter "sending" here is
 *     consistent with the (2) heal race above: the send went through an
 *     already-healed gate, not through the guard.)
 *   - WITHOUT one (arm 03 — an `<a data-gina-form-submit="true">` trigger):
 *     implicit submission fires a DIRECT trusted submit at the proxy. That is
 *     the Enter leg only THIS fix gates: pre-fix the cycle ran (validate
 *     fired); post-fix the gesture gate refuses.
 *
 * THE FIX SHAPE (deliberate scope): `e.isTrusted` gestures are cancelled +
 * revealed; gina's own `triggerEvent` submits (`$forms[id].submit()`) arrive
 * untrusted and keep the fresh-validate path — a programmatic submit is not
 * operating the control, and the fresh pass is the honest gate there. Arm 04
 * pins that delta, and doubles as the instrument control: the same listener
 * that must stay silent in arms 01/02/03 fires there, so a zero is a reading,
 * not a dead instrument.
 *
 * RED-FIRST: point B308_PREFIX_BUNDLE at a pre-fix bundle to re-run these
 * arms against the defect —
 *   git show <pre-fix-sha>:framework/v<ver>/core/asset/plugin/dist/vendor/gina/js/gina.min.js > /tmp/prefix.min.js
 *   B308_PREFIX_BUNDLE=/tmp/prefix.min.js npx playwright test test/e2e/validator-submit-proxy-disabled-gate.spec.js
 * Arms 01 and 03 then fail on the event count (the pre-fix cycle runs and
 * fires validate.<id> — measured: 1 each); 02/04/05 hold on both sides.
 */

const fs = require('fs');
const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

// Red-proof hook — when set, every page in this spec is served the given
// bundle in place of the working-tree dist (see RED-FIRST above). Inert in
// normal runs.
const PREFIX_BUNDLE = process.env.B308_PREFIX_BUNDLE
    ? fs.readFileSync(process.env.B308_PREFIX_BUNDLE)
    : null;

async function gotoFaceAndBoot(page) {
    if (PREFIX_BUNDLE) {
        await page.route('**/js/gina.min.js', (route) => route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: PREFIX_BUNDLE
        }));
    }
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

/**
 * Inject a live-check form whose gated field is a plain text input (rule
 * `faceform` requires `agree`), bind it through the public validateFormById,
 * and wait for the bind-time silent validation to mark the trigger.
 * `triggerHtml` picks the submit-trigger shape (wrapped-label button vs
 * A-tag); `formId` keeps the two shapes' fixtures independent.
 */
async function injectGatedForm(page, formId, triggerHtml) {
    await page.evaluate(({ formId, triggerHtml }) => {
        const f = document.createElement('form');
        f.id = formId;
        f.setAttribute('data-gina-form-rule', 'faceform');
        f.setAttribute('data-gina-form-live-check-enabled', 'true');
        f.setAttribute('action', '/face-sink');
        f.setAttribute('method', 'post');
        f.innerHTML = '<label>Agree <input id="' + formId + '-agree" type="text" name="agree"></label>'
            + triggerHtml;
        document.body.appendChild(f);
        window.gina.validator.validateFormById(formId);
    }, { formId, triggerHtml });
    await page.waitForFunction(
        (formId) => !!(window.gina.validator.$forms && window.gina.validator.$forms[formId]),
        formId, { timeout: 10000 });
    await page.waitForFunction(
        (formId) => document.getElementById(formId + '-submit').getAttribute('aria-disabled') === 'true',
        formId, { timeout: 10000 });
}

function injectWrappedForm(page) {
    return injectGatedForm(page, 'wrapped',
        '<button id="wrapped-submit" type="submit"><span id="wrapped-span">Save</span></button>');
}

function injectAnchorForm(page) {
    return injectGatedForm(page, 'wrappeda',
        '<a id="wrappeda-submit" data-gina-form-submit="true" href="#">Save</a>');
}

/**
 * The discriminator: count `validate.<formId>` CustomEvents on the form.
 * Armed AFTER the bind settles, so bind-time activity can never pollute the
 * reading; arm 04 proves this exact listener fires (a zero from a listener
 * that cannot fire would be no reading at all).
 */
async function armValidateCounter(page, formId) {
    await page.evaluate((formId) => {
        window.__validateCount = 0;
        document.getElementById(formId).addEventListener('validate.' + formId, () => {
            window.__validateCount++;
        });
    }, formId);
}

function readValidateCount(page) {
    return page.evaluate(() => window.__validateCount);
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(1); }
    });
    return posts;
}

function collectPageErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
}

test.describe('#B308 — the submit proxy honors the disabled gate for user gestures', function () {

    test('01 - a gated wrapped-label gesture is refused BEFORE the cycle: no validate event, no POST (RED pre-fix)', async ({ page }) => {
        const posts = countPosts(page);
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectWrappedForm(page);   // agree stays empty -> genuinely invalid, gina's own bind-time marker
        await armValidateCounter(page, 'wrapped');

        // Click the SPAN: no `.type`, so the click proxy's submit branch never fires
        // and the gesture surfaces as a native (trusted) submit event at the proxy.
        // force: Playwright's actionability walks up to the aria-disabled button and
        // refuses (element not enabled) — a real pointer is NOT blocked there, so
        // force keeps the trusted input pipeline and lets gina do the refusing.
        await page.click('#wrapped-span', { force: true });
        await page.waitForTimeout(700);

        expect(await readValidateCount(page),
            'the refusal must come BEFORE the cycle (pre-fix: the cycle ran and fired validate.wrapped)').toBe(0);
        expect(posts.length, 'an invalid form never sends, on either side of the fix').toBe(0);
        // The refusal is visible: revealValidationState renders the errors and
        // moves focus to the first invalid field.
        const focusIsField = await page.evaluate(
            () => document.activeElement === document.getElementById('wrapped-agree'));
        expect(focusIsField, 'focus lands on the first invalid field').toBe(true);
        expect(errors).toEqual([]);
    });

    test('02 - Enter with a native submit button: the synthesized click is refused by the #B246 click guard (guard, both sides)', async ({ page }) => {
        const posts = countPosts(page);
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectWrappedForm(page);
        await armValidateCounter(page, 'wrapped');

        // Probe-measured on this shape: implicit submission synthesizes ONE
        // trusted click on the default button and no submit event ever forms —
        // the #B246 click guard refuses while the marker stands (pre-fix too).
        await page.focus('#wrapped-agree');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(700);

        expect(await readValidateCount(page),
            'Enter must not start the cycle, whichever gate catches it (here: the #B246 click guard)').toBe(0);
        expect(posts.length, 'Enter on a gated form must not send').toBe(0);
        expect(errors).toEqual([]);
    });

    test('03 - Enter with an A-tag trigger (no native submit button): the DIRECT submit is refused (RED pre-fix)', async ({ page }) => {
        const posts = countPosts(page);
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectAnchorForm(page);
        await armValidateCounter(page, 'wrappeda');

        // No native submit button in the form -> implicit submission fires a
        // DIRECT trusted submit event at the proxy (probe-measured: zero clicks,
        // one trusted submit). Only the #B308 gesture gate stands on this path —
        // the #B246 click guard structurally cannot catch it.
        await page.focus('#wrappeda-agree');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(700);

        expect(await readValidateCount(page),
            'the refusal must come BEFORE the cycle (pre-fix: the cycle ran and fired validate.wrappeda)').toBe(0);
        expect(posts.length, 'Enter on a gated form must not send').toBe(0);
        // Same refusal visibility as arm 01, on this trigger shape.
        const focusIsField = await page.evaluate(
            () => document.activeElement === document.getElementById('wrappeda-agree'));
        expect(focusIsField, 'focus lands on the first invalid field').toBe(true);
        expect(errors).toEqual([]);
    });

    test('04 - a PROGRAMMATIC submit keeps the fresh-validate path (scope delta + instrument control)', async ({ page }) => {
        const posts = countPosts(page);
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectWrappedForm(page);
        await armValidateCounter(page, 'wrapped');

        // gina's triggerEvent dispatches an untrusted CustomEvent -> the gesture
        // gate does not apply; the fresh validate pass runs, finds `agree` empty,
        // and ends in the no-`on('submit')` branch: validate.wrapped fires, its
        // guard's isValid() gate stops the send. This is the deliberate scope
        // delta AND the proof the arms-01/02/03 listener can fire.
        await page.evaluate(() => window.gina.validator.$forms['wrapped'].submit());
        await page.waitForTimeout(700);

        expect(await readValidateCount(page),
            'the untrusted path still runs the cycle: validate.wrapped fires exactly once').toBe(1);
        expect(posts.length, 'invalid -> the isValid() gate stops the send').toBe(0);
        expect(errors).toEqual([]);
    });

    test('05 - a genuinely VALID form: the wrapped-label gesture goes through, exactly one POST (no over-fire)', async ({ page }) => {
        const posts = countPosts(page);
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectWrappedForm(page);

        // Heal by the measured mechanism: a page-level `.value =` write on a bound
        // field runs the silent live validation synchronously (the value property
        // is instrumented), so the marker clears without any gesture.
        await page.evaluate(() => {
            document.getElementById('wrapped-agree').value = 'valid data';
        });
        await page.waitForFunction(
            () => document.getElementById('wrapped-submit').getAttribute('aria-disabled') !== 'true',
            null, { timeout: 10000 });
        await armValidateCounter(page, 'wrapped');

        // No force needed: the marker is gone, actionability passes.
        await page.click('#wrapped-span');
        await page.waitForTimeout(900);

        expect(posts.length, 'an un-gated valid form submits from the gesture — the gate must not over-fire').toBe(1);
        expect(await readValidateCount(page),
            'exactly one cycle ran for the gesture').toBe(1);
        expect(errors).toEqual([]);
    });
});
