'use strict';

/**
 * Playwright RUNTIME e2e for #B309 — the send-settle releases must replay the
 * live-check gate's last verdict on <a> submit triggers instead of
 * blanket-removing aria-disabled.
 *
 * THE DEFECT. On an <a data-gina-form-submit="true"> trigger the live-check
 * gate (updateSubmitTriggerState) and send()'s in-flight lock SHARE
 * aria-disabled with opposite lifecycles. Both settle releases removed the
 * attribute unconditionally and nothing re-marks after settle, so a
 * MID-FLIGHT invalidation (the user empties a required field while the
 * request is in flight — reachable because the #B192 submit latch clears at
 * readyState 1, deliberately) was silently un-gated at settle. The
 * divergence signature pre-fix: `gina-form-submit-disabled` class PRESENT,
 * aria-disabled GONE — a trigger the gate believes marked, that assistive
 * tech and the #B246/#B308 gates read as operable.
 *
 * SCENE. The form is made valid through the measured-synchronous instrumented
 * `.value =` write (the same mechanism the #B308 spec leans on) and the sink
 * is HELD open with a promise-gated route. The mid-flight RE-MARK channel is
 * the #B246 reveal: live-check itself is DELIBERATELY latched during a real
 * in-flight submit (#B192's valid branch keeps the latch until settle —
 * measured here: neither keystrokes nor instrumented writes re-mark while
 * the request is held), but a SECOND trusted click on the locked trigger is
 * refused by the click guard, whose revealValidationState re-derives
 * validity from the LIVE values and re-syncs the gate — so an impatient
 * double-click over an edited-empty field marks the trigger mid-flight,
 * synchronously. The gate's re-mark is waited on via the CLASS (the gate's
 * own second marker: the in-flight lock sets only the attribute, so the
 * class appearing is what proves the GATE re-marked, not the lock). The held
 * response settles as a 500 so no success-path cleanup can legitimately
 * un-mark the gate between the releases and the assertions.
 *
 * Arms: 01 is RED pre-fix (A-tag: aria gone at settle while the class
 * stays). 02 button control: a natively-disabled button delivers NO click at
 * all (#B293), so the reveal channel cannot re-mark a button mid-flight —
 * the arm instead writes the aria mark directly (the consumer-written shape)
 * and pins the design claim that a mid-flight aria mark on a button already
 * survives the settle, because the button branch releases only the native
 * lock. 03 no-invalidation guard: a valid form's A-trigger must settle
 * OPERABLE — the replay must not manufacture stale marks. 02 and 03 hold on
 * both sides.
 *
 * RED-FIRST: point B309_PREFIX_BUNDLE at a pre-fix bundle —
 *   git show <pre-fix-sha>:framework/v<ver>/core/asset/plugin/dist/vendor/gina/js/gina.min.js > /tmp/prefix.min.js
 *   B309_PREFIX_BUNDLE=/tmp/prefix.min.js npx playwright test test/e2e/validator-send-release-gate-replay.spec.js
 * Arm 01 then fails on the aria assertion (attribute gone at settle).
 */

const fs = require('fs');
const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

const PREFIX_BUNDLE = process.env.B309_PREFIX_BUNDLE
    ? fs.readFileSync(process.env.B309_PREFIX_BUNDLE)
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
 * Inject a live-check form (rule `faceform` requires `agree`) with the given
 * submit trigger, bind via the public validateFormById, wait for the
 * bind-time marker, then HEAL it through the instrumented `.value =` write.
 * Returns once the trigger is operable (a valid form, gate stamped valid).
 */
async function injectValidForm(page, formId, triggerHtml) {
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
    await page.evaluate((formId) => {
        document.getElementById(formId + '-agree').value = 'valid data';
    }, formId);
    await page.waitForFunction(
        (formId) => document.getElementById(formId + '-submit').getAttribute('aria-disabled') !== 'true',
        formId, { timeout: 10000 });
}

/**
 * Hold every /face-sink response behind a promise; `release()` lets the held
 * request settle as a 500 (no success-path cleanup can then legitimately
 * un-mark the gate between the releases and the assertions).
 */
async function holdSink(page) {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route('**/face-sink', async (route) => {
        await gate;
        await route.fulfill({
            status: 500,
            contentType: 'application/json; charset=utf-8',
            body: '{"error":"held sink"}'
        });
    });
    return release;
}

function collectPageErrors(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
}

async function waitInFlight(page, formId) {
    await page.waitForFunction(
        (formId) => document.getElementById(formId).getAttribute('data-gina-form-loading') !== null,
        formId, { timeout: 10000 });
}

async function waitSettled(page, formId) {
    await page.waitForFunction(
        (formId) => document.getElementById(formId).getAttribute('data-gina-form-loading') === null,
        formId, { timeout: 10000 });
    // Both releases (readyState-4 + loadend) have run once the attribute is
    // gone; a short grace covers the loadend tail.
    await page.waitForTimeout(300);
}

function readTriggerState(page, formId) {
    return page.evaluate((formId) => {
        const t = document.getElementById(formId + '-submit');
        return {
            aria: t.getAttribute('aria-disabled'),
            nativeDisabled: t.hasAttribute('disabled'),
            gateClass: t.classList.contains('gina-form-submit-disabled')
        };
    }, formId);
}

test.describe('#B309 — settle releases replay the gate verdict on <a> triggers', function () {

    test('01 - mid-flight invalidation survives the settle on an <a> trigger (RED pre-fix)', async ({ page }) => {
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectValidForm(page, 'relaya',
            '<a id="relaya-submit" data-gina-form-submit="true" href="#">Save</a>');
        const release = await holdSink(page);

        await page.click('#relaya-submit');
        await waitInFlight(page, 'relaya');

        // Empty the field WHILE the request is held. Live-check stays quiet by
        // design (#B192's in-flight latch), so nothing re-marks yet …
        await page.evaluate(() => {
            document.getElementById('relaya-agree').value = '';
        });
        // … then the impatient double-click: the trigger carries the in-flight
        // lock's aria-disabled, so the #B246 click guard refuses the gesture and
        // its reveal re-derives validity from the LIVE (now empty) values —
        // re-marking the trigger mid-flight. force: same actionability note as
        // the #B308 spec — a real pointer is not blocked by aria-disabled.
        await page.click('#relaya-submit', { force: true });
        await page.waitForFunction(
            () => document.getElementById('relaya-submit').classList.contains('gina-form-submit-disabled'),
            null, { timeout: 10000 });

        release();
        await waitSettled(page, 'relaya');

        const state = await readTriggerState(page, 'relaya');
        expect(state.gateClass, 'the gate class was never the clobbered half').toBe(true);
        expect(state.aria,
            'the gate verdict must survive the settle (pre-fix: the blanket release removed it)').toBe('true');
        expect(errors).toEqual([]);
    });

    test('02 - button control: the gate mark already survives, the native lock is released (guard, both sides)', async ({ page }) => {
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectValidForm(page, 'relayb',
            '<button id="relayb-submit" type="submit">Save</button>');
        const release = await holdSink(page);

        await page.click('#relayb-submit');
        await waitInFlight(page, 'relayb');

        // A natively-disabled button delivers no click (#B293), so the reveal
        // channel cannot re-mark it mid-flight — write the aria mark directly
        // (the consumer-written shape the design's button claim covers).
        await page.evaluate(() => {
            document.getElementById('relayb-submit').setAttribute('aria-disabled', 'true');
        });

        release();
        await waitSettled(page, 'relayb');

        const state = await readTriggerState(page, 'relayb');
        expect(state.nativeDisabled, 'the in-flight native lock is released').toBe(false);
        expect(state.aria,
            'a mid-flight aria mark on a button survives the settle — its release only touches the native lock').toBe('true');
        expect(errors).toEqual([]);
    });

    test('03 - no mid-flight invalidation: the <a> trigger settles OPERABLE (guard, both sides)', async ({ page }) => {
        const errors = collectPageErrors(page);
        await gotoFaceAndBoot(page);
        await injectValidForm(page, 'relayc',
            '<a id="relayc-submit" data-gina-form-submit="true" href="#">Save</a>');
        const release = await holdSink(page);

        await page.click('#relayc-submit');
        await waitInFlight(page, 'relayc');
        release();
        await waitSettled(page, 'relayc');

        const state = await readTriggerState(page, 'relayc');
        expect(state.aria, 'a valid form settles with an operable trigger — the replay must not manufacture a stale mark').toBe(null);
        expect(state.gateClass, 'no gate mark was ever set').toBe(false);
        expect(errors).toEqual([]);
    });
});
