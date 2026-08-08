'use strict';

/**
 * Playwright RUNTIME e2e for #B295 — an async `query` rule must leave the form's
 * validity state ACCURATE once it settles (the real built gina bundle, a real
 * query round-trip, a real click, a real POST).
 *
 * The defect: `onasyncCompleted` derives its verdict from
 * `cb._errors = d.getErrors(field)` — which `form-validator.js:2437-2442` scopes to
 * ONE field. On the last-field branch it then computes `isFormValid` from that
 * field-scoped set and guards the whole update block with `if (!isFormValid && …)`,
 * so when the form becomes VALID nothing runs: `updateSubmitTriggerState` is never
 * called, `handleErrorsDisplay` is never called, and `needsGlobalReValidation` stays
 * false. The bind-time `aria-disabled="true"` therefore survives on a form that is
 * genuinely valid, and `$forms[id].errors` keeps listing the field.
 *
 * That staleness pre-dates 0.6.4 and was merely cosmetic — nothing read the marker.
 * #B246's click gate reads it, so the first click after the query settles is eaten.
 *
 * Fix: hand the verdict to the fresh whole-form pass the function ALREADY runs for
 * the not-last-field case (`needsGlobalReValidation` -> `validate()` ->
 * `updateSubmitTriggerState($currentForm, gResult.isValid())`). Measured: that pass
 * is the ONLY trustworthy verdict source at that instant — with the FACE left
 * unengaged it reports `error.agree` where the in-pass `d.getErrors()` reports none.
 *
 * WHY THIS LIVES IN test/e2e: the defect only exists across a real network
 * round-trip driving a real event listener. It is also why arm 01 deliberately does
 * NOT poll on `aria-disabled` before clicking — `web-components.face.spec.js` does
 * exactly that and stayed green right through #B293, because waiting for the guard
 * to clear synchronises away the window every one of these defects lives in. A
 * `waitFor`/`expect.poll` on the very state under test narrows a test to the settled
 * case only, and a real user clicks whenever they like. Arm 01 therefore waits for
 * the QUERY to settle, which is a different signal, and then acts.
 *
 * Arms (one variable each, every one a control for the others):
 *   01 valid form, query settled  -> ONE click must SEND      (RED before the fix)
 *   02 same scene                 -> the marker must be CLEAR (the state assertion)
 *   03 FACE left unengaged        -> must NOT send            (#B246's intent survives)
 *   04 no query rule at all       -> must SEND                (positive control: the
 *                                    instrument can see a send, and the mechanism is
 *                                    specific to the async path)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/** Stock + a second field whose LAST rule is an async `query`. */
const ASYNC_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true },
            // `validIf: true` + a `{"isValid":true}` body is what form-validator.js:614-619
            // compares; a bare `{}` never validates and yields an inconclusive scene.
            note: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } }
        }
    }
});

/** The same two fields with NO async rule — arm 04's control. */
const SYNC_RULES = JSON.stringify({
    rules: { faceform: { agree: { isRequired: true }, note: { isRequired: true } } }
});

/**
 * Swap the harness's form rules and stub the uniqueness endpoint.
 * Returns a live counter object; `rulesRewritten` is the extraction control — if the
 * anchor ever drifts it reads false and the scene is inconclusive rather than silently
 * running the stock single-field rules.
 */
async function installRules(page, rulesJson) {
    const seen = { rulesRewritten: null, queryCalls: 0 };

    await page.route('**/js/gina.onload.face.js', async (route) => {
        const body = await (await route.fetch()).text();
        const from = encodeURIComponent(STOCK_RULES);
        seen.rulesRewritten = body.indexOf(from) > -1;
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: seen.rulesRewritten ? body.split(from).join(encodeURIComponent(rulesJson)) : body
        });
    });

    await page.route('**/uniq*', async (route) => {
        seen.queryCalls++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"isValid":true}' });
    });

    return seen;
}

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

/** Engage the FACE so the `agree` field is satisfied. */
async function engageFace(page) {
    await page.click('#parent x-agree button');
    await page.waitForTimeout(300);
}

/**
 * Fill `note` and blur it, which is what drives the live check into the `query` rule.
 * Deliberately does NOT wait on `aria-disabled`; `settle` waits on the query instead.
 */
async function fillNoteAndSettle(page, seen, expectQuery) {
    await page.click('#note');
    await page.keyboard.type('someone@example.com', { delay: 20 });
    await page.keyboard.press('Tab');

    if (expectQuery) {
        await expect.poll(() => seen.queryCalls, {
            message: 'the async query rule must actually run, or the scene proves nothing',
            timeout: 10000
        }).toBeGreaterThan(0);
    }
    // let the completion path (and, once fixed, the whole-form re-validation) run
    await page.waitForTimeout(1500);
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(1); }
    });
    return posts;
}

test.describe('#B295 — an async query rule must leave validity state accurate', function () {

    test('01 - one click sends once the query settles (the regression arm)', async ({ page }) => {
        const posts = countPosts(page);
        const seen = await installRules(page, ASYNC_RULES);
        await gotoFaceAndBoot(page);
        await engageFace(page);
        await fillNoteAndSettle(page, seen, true);

        expect(seen.rulesRewritten, 'the rules anchor must still match').toBe(true);

        await page.click('#parent-submit', { force: true });   // force: a stale marker fails actionability
        await page.waitForTimeout(1200);
        expect(posts.length, 'the FIRST click on a settled valid form must send').toBeGreaterThan(0);
    });

    test('02 - the trigger marker is cleared once the query settles', async ({ page }) => {
        const seen = await installRules(page, ASYNC_RULES);
        await gotoFaceAndBoot(page);
        await engageFace(page);
        await fillNoteAndSettle(page, seen, true);

        const state = await page.evaluate(() => {
            const b = document.getElementById('parent-submit');
            const f = window.gina.validator.$forms['parent'];
            return {
                gated: b.getAttribute('data-gina-form-submit-gated'),
                errorKeys: f && f.errors ? Object.keys(f.errors) : []
            };
        });
        expect(state.gated, 'a valid form must not stay gated (#B312 marker)').not.toBe('true');
        expect(state.errorKeys, 'a valid form must not keep a stale error record').toEqual([]);
    });

    test('03 - #B246 intent survives: another invalid field still blocks the send', async ({ page }) => {
        const posts = countPosts(page);
        const seen = await installRules(page, ASYNC_RULES);
        await gotoFaceAndBoot(page);
        // the FACE is deliberately NOT engaged, so `agree` stays invalid while the
        // async field itself becomes valid — the case where a field-scoped verdict lies
        await fillNoteAndSettle(page, seen, true);

        const gated = await page.evaluate(() =>
            document.getElementById('parent-submit').getAttribute('data-gina-form-submit-gated'));
        expect(gated, 'an untouched invalid field must keep the trigger marked').toBe('true');

        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 'the async settle must never enable a still-invalid form').toBe(0);
    });

    test('04 - positive control: the same scene without a query rule sends', async ({ page }) => {
        const posts = countPosts(page);
        const seen = await installRules(page, SYNC_RULES);
        await gotoFaceAndBoot(page);
        await engageFace(page);
        await fillNoteAndSettle(page, seen, false);

        expect(seen.queryCalls, 'the control arm must not run a query at all').toBe(0);
        await page.click('#parent-submit', { force: true });
        await page.waitForTimeout(1200);
        expect(posts.length, 'the instrument can observe a send on the sync path').toBeGreaterThan(0);
    });
});
