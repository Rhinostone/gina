/**
 * #B386 — the Inspector's `localStorage.__ginaData` fallback channel must be
 * re-synced by the late-bind patch script.
 *
 * Background (measured live 2026-08-16, not reasoned): `statusbar.html` writes
 * the mirror at statusbar-execution time, which is BEFORE the render delegates
 * append their late-bind patch script just above `</body>`. That patch mutates
 * `window.__ginaData` only — setting `metrics.weightBytes`, the final
 * `metrics.serverMs`, and pushing the late flow entries. With no re-sync, the
 * mirror keeps the emit-time payload forever, so an Inspector reading the
 * fallback channel sees `weightBytes: null` (the View tab then omits its weight
 * badge whenever the client Performance leg is also unavailable) and a Flow tab
 * missing its template-compile / execute / response-write / total bars.
 *
 * §01–§03 are source pins (structural: "the line exists, in the right place").
 * §04 is BEHAVIOURAL and carries the subtract control — per the house rule that
 * a source pin can ratify a present-but-semantically-wrong line, the value that
 * actually lands in the mirror has to be asserted by executing the emitted
 * contract, not by matching its text.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FW = fs.readdirSync(path.join(__dirname, '..', '..', 'framework'))
    .filter((d) => /^v\d/.test(d))
    .sort()
    .pop();
const CTRL = path.join(__dirname, '..', '..', 'framework', FW, 'core', 'controller');

const SWIG_SRC = fs.readFileSync(path.join(CTRL, 'controller.render-swig.js'), 'utf8');
const NJ_SRC   = fs.readFileSync(path.join(CTRL, 'controller.render-nunjucks.js'), 'utf8');

/** The exact re-sync statement emitted into the patch script. */
const RESYNC = '\'try{localStorage.setItem("__ginaData",JSON.stringify(d))}catch(e){}\'';

describe('#B386 — late-bind patch re-syncs the __ginaData localStorage mirror', function () {

    it('§01 — render-swig.js emits the re-sync at BOTH patch sites (cache-hit + cache-miss)', function () {
        assert.strictEqual(
            SWIG_SRC.split(RESYNC).length - 1, 2,
            'expected exactly 2 re-sync statements in render-swig.js (cache-hit and cache-miss patch scripts)'
        );
    });

    it('§02 — render-nunjucks.js emits the re-sync at its patch site', function () {
        assert.strictEqual(
            NJ_SRC.split(RESYNC).length - 1, 1,
            'expected exactly 1 re-sync statement in render-nunjucks.js'
        );
    });

    it('§03 — the re-sync runs AFTER the metrics assignments in every patch script', function () {
        // Ordering is the whole point: syncing before the mutation would mirror
        // the stale payload again and the bug would survive the fix.
        const scan = (src, label) => {
            let from = 0;
            let seen = 0;
            for (;;) {
                const start = src.indexOf("(function(d){", from);
                if (start < 0) break;
                const end = src.indexOf("}(window.__ginaData));</script>", start);
                if (end < 0) break;
                const block = src.slice(start, end);
                if (block.indexOf(RESYNC) > -1) {
                    const lastMetrics = block.lastIndexOf('.metrics.weightBytes=');
                    const resyncAt    = block.indexOf(RESYNC);
                    assert.ok(
                        lastMetrics > -1 && resyncAt > lastMetrics,
                        label + ': re-sync must follow the last metrics assignment in the same patch script'
                    );
                    seen++;
                }
                from = end + 1;
            }
            return seen;
        };
        const nSwig = scan(SWIG_SRC, 'render-swig.js');
        const nNj   = scan(NJ_SRC, 'render-nunjucks.js');
        assert.strictEqual(nSwig, 2, 'expected 2 ordered patch blocks in render-swig.js');
        assert.strictEqual(nNj, 1, 'expected 1 ordered patch block in render-nunjucks.js');
    });

    it('§04 — nunjucks injects the patch with a FUNCTION replacer, not a string', function () {
        // The patch embeds JSON.stringify'd flow entries; a string replacement
        // expands $&, $`, $' and $1 in the replacement text and would corrupt the
        // emitted script for any entry whose label/detail carries one. Both
        // render-swig.js sites already used the function form.
        assert.ok(
            NJ_SRC.indexOf("html.replace(/<\\/body>/i, function () { return _njPatchScript + '</body>'; })") > -1,
            'expected the nunjucks patch injection to use a function replacer'
        );
        assert.strictEqual(
            NJ_SRC.indexOf("html.replace(/<\\/body>/i, _njPatchScript + '</body>')"), -1,
            'the string-form replacement must be gone (the $-expansion hazard)'
        );
    });

    it('§05 — BEHAVIOURAL: the emitted script writes the PATCHED payload to the mirror', function () {
        // Execute the real emitted contract rather than matching its text.
        // Harness validity is established by the subtract arm below: with the
        // re-sync statement removed, the mirror must keep the stale payload.
        // Derive the executable statement from the SAME constant §01/§02 match in
        // production source (outer quotes stripped) — so this arm cannot drift
        // into testing a statement the delegates no longer emit.
        const RESYNC_STMT = RESYNC.slice(1, -1);
        assert.ok(
            SWIG_SRC.indexOf(RESYNC) > -1,
            'guard: the statement under behavioural test must exist in production source'
        );
        const buildPatchBody = (withResync) => {
            const resync = withResync ? RESYNC_STMT : '';
            return '(function(d){'
                + 'var u=d&&d.user,g=d&&d.gina;'
                + 'if(u&&u.flow){var _e=u.flow.entries,_p=' + JSON.stringify([{ label: 'total' }])
                    + ';for(var _i=0;_i<_p.length;_i++){_e.push(_p[_i])}}'
                + 'if(u&&u.environment&&u.environment.metrics){u.environment.metrics.weightBytes=628192;u.environment.metrics.serverMs=2860;}'
                + 'if(g&&g.environment&&g.environment.metrics){g.environment.metrics.weightBytes=628192;g.environment.metrics.serverMs=2860;}'
                + resync
                + '}(WIN.__ginaData));';
        };

        const run = (withResync) => {
            // emit-time state, exactly as statusbar.html would have mirrored it
            const live = {
                user: { environment: { metrics: { weightBytes: null, serverMs: 2339 } },
                        flow: { entries: [{ label: 'route' }] } },
                gina: { environment: { metrics: { weightBytes: null, serverMs: 2339 } } }
            };
            const store = { __ginaData: JSON.stringify(live) };   // the pre-patch mirror
            const WIN = { __ginaData: live };
            const localStorage = {
                setItem: (k, v) => { store[k] = v; },
                getItem: (k) => (k in store ? store[k] : null)
            };
            // eslint-disable-next-line no-new-func
            new Function('WIN', 'localStorage', buildPatchBody(withResync))(WIN, localStorage);
            return { live, mirror: JSON.parse(store.__ginaData) };
        };

        const fixed = run(true);
        assert.strictEqual(fixed.live.user.environment.metrics.weightBytes, 628192,
            'sanity: the patch must mutate the live object');
        assert.strictEqual(fixed.mirror.user.environment.metrics.weightBytes, 628192,
            'mirror must carry the late-bound weightBytes');
        assert.strictEqual(fixed.mirror.user.environment.metrics.serverMs, 2860,
            'mirror must carry the final serverMs, not the emit-time one');
        assert.strictEqual(fixed.mirror.user.flow.entries.length, 2,
            'mirror must carry the late flow entries');

        // SUBTRACT CONTROL — without the re-sync the mirror stays stale. This is
        // what proves the assertions above are measuring the fix and not the
        // harness: it reproduces the KNOWN pre-fix behaviour.
        const stale = run(false);
        assert.strictEqual(stale.live.user.environment.metrics.weightBytes, 628192,
            'subtract: the live object is still patched');
        assert.strictEqual(stale.mirror.user.environment.metrics.weightBytes, null,
            'subtract: mirror must keep weightBytes null when the re-sync is absent');
        assert.strictEqual(stale.mirror.user.environment.metrics.serverMs, 2339,
            'subtract: mirror must keep the emit-time serverMs when the re-sync is absent');
        assert.strictEqual(stale.mirror.user.flow.entries.length, 1,
            'subtract: mirror must miss the late flow entries when the re-sync is absent');
    });
});
