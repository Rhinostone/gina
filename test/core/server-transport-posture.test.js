/**
 * #COMPLY9 — production transport posture (ZT2).
 *
 * Outside the `local` scope a bundle resolving a cleartext scheme is served
 * exactly as configured (both engines' scheme switches default to cleartext),
 * so `core/server.js init()` now surfaces the posture at boot:
 *
 *   - default            : one console.warn naming bundle/scheme/scope + the
 *                          two remediations (never console.emerg — emerg trips
 *                          start.js's abort detection on non-fatal conditions);
 *   - server.requireHttps  === true → REFUSE to boot the cleartext bundle.
 *     The throw lands in the init() try, whose central catch emergs + flushes
 *     + exits BEFORE any listen() — pre-listen, nothing ever binds;
 *   - server.allowInsecure === true → the operator's assertion that TLS
 *     terminates upstream (mesh / ingress / reverse proxy — the documented h2c
 *     topology); the warn becomes one info line.
 *
 * Both knobs are strict booleans resolved like `scheme` itself (bundle
 * settings win, env.json's `server` block fills via the picked-keys merge);
 * a non-boolean-when-present throws (the quietly-OFF class), and setting both
 * is a boot-refused contradiction. The scope gate is NOT-local (a custom
 * scope such as `beta` is neither local nor production, so a production-keyed
 * gate would silently skip it).
 *
 * §01 pins the shipped source structurally (each positive pin red-arm
 * validated against the pre-fix blob — 0 hits before, expected count after).
 * §02 is a pure-logic replica of the decision table; the §01 whole-expression
 * pins are what tie the replica to the shipped bytes.
 *
 * Run standalone:
 *   node --test test/core/server-transport-posture.test.js
 */

var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FW     = require('../fw');
var SERVER = path.join(FW, 'core/server.js');

var BLOCK_START = '#COMPLY9 — production transport posture (ZT2)';
var BLOCK_END   = "self.emit('configured'";


describe('01 - core/server.js: transport-posture source pins', function() {

    var src, blk;

    before(function() {
        src = fs.readFileSync(SERVER, 'utf8');
        var s = src.indexOf(BLOCK_START);
        assert.ok(s > -1, 'posture block start anchor not found');
        // End-anchor slice (not a fixed window): the block ends where the
        // `configured` emit — the next statement in init() — begins.
        var e = src.indexOf(BLOCK_END, s);
        assert.ok(e > s, 'posture block end anchor not found after the start');
        blk = src.slice(s, e);
    });

    it('01.1 - the picked-keys merge threads BOTH knobs from the env.json-derived conf (settings win, conf fills)', function() {
        assert.match(src, /requireHttps\s*:\s*options\.conf\[self\.appName\]\[self\.env\]\.server\.requireHttps/,
            'requireHttps missing from the serverOpt picked-keys merge');
        assert.match(src, /allowInsecure\s*:\s*options\.conf\[self\.appName\]\[self\.env\]\.server\.allowInsecure/,
            'allowInsecure missing from the serverOpt picked-keys merge');
    });

    it('01.2 - non-boolean requireHttps refuses to boot, naming the quietly-OFF hazard', function() {
        assert.ok(blk.indexOf('`settings.json > server.requireHttps` must be a boolean') > -1,
            'requireHttps type-lint throw missing');
        assert.ok(blk.indexOf('silently UNENFORCED') > -1,
            'the type-lint message must state the quietly-OFF consequence');
    });

    it('01.3 - non-boolean allowInsecure refuses to boot', function() {
        assert.ok(blk.indexOf('`settings.json > server.allowInsecure` must be a boolean') > -1,
            'allowInsecure type-lint throw missing');
    });

    it('01.4 - both-true is a boot-refused contradiction', function() {
        assert.ok(blk.indexOf('`server.requireHttps` and `server.allowInsecure` are both true') > -1,
            'contradiction throw missing');
    });

    it('01.5 - the gate is the WHOLE expression: cleartext scheme AND not-local scope (right-anchored, so a tightening breaks the pin)', function() {
        // Whole-expression pin up to the `) {` terminator: appending a conjunct
        // (or swapping isLocalScope for a production-keyed predicate) breaks it.
        assert.match(blk, /if \( serverOpt\.scheme !== 'https' && !self\.isLocalScope\(\) \) \{/,
            'the scope-gated cleartext predicate is not the pinned whole expression');
    });

    it('01.6 - requireHttps refusal names the consequence and both remediations', function() {
        assert.ok(blk.indexOf('the listener would serve cleartext outside the local scope') > -1,
            'refusal throw missing or reworded');
        assert.ok(blk.indexOf('replace `requireHttps` with `server.allowInsecure: true`') > -1,
            'refusal must point at the upstream-TLS alternative');
    });

    it('01.7 - the default posture is console.warn (with remediation), the acknowledgment and satisfied lines are console.info', function() {
        assert.ok(blk.indexOf("console.warn('[ BUNDLE ][ server ][ init ] transport posture:") > -1,
            'default warn missing');
        assert.ok(blk.indexOf('acknowledge with `server.allowInsecure: true`') > -1,
            'warn must name the acknowledgment remediation');
        assert.ok(blk.indexOf('allowInsecure asserted (TLS terminates upstream)') > -1,
            'acknowledgment info line missing');
        assert.ok(blk.indexOf('server.requireHttps satisfied') > -1,
            'satisfied info line missing');
    });

    it('01.8 - proxy.json is advisory only: an https upstream is NAMED in the warn, never a silencing path', function() {
        assert.ok(blk.indexOf('_tpProxyNote') > -1, 'proxy advisory variable missing');
        assert.ok(blk.indexOf('i.test(process.gina.PROXY_HOSTNAME)') > -1,
            'the advisory must test PROXY_HOSTNAME');
        assert.ok(blk.indexOf('so TLS likely terminates there') > -1,
            'the advisory note text is missing');
    });

    it('01.9 - the block never emergs, never exits directly, never keys on a production-scope predicate', function() {
        // console.emerg trips start.js's abort detection (the gna.js
        // verifyCertificate history); the central init() catch owns the
        // emerg + flush + exit for the refusal throws.
        assert.doesNotMatch(blk, /console\.emerg/, 'the posture block must not emerg');
        assert.doesNotMatch(blk, /process\.exit/, 'the posture block must throw, not exit — the central catch owns the exit');
        assert.doesNotMatch(blk, /isProductionScope/, 'the gate must be not-local, never is-production (a custom scope is neither)');
    });

    it('01.10 - the lints are ordered: type lints and the contradiction precede the scope-gated branch', function() {
        var typeIdx   = blk.indexOf('`settings.json > server.requireHttps` must be a boolean');
        var contraIdx = blk.indexOf('`server.requireHttps` and `server.allowInsecure` are both true');
        var gateIdx   = blk.search(/if \( serverOpt\.scheme !== 'https' && !self\.isLocalScope\(\) \) \{/);
        assert.ok(typeIdx > -1 && contraIdx > -1 && gateIdx > -1, 'anchors missing');
        assert.ok(typeIdx < gateIdx, 'type lint must run before the scope-gated branch (scope-independent)');
        assert.ok(contraIdx < gateIdx, 'contradiction lint must run before the scope-gated branch (scope-independent)');
    });

});


// ---------------------------------------------------------------------------
// 02 — pure-logic replica of the decision table
// ---------------------------------------------------------------------------

/**
 * Replica of the `#COMPLY9` decision table in `core/server.js init()`
 * (the block between the `#COMPLY9` anchor and the `configured` emit — the
 * §01 whole-expression pins tie this mirror to the shipped bytes).
 *
 * @param   {object}  o
 * @param   {string}  o.scheme          - resolved `serverOpt.scheme`
 * @param   {boolean} o.isLocal         - `self.isLocalScope()`
 * @param   {*}       [o.requireHttps]  - `serverOpt.requireHttps`
 * @param   {*}       [o.allowInsecure] - `serverOpt.allowInsecure`
 * @param   {string}  [o.proxyHostname] - `process.gina.PROXY_HOSTNAME`
 * @returns {object}  `{ kind, key?, proxyNoted? }` — kind is one of
 *                    `refuse-type` | `refuse-contradiction` |
 *                    `refuse-cleartext` | `ack` | `warn` | `satisfied` |
 *                    `silent`
 * @inner
 * @private
 */
function resolveTransportPosture(o) {
    var requireHttps  = o.requireHttps;
    var allowInsecure = o.allowInsecure;
    if ( typeof(requireHttps) != 'undefined' && typeof(requireHttps) != 'boolean' ) {
        return { kind: 'refuse-type', key: 'requireHttps' };
    }
    if ( typeof(allowInsecure) != 'undefined' && typeof(allowInsecure) != 'boolean' ) {
        return { kind: 'refuse-type', key: 'allowInsecure' };
    }
    if ( requireHttps === true && allowInsecure === true ) {
        return { kind: 'refuse-contradiction' };
    }
    if ( o.scheme !== 'https' && !o.isLocal ) {
        if ( requireHttps === true ) {
            return { kind: 'refuse-cleartext' };
        }
        if ( allowInsecure === true ) {
            return { kind: 'ack' };
        }
        var proxyNoted = ( typeof(o.proxyHostname) != 'undefined' && /^https:\/\//i.test(o.proxyHostname) );
        return { kind: 'warn', proxyNoted: proxyNoted };
    } else if ( requireHttps === true && o.scheme === 'https' && !o.isLocal ) {
        return { kind: 'satisfied' };
    }
    return { kind: 'silent' };
}


describe('02 - decision-table replica', function() {

    it('02.1 - https in the local scope is silent', function() {
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: true }).kind, 'silent');
    });

    it('02.2 - https outside the local scope, no knobs: silent (posture satisfied)', function() {
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: false }).kind, 'silent');
    });

    it('02.3 - https outside the local scope with requireHttps: one satisfied info line', function() {
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: false, requireHttps: true }).kind, 'satisfied');
    });

    it('02.4 - cleartext in the local scope is silent, even with requireHttps armed (inert by scope)', function() {
        assert.equal(resolveTransportPosture({ scheme: 'http', isLocal: true }).kind, 'silent');
        assert.equal(resolveTransportPosture({ scheme: 'http', isLocal: true, requireHttps: true }).kind, 'silent');
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: true, requireHttps: true }).kind, 'silent');
    });

    it('02.5 - cleartext outside the local scope, no knobs: warn (the default posture)', function() {
        var v = resolveTransportPosture({ scheme: 'http', isLocal: false });
        assert.equal(v.kind, 'warn');
        assert.equal(v.proxyNoted, false);
    });

    it('02.6 - an https:// proxy.json upstream is NAMED in the warn — advisory, never silencing', function() {
        var v = resolveTransportPosture({ scheme: 'http', isLocal: false, proxyHostname: 'https://front.example.tld' });
        assert.equal(v.kind, 'warn', 'an https upstream must not silence the warn');
        assert.equal(v.proxyNoted, true);
    });

    it('02.7 - an http:// proxy.json upstream adds no note (the whole chain is cleartext)', function() {
        var v = resolveTransportPosture({ scheme: 'http', isLocal: false, proxyHostname: 'http://front.example.tld' });
        assert.equal(v.kind, 'warn');
        assert.equal(v.proxyNoted, false);
    });

    it('02.8 - allowInsecure acknowledges: cleartext outside the local scope becomes one info line', function() {
        assert.equal(resolveTransportPosture({ scheme: 'http', isLocal: false, allowInsecure: true }).kind, 'ack');
    });

    it('02.9 - requireHttps refuses a cleartext bundle outside the local scope', function() {
        assert.equal(resolveTransportPosture({ scheme: 'http', isLocal: false, requireHttps: true }).kind, 'refuse-cleartext');
    });

    it('02.10 - both true is a contradiction in EVERY scope (settings.json boots them all)', function() {
        assert.equal(resolveTransportPosture({ scheme: 'http',  isLocal: false, requireHttps: true, allowInsecure: true }).kind, 'refuse-contradiction');
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: true,  requireHttps: true, allowInsecure: true }).kind, 'refuse-contradiction');
    });

    it('02.11 - a truthy non-boolean refuses in EVERY scope (the quietly-OFF class)', function() {
        var v = resolveTransportPosture({ scheme: 'http', isLocal: true, requireHttps: 'true' });
        assert.equal(v.kind, 'refuse-type');
        assert.equal(v.key, 'requireHttps');
        v = resolveTransportPosture({ scheme: 'https', isLocal: false, allowInsecure: 1 });
        assert.equal(v.kind, 'refuse-type');
        assert.equal(v.key, 'allowInsecure');
    });

    it('02.12 - an unrecognised scheme is treated as cleartext (fail-closed: the engines default to the plain server)', function() {
        assert.equal(resolveTransportPosture({ scheme: 'spdy', isLocal: false }).kind, 'warn');
    });

    it('02.13 - false knobs behave as absent', function() {
        assert.equal(resolveTransportPosture({ scheme: 'http', isLocal: false, requireHttps: false, allowInsecure: false }).kind, 'warn');
        assert.equal(resolveTransportPosture({ scheme: 'https', isLocal: false, requireHttps: false }).kind, 'silent');
    });

});
