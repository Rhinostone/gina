/**
 * #B346 — a submit click that lands while a field's live-check `query` is
 * still ON THE WIRE must start a normal submit cycle that WAITS for the
 * verdict — not be silently eaten.
 *
 * Consumer-measured on the shipped #B342 fix (live browser, trusted clicks,
 * request interception): 0/6 dispatches inside the in-flight window versus
 * 6/6 once the query had settled. The query fired and settled in the starving
 * arm, so the click was lost before any cycle began.
 *
 * MEASURED MECHANISM (recorded under #B346 in the ledger — it is NOT the
 * "#B342 invariant one layer out" the consumer report guessed): with
 * live-check ON, `updateSubmitTriggerState` gates the trigger whenever the
 * form is not-yet-valid (`data-gina-form-submit-gated="true"` + class,
 * deliberately operable — #B312), and the #B246 proxy guard then refuses the
 * click with a display-only `revealValidationState()`. While a query is on
 * the wire the form has NO verdict yet — so the gate misclassifies
 * *verdict-pending* as *invalid*, and the reveal has nothing to reveal: a
 * dead click. An instrumented run proved the wake path fully healthy (4
 * waiters armed, 4 dispatches, all 4 listeners ran) while `isSubmitting`
 * stayed null throughout — no cycle ever started.
 *
 * THE FIX (A′ narrow): at the #B246 refusal, when the gated mark is the ONLY
 * refusal reason (authored `aria-disabled` / non-IDL native `disabled` keep
 * refusing), no committed errors are recorded, and an owned field carries the
 * in-flight query marker, the click proceeds into the normal submit cycle.
 * Everything downstream is shipped #B332-family machinery: the pass latches
 * and arms its waiter, the engine's in-flight branch declines to duplicate
 * the XHR, the pending settle wakes the waiter, and the latched completion
 * dispatches (#B342) — valid → send, invalid → render + focus + latch
 * release (#B192). This is exactly the flow live-check-OFF forms already run
 * (pinned by the sibling idless-trigger spec).
 *
 * The scene here deliberately KEEPS live-check ON (the sibling spec forces it
 * off) and KEEPS the trigger id (#B333's id-less variable is irrelevant to
 * this window): one thing under test.
 *
 * SLICE 2 (same arc, arms 05-07): the SAME misclassification refused
 * wrapped-label submits (`<button type="submit"><span>` — the click targets
 * the span, so the click proxy's submit branch never fires and the native
 * activation surfaces as a TRUSTED `submit` at the #B308 gate) — and the
 * programmatic `$forms[id].submit()` path, which never consulted the gate,
 * starved UN-LATCHED: with the query field not declared last, its waiter's
 * completion resolves to display-only re-validation work that never runs the
 * pass callback. Both doors now proceed through the same carve-out, and the
 * fresh-validate path LATCHES when it enters a pending window (releasing
 * before any consumer `submit.<id>` dispatch), so the latched completion
 * (#B342) can dispatch it. Arm 07 guards the carve-out's boundary: an
 * AUTHORED `aria-disabled` keeps refusing.
 *
 * NB measured while red-firsting these arms: Enter with a DEFAULT BUTTON
 * present is NOT a trusted-gate scene — implicit submission synthesizes a
 * click on the default button (HTML spec), which routes through the click
 * proxy, so slice 1's carve-out already covers it (an Enter arm read GREEN on
 * the pre-slice-2 bundle for exactly that reason). The trusted gate owns the
 * wrapped-label and button-less-form shapes.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/**
 * Query on the FIRST-declared field with a required field AFTER it — the
 * consumer shape, and the one whose live-check round-trip opens the window.
 */
const ASYNC_FIRST_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } },
            note: { isRequired: true }
        }
    }
});

/** Wide enough that a click issued straight after the fill lands well inside the window. */
const QUERY_DELAY_MS = 900;

/**
 * Serve the scene with LIVE-CHECK LEFT ON — engaging the FACE adjudicates
 * `agree` and puts its query on the wire, which is what opens the #B346
 * window. A second submit click cannot open it: the #B332 re-entry belt
 * refuses clicks only once a cycle has latched, and the defect here is that
 * no cycle ever starts.
 */
async function installInFlightScene(page, uniqBody) {
    const seen = {
        rulesRewritten: null, liveCheckSeen: null,
        queryCalls: 0, queryAnswered: 0, queryAnsweredAt: 0
    };

    await page.route('**/js/gina.onload.face.js', async (route) => {
        const body = await (await route.fetch()).text();
        const from = encodeURIComponent(STOCK_RULES);
        seen.rulesRewritten = body.indexOf(from) > -1;
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: seen.rulesRewritten ? body.split(from).join(encodeURIComponent(ASYNC_FIRST_RULES)) : body
        });
    });

    await page.route('**/face', async (route) => {
        const html = await (await route.fetch()).text();
        // Assert PRESENT rather than rewrite: this scene depends on live-check
        // being on, so a harness silently serving it off would pass §02 for
        // the wrong reason and void §01.
        seen.liveCheckSeen = html.indexOf('data-gina-form-live-check-enabled="true"') > -1;
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });

    await page.route('**/uniq*', async (route) => {
        seen.queryCalls++;
        await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
        seen.queryAnswered++;
        seen.queryAnsweredAt = Date.now();
        await route.fulfill({ status: 200, contentType: 'application/json', body: uniqBody });
    });

    return seen;
}

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

/**
 * Engage the FACE (fires the agree live-check whose query opens the window),
 * fill `note`, and return with the query still on the wire — asserted, so a
 * slow run voids loudly instead of passing the wrong scene.
 */
async function fillInsideWindow(page, seen) {
    await page.click('#parent x-agree button');
    await page.fill('#note', 'someone@example.com');
    expect(seen.queryCalls, 'the live-check query must be ON THE WIRE before the click').toBeGreaterThanOrEqual(1);
    expect(seen.queryAnswered, 'the query settled before the click — the window closed; scene void').toBe(0);
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(Date.now()); }
    });
    return posts;
}

test.describe('#B346 — a submit click landing while the live-check query is in flight', function () {

    test('01 - the click inside the window WAITS for the verdict and sends exactly once, never before the settle', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on — the harness served it off').toBe(true);

        await fillInsideWindow(page, seen);
        await page.click('#parent-submit');

        await expect.poll(() => posts.length, {
            message: '#B346 — the click inside the in-flight window must submit once the verdict lands',
            timeout: 10000
        }).toBe(1);
        await page.waitForTimeout(800); // absorb any late duplicate
        expect(posts.length, 'exactly ONE POST — a duplicate means two completion dispatches').toBe(1);
        expect(seen.queryAnswered, 'the settle must have happened for the send to be verdict-backed').toBeGreaterThanOrEqual(1);
        expect(posts[0], 'the POST must never precede the query settle (#B332 would be back)')
            .toBeGreaterThanOrEqual(seen.queryAnsweredAt);
    });

    test('02 - positive control: the SAME scene with the query settled first sends exactly once', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on').toBe(true);

        await page.click('#parent x-agree button');
        await page.fill('#note', 'someone@example.com');

        // The ONLY difference from §01: let the in-flight query settle first.
        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(200);

        await page.click('#parent-submit');
        await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
        await page.waitForTimeout(800);
        expect(posts.length,
            'outside the window the same scene must send exactly once — otherwise §01 proves nothing').toBe(1);
    });

    test('03 - a FAILING verdict landed on the waiting click blocks the send, renders the error, and releases the latch', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":false}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on').toBe(true);

        await fillInsideWindow(page, seen);
        await page.click('#parent-submit');

        // The fix-pin of this arm: the click must START a visible cycle — the
        // loading state arms on the trigger while the pass waits for the
        // verdict (#B247 composition; pre-fix the refused click armed nothing,
        // which is exactly the dead-button experience #B346 is about).
        const midWait = await page.evaluate(() =>
            (document.getElementById('parent-submit').getAttribute('data-gina-loading') || ''));
        expect(midWait, 'the waiting click must arm the loading state — a dead button is the bug').toBe('true');

        // wait past the settle + the whole completion path
        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(1200);

        expect(posts.length, 'a failing verdict must block the send entirely').toBe(0);

        const state = await page.evaluate(() => {
            const el = document.querySelector('#parent [name="agree"]');
            return {
                errAttr: (el && el.getAttribute('data-gina-form-errors')) || '',
                latch: String(window.gina.validator.$forms['parent'].isSubmitting)
            };
        });
        expect(state.errAttr.indexOf('query') > -1,
            'the query error must render on the field, got: ' + JSON.stringify(state)).toBe(true);
        expect(state.latch === 'true',
            'the latch must be RELEASED after the rejected completion (#B192), got: ' + state.latch).toBe(false);
    });

    test('04 - a second click during the wait is refused by the re-entry belt: still exactly one POST', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        await fillInsideWindow(page, seen);

        await page.click('#parent-submit');
        await page.waitForTimeout(120);
        await page.click('#parent-submit'); // inside the wait — the belt must refuse it

        await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
        await page.waitForTimeout(800);
        expect(posts.length, 'the re-entry belt must hold: one cycle, one POST').toBe(1);
    });

    test('05 - the wrapped-label door: a span-targeted click inside the window waits and sends exactly once', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on').toBe(true);

        // Recreate the #B308 canonical shape on the live trigger: the click
        // then targets the SPAN (no `.type`), the click proxy's submit branch
        // never fires, and the native activation surfaces as a TRUSTED submit
        // at the proxy gate — the door slice 1's click carve-out never touches.
        await page.evaluate(() => {
            const b = document.getElementById('parent-submit');
            b.textContent = '';
            const s = document.createElement('span');
            s.id = 'parent-submit-label';
            s.textContent = 'Submit';
            b.appendChild(s);
        });

        await fillInsideWindow(page, seen);
        await page.click('#parent-submit-label');

        // The pass must be visibly ALIVE while it waits (#B247 parity — the
        // loading arm's own #B346 carve-out; pre-fix the refusal armed nothing).
        const midWait = await page.evaluate(() =>
            (document.getElementById('parent-submit').getAttribute('data-gina-loading') || ''));
        expect(midWait, 'the waiting wrapped-label submission must arm the loading state').toBe('true');

        await expect.poll(() => posts.length, {
            message: '#B346 slice 2 — a wrapped-label click inside the window must submit once the verdict lands',
            timeout: 10000
        }).toBe(1);
        await page.waitForTimeout(800);
        expect(posts.length, 'exactly ONE POST').toBe(1);
        expect(posts[0], 'the POST must never precede the settle').toBeGreaterThanOrEqual(seen.queryAnsweredAt);
    });

    test('06 - the programmatic door: $forms.submit() inside the window latches, waits, and sends exactly once', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        await fillInsideWindow(page, seen);

        // An UNTRUSTED programmatic submit skips the gesture gate entirely —
        // pre-fix it ran the fresh-validate pass UN-latched and its completion
        // starved (display-only re-validation; this pass's callback never ran).
        await page.evaluate(() => window.gina.validator.getFormById('parent').submit());

        await expect.poll(() => posts.length, {
            message: '#B346 slice 2 — a programmatic submit inside the window must complete on the settle',
            timeout: 10000
        }).toBe(1);
        await page.waitForTimeout(800);
        expect(posts.length, 'exactly ONE POST — the latch must hold the pass together').toBe(1);
        expect(posts[0], 'the POST must never precede the settle').toBeGreaterThanOrEqual(seen.queryAnsweredAt);

        const latch = await page.evaluate(() => String(window.gina.validator.$forms['parent'].isSubmitting));
        expect(latch === 'true', 'the latch must be released after the send left, got: ' + latch).toBe(false);
    });

    test('07 - authored aria-disabled still refuses inside the window (the carve-out must not override authors)', async ({ page }) => {
        const seen  = await installInFlightScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        await page.evaluate(() => document.getElementById('parent-submit').setAttribute('aria-disabled', 'true'));

        await fillInsideWindow(page, seen);
        // force: Playwright's actionability check counts aria-disabled as NOT
        // enabled and would time out without ever dispatching (the documented
        // harness trap) — force delivers a real trusted click, which is the
        // whole point: the FRAMEWORK's gate must do the refusing, not the
        // harness.
        await page.click('#parent-submit', { force: true });

        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(1200);
        expect(posts.length,
            'an AUTHORED aria-disabled must keep refusing even in a pending window').toBe(0);

        // FIRING CONTROL for the zero above: §01 — the identical scene and
        // gesture minus the authored mark, sending exactly once in this same
        // file. An in-arm "remove the mark and re-click" control is NOT usable
        // here: measured, the force-click's refusal runs revealValidationState,
        // whose own pass on a not-last query form STARVES its callback (the
        // pre-existing async-completion shape), so the gate never re-syncs in
        // this contaminated scene and a post-settle click cannot fire — on the
        // pre-fix and post-fix bundle alike. NB this arm is green on the
        // pre-slice-2 bundle too (the refusal fires for BOTH reasons there);
        // its job is to guard the carve-out from ever widening onto authored
        // marks.
    });
});
