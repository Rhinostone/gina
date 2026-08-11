'use strict';

/**
 * Playwright RUNTIME e2e for #B332/#B333/#B334 — the submit-vs-async-query
 * collision, on the EXACT consumer shape the sibling spec's fixture cannot
 * reach: a submit trigger WITHOUT an id in markup, live-check OFF, and a
 * `query` rule declared last on a field.
 *
 * Why the sibling (#B295) spec stayed green through this defect: its fixture
 * button carries `id="parent-submit"`, so `getOwnedElements`' id-keyed dedup
 * caught the double collection and only ONE submit listener was ever bound.
 * An id-less button (gina auto-assigns `click.<uuid>` later) entered the
 * collection twice -> two `bindSubmitEl` listeners -> one click ran TWO
 * validate() passes; pass 2 found pass 1's `asyncCompleted.<id>` waiter,
 * zeroed its own pending-async counter and completed on the sync-only
 * verdict -> `send()` fired BEFORE the query answered (measured live: the
 * "already registered" error rendered ~200ms after the POST had left).
 *
 * Both arms strip the button id and disable live-check by rewriting the
 * served fixture HTML in flight — no fixture/server change, and each rewrite
 * carries its own extraction control so anchor drift reads as inconclusive
 * instead of silently testing the stock scene.
 *
 * Arms (each a control for the other):
 *   01 query answers {"isValid":false} after a delay -> the click must send
 *      NOTHING, ever, and the field must carry the query error state
 *      (the user-reported scene: an already-registered email)
 *   02 query answers {"isValid":true} after the same delay -> the click must
 *      send EXACTLY ONCE, after the settle (proves the instrument can see a
 *      POST, the id-less binding still submits, and no duplicate send rides
 *      the settle)
 */

const { test, expect } = require('@playwright/test');

const PORT = process.env.GINA_E2E_PORT || '3179';
const BASE = 'http://localhost:' + PORT + '/';

/** The rules literal the /face harness ships, URL-encoded into gina.onload.face.js. */
const STOCK_RULES = '{"rules":{"faceform":{"agree":{"isRequired":true}}}}';

/** `note` gains an async `query` declared LAST — the consumer shape. */
const ASYNC_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true },
            note: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } }
        }
    }
});

/**
 * The query on the FIRST field (`agree`), a sync rule on the second (`note`).
 * Field order decides whether the wire fires at all: the engine's
 * `queryFromFrontend` opens with `if (!self.isValid())` and SKIPS the XHR when
 * an earlier field's error is already adjudicated. With the query first, the
 * wire goes out before the second field is adjudicated — the consumer shape
 * where a settle arrives with OTHER errors already recorded.
 */
const ASYNC_FIRST_RULES = JSON.stringify({
    rules: {
        faceform: {
            agree: { isRequired: true, query: { url: '/uniq', method: 'GET', validIf: true } },
            note: { isRequired: true }
        }
    }
});

const QUERY_DELAY_MS = 600;

/**
 * Rewrite the served scene: async rules in, button id OUT, live-check OFF,
 * and a DELAYED `/uniq` verdict so the pre-settle window is wide enough to
 * catch a premature send.
 */
async function installScene(page, uniqBody, rulesJson) {
    rulesJson = rulesJson || ASYNC_RULES;
    const seen = { rulesRewritten: null, idStripped: null, liveCheckOff: null, queryCalls: 0, queryAnswered: 0 };

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
        let html = await (await route.fetch()).text();
        seen.idStripped   = html.indexOf(' id="parent-submit"') > -1;
        seen.liveCheckOff = html.indexOf('data-gina-form-live-check-enabled="true"') > -1;
        html = html
            .split(' id="parent-submit"').join('')
            .split('data-gina-form-live-check-enabled="true"').join('data-gina-form-live-check-enabled="false"');
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });

    await page.route('**/uniq*', async (route) => {
        seen.queryCalls++;
        await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
        seen.queryAnswered++;
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

/** Engage the FACE so the `agree` field is satisfied (same shape as the sibling spec's helper). */
async function engageFace(page) {
    await page.click('#parent x-agree button');
    await page.waitForTimeout(300);
}

/** Satisfy `agree` (FACE) and fill `note` — live-check is OFF, so no query fires here. */
async function fillFormQuietly(page) {
    await page.click('#parent x-agree button');
    await page.click('#note');
    await page.keyboard.type('someone@example.com', { delay: 15 });
    // no Tab-blur settle dance: with live-check off nothing validates until the click
}

function countPosts(page) {
    const posts = [];
    page.on('request', (r) => {
        if (r.url().indexOf('/face-sink') > -1 && r.method() === 'POST') { posts.push(Date.now()); }
    });
    return posts;
}

test.describe('#B332/#B333 — id-less trigger + async query rule (live-check off)', function () {

    test('01 - a failing query blocks the send entirely (the user-reported scene)', async ({ page }) => {
        const seen  = await installScene(page, '{"isValid":false}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);
        expect(seen.liveCheckOff, 'live-check anchor drifted — scene inconclusive').toBe(true);

        await fillFormQuietly(page);
        await page.click('#parent button[type="submit"]');

        // the query must actually run (the click is what drives it, live-check off)
        await expect.poll(() => seen.queryCalls, {
            message: 'the async query rule must run on submit, or the scene proves nothing',
            timeout: 10000
        }).toBeGreaterThan(0);

        // wait past the delayed settle + completion path
        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1200);

        expect(posts.length, 'a failing async query must block the submit — nothing may POST').toBe(0);

        // the field carries the query error state (what the user sees)
        const errState = await page.evaluate(() => {
            const el = document.getElementById('note');
            return {
                errAttr: el.getAttribute('data-gina-form-errors') || '',
                ariaInvalid: el.getAttribute('aria-invalid') || ''
            };
        });
        expect(errState.errAttr.indexOf('query') > -1,
            'the note field must carry the query error marker, got: ' + JSON.stringify(errState)).toBe(true);
    });

    test('03 - #B337 skip path: an EARLIER invalid field makes the engine skip the wire, and the completion still delivers the full verdict', async ({ page }) => {
        // agree (FACE, first in the form) left unengaged: by the time note's
        // `query` applies, `self.isValid()` is already false and the engine
        // SKIPS the XHR (its known-invalid short-circuit) — releasing the
        // waiter immediately. Pre-#B337 the completion payload was scoped to
        // `note` (no query error recorded on the skip) so it read EMPTY and
        // the agree error never rendered on the submit path.
        const seen  = await installScene(page, '{"isValid":false}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        // fill ONLY note — agree stays empty/invalid
        await page.click('#note');
        await page.keyboard.type('someone@example.com', { delay: 15 });
        await page.click('#parent button[type="submit"]');
        await page.waitForTimeout(1500);

        expect(seen.queryCalls, 'the engine must SKIP the wire on a known-invalid form — a call here means the short-circuit contract changed').toBe(0);
        expect(posts.length, 'nothing may send').toBe(0);
        const errs = await page.evaluate(() => ({
            agree: (document.querySelector('#parent x-agree').getAttribute('data-gina-form-errors') || ''),
            note:  (document.getElementById('note').getAttribute('data-gina-form-errors') || '')
        }));
        expect(errs.agree.indexOf('isRequired') > -1,
            'the earlier invalid field must be marked on the submit path, got: ' + JSON.stringify(errs)).toBe(true);
        expect(errs.note.indexOf('query') > -1,
            'a skipped query must not mark the field with a query error, got: ' + JSON.stringify(errs)).toBe(false);
    });

    test('04 - #B337 branch shift, wire-real: a PASSING query with a LATER field invalid still blocks and renders', async ({ page }) => {
        // Query on the FIRST field (agree, engaged -> valid at fire time, so
        // the wire goes out), sync-invalid on the second (note, empty). At
        // settle the pass verdict is {note: isRequired}. Pre-#B337 the payload
        // was scoped to `agree` -> EMPTY set -> the validated dispatch went
        // out with no errors at all: nothing rendered, nothing focused, the
        // refusal was silent.
        const seen  = await installScene(page, '{"isValid":true}', ASYNC_FIRST_RULES);
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        await engageFace(page); // agree valid; note stays empty/invalid
        await page.click('#parent button[type="submit"]');

        await expect.poll(() => seen.queryAnswered, {
            message: 'the query must fire — agree is valid when its rules apply',
            timeout: 10000
        }).toBeGreaterThan(0);
        await page.waitForTimeout(1200);

        expect(posts.length, 'an invalid form must not send even when its query passes').toBe(0);
        const noteErr = await page.evaluate(() =>
            (document.getElementById('note').getAttribute('data-gina-form-errors') || ''));
        expect(noteErr.indexOf('isRequired') > -1,
            'the invalid non-query field must be marked when the query passes, got: ' + JSON.stringify(noteErr)).toBe(true);
    });

    test('05 - #B337 wire-real, both invalid: a FAILING query and a sync-invalid sibling BOTH render', async ({ page }) => {
        // Same order as arm 04 but the query fails too: the settle payload
        // must carry BOTH fields (pre-#B337 it carried only the query field).
        const seen  = await installScene(page, '{"isValid":false}', ASYNC_FIRST_RULES);
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        await engageFace(page);
        await page.click('#parent button[type="submit"]');

        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1200);

        expect(posts.length, 'nothing may send').toBe(0);
        const errs = await page.evaluate(() => ({
            agree: (document.querySelector('#parent x-agree').getAttribute('data-gina-form-errors') || ''),
            note:  (document.getElementById('note').getAttribute('data-gina-form-errors') || '')
        }));
        expect(errs.agree.indexOf('query') > -1,
            'the failing query must be marked, got: ' + JSON.stringify(errs)).toBe(true);
        expect(errs.note.indexOf('isRequired') > -1,
            'the sibling sync error must be marked too, got: ' + JSON.stringify(errs)).toBe(true);
    });

    test('06 - #B338: a SECOND click on an unchanged value (cached verdict) still delivers the whole verdict', async ({ page }) => {
        // Click 1 settles over the wire (both errors render — arm 05's scene).
        // Click 2 hits the engine's same-value CACHE, which used to release
        // synchronously MID-FIELD-LOOP: the payload composed before `note` was
        // adjudicated, `note` vanished from the verdict and its rendered error
        // was CLEARED. The release is a microtask now, so both clicks take the
        // same post-loop completion shape.
        const seen  = await installScene(page, '{"isValid":false}', ASYNC_FIRST_RULES);
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        // capture the verdict keys each dispatch delivers
        await page.evaluate(() => {
            window.__verdicts = [];
            document.getElementById('parent').addEventListener('validate.parent', (e) => {
                const errs = (e.detail && (e.detail.error || e.detail.fields)) || {};
                window.__verdicts.push(Object.keys(errs).filter(k => k !== 'count'));
            }, true);
        });

        await engageFace(page); // agree valid at fire time -> the wire goes out; note stays empty
        await page.click('#parent button[type="submit"]');
        await expect.poll(() => seen.queryAnswered, { timeout: 10000 }).toBeGreaterThan(0);
        await page.waitForTimeout(1200);

        const wireCallsAfterClick1 = seen.queryCalls;
        await page.click('#parent button[type="submit"]'); // unchanged value -> cache path
        await page.waitForTimeout(1200);

        expect(posts.length, 'nothing may send in either click').toBe(0);
        expect(seen.queryCalls, 'click 2 must answer from the cache — no second wire call').toBe(wireCallsAfterClick1);
        const state = await page.evaluate(() => ({
            verdicts: window.__verdicts,
            noteMsg: (document.getElementById('gina-errormessage-parent-note') || {}).textContent || ''
        }));
        const last = state.verdicts[state.verdicts.length - 1] || [];
        expect(last.indexOf('note') > -1,
            'the cached-verdict click must still carry the sync-invalid sibling, got: ' + JSON.stringify(state.verdicts)).toBe(true);
        expect(state.noteMsg.length > 0,
            'the sibling\'s rendered error must survive the second click').toBe(true);
    });

    test('02 - positive control: a passing query sends EXACTLY once, after the settle', async ({ page }) => {
        const seen  = await installScene(page, '{"isValid":true}');
        const posts = countPosts(page);

        await gotoFaceAndBoot(page);
        expect(seen.rulesRewritten, 'rules anchor drifted — scene inconclusive').toBe(true);
        expect(seen.idStripped, 'button-id anchor drifted — scene inconclusive').toBe(true);

        await fillFormQuietly(page);
        const clickedAt = Date.now();
        await page.click('#parent button[type="submit"]');

        await expect.poll(() => posts.length, {
            message: 'a valid form with a passing query must send',
            timeout: 10000
        }).toBeGreaterThan(0);
        await page.waitForTimeout(1500); // room for any duplicate to surface

        expect(posts.length, 'exactly ONE POST per click — a duplicate means a second validation cycle survived').toBe(1);
        expect(posts[0] - clickedAt,
            'the POST must not leave before the delayed query settles').toBeGreaterThanOrEqual(QUERY_DELAY_MS - 50);
    });
});
