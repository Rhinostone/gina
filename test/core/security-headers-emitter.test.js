/**
 * #OW1 — engine-agnostic security-header emission (OWASP A02).
 *
 * WHY THE EMITTER EXISTS AT ALL — the finding this suite must not let regress:
 * the `#HDR1-14` plugins are express middleware, and gina's DEFAULT engine is
 * `isaac`, which never runs the express middleware chain for HTTP responses.
 * `server.use()` stores functions in `server._expressMiddlewares`, and the ONLY
 * consumer is the WebSocket session binder, which name-filters the chain to
 * `session` / `ginaSessionAbsoluteTimeout` and runs it against an INERT response
 * whose header methods are all no-ops. So mounting the orchestrator emits ZERO
 * headers on the default engine — §05 pins that structural fact, because if it
 * ever changes, this whole module's reason for existing changes with it.
 *
 * The default set is deliberately NARROWER than the orchestrator's 12-plugin
 * "safe set": that set is safe to MOUNT deliberately, not to DEFAULT ON for
 * every existing bundle. Four are opt-in, each with a NAMED breakage —
 * `corp` (measured conflict with gina's own `access-control-allow-origin: *`
 * `/_gina/*` endpoints), `hsts` (180-day commitment, emitted over http too),
 * `coop` (severs window.opener → OAuth popups), `xFrameOptions` (breaks
 * deliberate cross-origin embedding).
 *
 * Values are asserted against each plugin's OWN constant, not retyped here, so
 * a framework default can never silently diverge from the mounted plugin (§04).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path   = require('path');
const fs     = require('fs');

const ROOT    = path.join(__dirname, '..', '..');
const FW      = path.join(ROOT, 'framework');
const version = fs.readdirSync(FW).filter(d => /^v/.test(d))[0];
const FWV     = path.join(FW, version);

const emitter = require(path.join(FWV, 'lib', 'security-headers-emitter', 'src', 'main.js'));

/** Minimal setHeader/getHeader-shaped response double. */
function makeRes() {
    const h = {};
    return {
        _h: h,
        headersSent: false,
        setHeader: function (k, v) { h[String(k).toLowerCase()] = v; },
        getHeader: function (k) { return h[String(k).toLowerCase()]; }
    };
}

const TIER_A = [
    'x-content-type-options',
    'x-download-options',
    'x-permitted-cross-domain-policies',
    'x-xss-protection',
    'referrer-policy',
    'x-dns-prefetch-control',
    'origin-agent-cluster'
];
const TIER_B = [
    'x-frame-options',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy'
];

describe('01 - default set: Tier A on, Tier B off', function () {

    it('01.1 - an unconfigured bundle gets exactly the seven Tier-A headers', function () {
        const res = makeRes();
        emitter.applyToResponse(undefined, { url: '/page' }, res);
        assert.deepStrictEqual(Object.keys(res._h).sort(), TIER_A.slice().sort());
    });

    it('01.2 - no Tier-B header is emitted by default', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: true }, { url: '/page' }, res);
        TIER_B.forEach(function (h) {
            assert.strictEqual(typeof res._h[h], 'undefined', h + ' must be opt-in, never a default');
        });
    });

    it('01.3 - each Tier-B header is reachable with a single key', function () {
        [['xFrameOptions', 'x-frame-options'],
         ['coop',          'cross-origin-opener-policy'],
         ['corp',          'cross-origin-resource-policy']
        ].forEach(function (pair) {
            const cfg = { enabled: true };
            cfg[pair[0]] = true;
            const res = makeRes();
            emitter.applyToResponse(cfg, { url: '/page' }, res);
            assert.strictEqual(typeof res._h[pair[1]], 'string', pair[0] + ' must emit ' + pair[1] + ' when enabled');
        });
    });

    it('01.4 - a Tier-A header can be turned OFF explicitly', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: true, xDnsPrefetchControl: false }, { url: '/page' }, res);
        assert.strictEqual(typeof res._h['x-dns-prefetch-control'], 'undefined');
        assert.strictEqual(res._h['x-content-type-options'], 'nosniff', 'the others are unaffected');
    });
});

describe('02 - the kill switch and the config shapes', function () {

    it('02.1 - enabled:false emits nothing at all', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: false }, { url: '/page' }, res);
        assert.deepStrictEqual(Object.keys(res._h), []);
    });

    it('02.2 - a non-object config falls back to defaults rather than throwing', function () {
        [null, 'nope', 42, undefined].forEach(function (raw) {
            const res = makeRes();
            assert.doesNotThrow(function () { emitter.applyToResponse(raw, { url: '/p' }, res); });
            assert.strictEqual(res._h['x-content-type-options'], 'nosniff');
        });
    });

    it('02.3 - headersSent short-circuits (never write into a committed response)', function () {
        const res = makeRes();
        res.headersSent = true;
        emitter.applyToResponse({ enabled: true }, { url: '/p' }, res);
        assert.deepStrictEqual(Object.keys(res._h), []);
    });
});

describe('03 - first-writer-wins (a mounted plugin / env.json override always beats the default)', function () {

    it('03.1 - an already-set header is never overwritten', function () {
        const res = makeRes();
        res.setHeader('x-frame-options', 'DENY');
        res.setHeader('referrer-policy', 'no-referrer');
        emitter.applyToResponse({ enabled: true, xFrameOptions: true }, { url: '/p' }, res);
        assert.strictEqual(res._h['x-frame-options'], 'DENY', 'a deliberately tuned value must survive');
        assert.strictEqual(res._h['referrer-policy'], 'no-referrer');
    });

    it('03.2 - header-object form is case-insensitive about what is already present', function () {
        // isaac writeHead sites hand-write header maps with mixed casing; a
        // case-sensitive check would emit a duplicate.
        const headers = emitter.applyToHeaders({ enabled: true }, { url: '/p' }, {
            'X-Content-Type-Options': 'nosniff-custom'
        });
        assert.strictEqual(headers['X-Content-Type-Options'], 'nosniff-custom');
        assert.strictEqual(typeof headers['x-content-type-options'], 'undefined',
            'must not add a lowercase duplicate of a header already present in another case');
    });
});

describe('04 - values match each #HDR plugin constant (no retyped drift)', function () {

    // Read the plugin's own exported constant rather than a literal in this
    // file: a framework default that diverges from the mounted plugin would
    // make the two paths emit different values for the same header.
    function pluginConst(dir, prop) {
        const P = require(path.join(FWV, 'core/plugins/lib/security-headers', dir, 'src', 'main.js'));
        return P[prop];
    }

    it('04.1 - Tier-A values equal the plugins own defaults', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: true }, { url: '/p' }, res);
        assert.strictEqual(res._h['x-content-type-options'],            pluginConst('x-content-type-options', '_HEADER_VALUE'));
        assert.strictEqual(res._h['x-download-options'],                pluginConst('x-download-options', '_HEADER_VALUE'));
        assert.strictEqual(res._h['x-xss-protection'],                  pluginConst('x-xss-protection', '_HEADER_VALUE'));
        assert.strictEqual(res._h['origin-agent-cluster'],              pluginConst('origin-agent-cluster', '_HEADER_VALUE'));
        assert.strictEqual(res._h['referrer-policy'],                   pluginConst('referrer-policy', '_DEFAULT_VALUE'));
        assert.strictEqual(res._h['x-dns-prefetch-control'],            pluginConst('x-dns-prefetch-control', '_DEFAULT_VALUE'));
        assert.strictEqual(res._h['x-permitted-cross-domain-policies'], pluginConst('x-permitted-cross-domain-policies', '_DEFAULT_VALUE'));
    });

    it('04.2 - Tier-B values equal the plugins own defaults', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: true, xFrameOptions: true, coop: true, corp: true }, { url: '/p' }, res);
        assert.strictEqual(res._h['x-frame-options'],                pluginConst('x-frame-options', '_DEFAULT_VALUE'));
        assert.strictEqual(res._h['cross-origin-opener-policy'],     pluginConst('coop', '_DEFAULT_VALUE'));
        assert.strictEqual(res._h['cross-origin-resource-policy'],   pluginConst('corp', '_DEFAULT_VALUE'));
    });
});

describe('05 - /_gina/* is exempt from the cross-origin-isolating headers', function () {

    it('05.1 - corp and coop are withheld on /_gina/* even when explicitly enabled', function () {
        const res = makeRes();
        emitter.applyToResponse({ enabled: true, coop: true, corp: true }, { url: '/_gina/metrics' }, res);
        assert.strictEqual(typeof res._h['cross-origin-resource-policy'], 'undefined',
            'gina/_gina endpoints emit access-control-allow-origin:* and are deliberately cross-origin');
        assert.strictEqual(typeof res._h['cross-origin-opener-policy'], 'undefined');
        assert.strictEqual(res._h['x-content-type-options'], 'nosniff', 'Tier A still applies there');
    });

    it('05.2 - CONTROL: the same config DOES emit them on an application route', function () {
        // Without this arm 05.1 could pass because the headers never emit at all.
        const res = makeRes();
        emitter.applyToResponse({ enabled: true, coop: true, corp: true }, { url: '/page' }, res);
        assert.strictEqual(typeof res._h['cross-origin-resource-policy'], 'string');
        assert.strictEqual(typeof res._h['cross-origin-opener-policy'], 'string');
    });

    it('05.3 - applyToGinaEndpointHeaders exempts unconditionally (no url needed)', function () {
        const headers = emitter.applyToGinaEndpointHeaders({ enabled: true, coop: true, corp: true }, {});
        assert.strictEqual(typeof headers['cross-origin-resource-policy'], 'undefined');
        assert.strictEqual(typeof headers['cross-origin-opener-policy'], 'undefined');
        assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    });

    it('05.4 - STRUCTURAL: isaac still runs NO express middleware for HTTP responses', function () {
        // The premise of this whole module. If isaac ever gains a real middleware
        // chain, the framework-side emitter may become redundant (or start
        // double-emitting) — this arm is the tripwire for that.
        const src = fs.readFileSync(path.join(FWV, 'core/server.isaac.js'), 'utf8');
        const refs = src.split('_expressMiddlewares').length - 1;
        assert.ok(refs > 0, 'control: the property must exist, or this arm proves nothing');
        // Its only read sites live in the socket session binder.
        assert.ok(/bindSocketSession/.test(src), 'control: the WS session binder is the only consumer');
        assert.match(src, /\/\^\(session\|ginaSessionAbsoluteTimeout\)\$\/|\(session\|ginaSessionAbsoluteTimeout\)/,
            'the chain is still name-filtered to session middleware only');
    });
});

describe('06 - both engines are wired to the one emitter', function () {

    it('06.1 - core/server.js calls applyToResponse beside the hidePoweredBy gate', function () {
        const src = fs.readFileSync(path.join(FWV, 'core/server.js'), 'utf8');
        assert.match(src, /lib\.securityHeadersEmitter\.applyToResponse\(/);
    });

    it('06.2 - isaac routes its writeHead sites through the gina-endpoint form', function () {
        const src = fs.readFileSync(path.join(FWV, 'core/server.isaac.js'), 'utf8');
        assert.match(src, /lib\.securityHeadersEmitter\.applyToGinaEndpointHeaders\(/);
        // and the helper it lives in is still the one every writeHead site uses
        assert.ok(src.split('_setPoweredByHeader(').length - 1 > 20,
            'the helper must still back the writeHead sites (measured 29 at time of writing)');
    });

    it('06.3 - the lib is registered and declared (registry <-> types parity)', function () {
        const idx = fs.readFileSync(path.join(FWV, 'lib/index.js'), 'utf8');
        assert.match(idx, /securityHeadersEmitter\s*:\s*require\('\.\/security-headers-emitter'\)/);
        const dts = fs.readFileSync(path.join(ROOT, 'types/index.d.ts'), 'utf8');
        assert.match(dts, /securityHeadersEmitter:/);
    });
});
