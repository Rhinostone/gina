'use strict';

/**
 * #B447 — a form submit that fails at the TRANSPORT layer dispatches no event,
 * so a consumer's declared submit-error handler never fires.
 *
 * Reported by a consumer session from source reading of the published artifact;
 * this spec is the runtime verification that report explicitly did NOT have.
 *
 * MECHANISM (verified in source): the xhr.onreadystatechange settle chain has a
 * success arm `/^2/.test(xhr.status)` and an error arm `else if (xhr.status != 0)`
 * which EXCLUDES 0. The arm that would handle status 0 is fully commented out and
 * there is no trailing else, so both `error.<id>` and `error.<id>.hform` — which
 * live inside the status != 0 arm — are unreachable for a transport failure.
 * `xhr.onerror` and `xhr.timeout` are never assigned (measured 0 each, with
 * `ontimeout` = 2 and `responseType` = 3 as firing controls).
 *
 * ARMS. 01 is the POSITIVE CONTROL and must pass on BOTH sides of the fix: a 500
 * response fires the error event, proving the listener is wired where a real
 * consumer handler would sit. Without it, arm 02's "nothing fired" would be
 * indistinguishable from a broken probe. 02 is the defect: the same submit whose
 * request is ABORTED at the transport layer.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT;

/** Load the validator fixture and wait for positive bind evidence. */
async function gotoForm(page) {
    await page.goto(BASE + '/autocomplete');
    await page.waitForFunction(
        () => window.gina && window.gina.isFrameworkLoaded === true
            && window.gina.validator && window.gina.validator.$forms
            && window.gina.validator.$forms['acform'],
        null,
        { timeout: 15000 }
    );
    // Positive evidence the form is actually bound — never absence-of-error.
    const bound = await page.evaluate(
        () => !!(window.gina.validator.$forms['acform']));
    expect(bound, 'acform must be bound before submitting').toBe(true);
}

/**
 * Record every settle-ish event the validator can dispatch for this form.
 * triggerEvent dispatches bubbling CustomEvents, so document catches them all.
 */
async function installRecorder(page) {
    await page.evaluate(() => {
        window.__evts = [];
        ['error.acform', 'error.acform.hform', 'success.acform', 'submit.acform']
            .forEach((n) => document.addEventListener(n, (e) => {
                window.__evts.push({
                    name: n,
                    status: e && e.detail && e.detail.status,
                    transportError: !!(e && e.detail && e.detail.transportError)
                });
            }));
    });
}

async function submitAndCollect(page) {
    // The field is live-checked and empty fails validation, which blocks the
    // submit client-side — without this the XHR never fires and BOTH arms read
    // "no error event" for the wrong reason (measured: the positive control
    // failed until the field was filled).
    await page.fill('#ref-input', 'ABC123');
    await page.waitForTimeout(400);
    await page.click('#acform-submit');
    await page.waitForTimeout(2500);
    return page.evaluate(() => window.__evts);
}

test.describe('#B447 validator — transport-layer submit failure must reach the consumer', () => {

    test('01 - POSITIVE CONTROL: a 500 response DOES fire the error event', async ({ page }) => {
        await page.route('**/ac-sink', (route) => route.fulfill({
            status: 500,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ status: 500, message: 'boom' })
        }));
        await gotoForm(page);
        await installRecorder(page);
        const evts = await submitAndCollect(page);
        const errs = evts.filter((e) => /^error\./.test(e.name));
        expect(errs.length,
            'the listener must be wired where a real consumer handler sits — '
            + 'if this is 0 the probe is broken and arm 02 proves nothing'
        ).toBeGreaterThan(0);
        expect(errs[0].status).toBe(500);
    });

    test('02 - a transport failure reaches the consumer (RED pre-fix)', async ({ page }) => {
        await page.route('**/ac-sink', (route) => route.abort('connectionrefused'));
        await gotoForm(page);
        await installRecorder(page);
        const evts = await submitAndCollect(page);
        console.log('[#B447] events observed on transport failure:', JSON.stringify(evts));
        const errs = evts.filter((e) => /^error\./.test(e.name));
        // RED PRE-FIX: this was 0 — the submit settled silently.
        expect(errs.length, 'a transport failure must reach the consumer').toBeGreaterThan(0);
        // 408 keeps `status >= 400` handlers working; transportError distinguishes
        // this from a genuine timeout, which emits a bare 408.
        expect(errs[0].status, 'status must be 408').toBe(408);
        expect(errs[0].transportError,
            'transportError distinguishes this from a genuine timeout').toBe(true);
        // NOT asserted here: the `error.<id>.hform` channel — the one
        // `data-gina-form-event-on-submit-error` registers via listenToXhrEvents.
        // It is gated on hFormIsRequired, i.e. on the form DECLARING that
        // attribute, and this fixture is shared with the autocomplete specs so
        // adding it would change their scene (it flips listenToXhrEvents on).
        // The emit itself is unconditional in the same arm as error.<id>, so it
        // rides the same code path. DEFERRED, priority: medium — a dedicated
        // fixture declaring the attribute, tracked on #B447.
    });
});
