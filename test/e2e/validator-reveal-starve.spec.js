/**
 * #B348 — `revealValidationState`'s completion STARVES on a form whose async
 * `query` field is not declared last, so the reveal's documented self-heal
 * (error render/clear + focus + gate re-sync) silently never runs there.
 *
 * MEASURED MECHANISM (staked from the #B346 arm-07 anatomy probe; re-walked
 * branch-by-branch on the current tree at fix time): the reveal's `validate()`
 * arms a waiter, and the waiter's completion chain has three dispatching
 * branches — terminal errors>0, `isSubmitting`-latched (#B342), last-field —
 * plus a display-only live-check else-if. A reveal pass is un-latched, writes
 * neither the latch nor `isValidating`, and on a VALID form its verdict is
 * clean, so with the query field not last it matches NOTHING: the terminal
 * block sets `eventTriggered` and falls through, `onDisabledTriggerReveal`
 * never executes, the stale `data-gina-form-submit-gated` marker never
 * re-syncs, and every later click is refused against a marker that can no
 * longer heal — a dead form (measured live: two post-settle clicks on a
 * fully valid form, 0 POSTs).
 *
 * THE FIX: the reveal's callback carries a completion identity
 * (`onDisabledTriggerReveal.isRevealCompletion = true` — the engine's own
 * `cb._data`/`cb._errors` property idiom), and the waiter's chain gains ONE
 * else-if after the display-only live-check arm, gated on the SAME terminal
 * condition the errors>0 block uses (`hasParsedAllRules && asyncCount <= 0`,
 * which is what stops a multi-query-field early wake): a terminal reveal
 * completion that matched no other branch dispatches `validated.<formId>`
 * with its own cb. Every previously-working shape is byte-identical; the
 * un-latched programmatic-submit starve (#B347) is DELIBERATELY untouched —
 * its cb carries no marker, and its own entry gates any fix on a repro.
 *
 * SCENE (probe-derived, mirrors the recorded anatomy's end state): the query
 * rides the FIRST field (`agree`), required `note` after it. Bind-time
 * adjudication of the empty form marks the gate and commits note's
 * isRequired. Engage the FACE (agree settles valid); a force-click is then
 * REFUSED (note's committed error blocks the #B346 carve-out) and the
 * ERRORED reveal completes via the terminal errors>0 branch — rendering
 * note's error, keeping the gate: correct, and the control that the reveal
 * wiring itself works. Then `note` becomes valid through a deliberately
 * SILENT channel (the HTMLInputElement PROTOTYPE value setter, bypassing any
 * per-element interception): no validation pass runs, so nothing
 * re-adjudicates — leaving [values all valid + gate marked + stale committed
 * error + nothing pending], the exact state the staking probe measured under
 * real-interaction timing (flow probes confirmed ordinary interaction orders
 * heal the gate on their own, which is why the live measurement needed the
 * settle window; the silent write is the deterministic road to the same
 * state). Every precondition is an EXPLICIT expect, so an impossible scene
 * voids loudly instead of passing for the wrong reason.
 *
 * Then: click1 (refused -> CLEAN reveal -> heal), poll the marker away,
 * click2 -> exactly ONE POST.
 *
 * Red-first (validated before the fix landed): against the pre-fix bundle
 * arm 01 fails with the starve signature — the marker survives click1 and no
 * POST ever leaves — while arm 02 (query-LAST control, the last-field branch
 * dispatches today) passes on the same bytes, pinning the defect to field
 * order.
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/** Query on the FIRST-declared field, a required field AFTER it — the starving shape. */
const ASYNC_FIRST_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } },
            note: { isRequired: true }
        }
    }
});

/** Control shape: query on the LAST field — the last-field branch already dispatches there. */
const ASYNC_LAST_RULES = JSON.stringify({
    rules: {
        faceform: {
            note: { isRequired: true },
            agree: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } }
        }
    }
});

async function installScene(page, rulesJson) {
    const seen = { rulesRewritten: null, liveCheckSeen: null, queryCalls: 0, queryAnswered: 0 };

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

    await page.route('**/face', async (route) => {
        const html = await (await route.fetch()).text();
        // The gate marker only exists with live-check ON (updateSubmitTriggerState's
        // gating branch is live-check-conditional) — assert, don't assume.
        seen.liveCheckSeen = html.indexOf('data-gina-form-live-check-enabled="true"') > -1;
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });

    await page.route('**/uniq*', async (route) => {
        seen.queryCalls++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"isValid":true}' });
        seen.queryAnswered++;
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

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(Date.now()); }
    });
    return posts;
}

/** One page-side read of everything the preconditions and verdicts need. */
async function readGateState(page) {
    return page.evaluate(() => {
        const trigger = document.getElementById('parent-submit');
        const form = document.getElementById('parent');
        const pending = form ? form.querySelector('[data-gina-form-validator-query-pending]') : null;
        const rec = (window.gina && window.gina.validator && window.gina.validator.$forms)
            ? window.gina.validator.$forms['parent'] : null;
        let errCount = null;
        if (rec && rec.errors) {
            errCount = 0;
            for (const k in rec.errors) { if (Object.prototype.hasOwnProperty.call(rec.errors, k)) { errCount++; } }
        }
        return {
            gated: trigger ? trigger.getAttribute('data-gina-form-submit-gated') : null,
            pendingMarker: pending ? true : false,
            errCount: errCount,
            noteVal: (document.getElementById('note') || {}).value || ''
        };
    });
}

/**
 * Drive the scene to [values all valid + gate marked + stale committed error
 * + nothing pending] — the probe-derived construction described in the
 * header. Each step's outcome is an explicit precondition expect.
 */
async function reachValidWithStaleGate(page, seen) {
    // Bind-time adjudication of the empty form marks the gate.
    await expect.poll(async () => (await readGateState(page)).gated, {
        message: 'precondition: the bind-time pass must mark the gate on the empty form',
        timeout: 8000
    }).toBe('true');

    // Engage the FACE — agree becomes valid, its query fires and settles.
    await page.click('#parent x-agree button');
    await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await readGateState(page)).pendingMarker, {
        message: 'precondition: no query may still be pending',
        timeout: 10000
    }).toBe(false);
    await page.waitForTimeout(1200); // drain the settle's completion tails

    // The ERRORED reveal control: note's committed isRequired blocks the
    // #B346 carve-out, the click is refused, and the errors>0 terminal branch
    // completes the reveal — gate correctly STAYS (form still invalid).
    await page.click('#parent-submit', { force: true });
    await page.waitForTimeout(1200);
    const errored = await readGateState(page);
    expect(errored.gated, 'control: the ERRORED reveal keeps the gate on an invalid form').toBe('true');
    expect(errored.errCount, 'control: note\'s committed error must be recorded').toBeGreaterThanOrEqual(1);

    // Silent fill — the PROTOTYPE value setter bypasses any per-element
    // interception, so no validation pass runs and nothing re-adjudicates.
    await page.evaluate(() => {
        const el = document.getElementById('note');
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'someone@example.com');
    });
    await page.waitForTimeout(600);

    return readGateState(page);
}

test.describe('#B348 — the disabled-trigger reveal completes on a query-not-last form', function () {

    test('01 - a stale gate on a fully valid form HEALS on the refused click, and the next click sends exactly once', async ({ page }) => {
        const seen  = await installScene(page, ASYNC_FIRST_RULES);
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on — the harness served it off').toBe(true);

        const pre = await reachValidWithStaleGate(page, seen);
        expect(pre.noteVal, 'note must carry the valid value').not.toBe('');
        expect(pre.pendingMarker, 'nothing may be pending at the click').toBe(false);
        // THE scene gate: if something healed the marker, there is no starve
        // to exercise — void loudly, do not pass vacuously.
        expect(pre.gated,
            'SCENE INCONCLUSIVE: the gate healed before the click — the starve precondition was not manufactured').toBe('true');

        // click1 — refused against the stale marker; the CLEAN reveal must
        // COMPLETE: fresh verdict valid -> stale error display cleared ->
        // updateSubmitTriggerState(valid) -> marker gone.
        await page.click('#parent-submit', { force: true });
        await expect.poll(async () => (await readGateState(page)).gated, {
            message: '#B348 — the reveal completion must re-sync (heal) the stale gate; pre-fix it starves and the marker survives',
            timeout: 8000
        }).toBe(null);
        expect(posts.length, 'the refused click itself must never send').toBe(0);

        // click2 — the healed gate admits the gesture: exactly one POST.
        await page.click('#parent-submit');
        await expect.poll(() => posts.length, {
            message: '#B348 — the NEXT gesture after the heal must go through',
            timeout: 10000
        }).toBe(1);
        await page.waitForTimeout(800); // absorb any late duplicate
        expect(posts.length, 'exactly ONE POST — a duplicate means two completion dispatches').toBe(1);
    });

    test('02 - positive control: the SAME construction with the query field declared LAST heals on the pre-fix bytes (last-field branch)', async ({ page }) => {
        const seen  = await installScene(page, ASYNC_LAST_RULES);
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.liveCheckSeen, 'this scene REQUIRES live-check on').toBe(true);

        const pre = await reachValidWithStaleGate(page, seen);
        expect(pre.noteVal).not.toBe('');
        expect(pre.gated,
            'SCENE INCONCLUSIVE: the control must start from the same stale-gate state').toBe('true');

        // Identical clicks; the last-field branch dispatches the reveal here,
        // so this arm is green on the PRE-fix bytes — pinning arm 01's red to
        // field order rather than to anything else in the construction.
        await page.click('#parent-submit', { force: true });
        await expect.poll(async () => (await readGateState(page)).gated, { timeout: 8000 }).toBe(null);
        await page.click('#parent-submit');
        await expect.poll(() => posts.length, { timeout: 10000 }).toBe(1);
        await page.waitForTimeout(800);
        expect(posts.length, 'the control shape must send exactly once').toBe(1);
    });

});
