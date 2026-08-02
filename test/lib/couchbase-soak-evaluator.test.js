'use strict';
/**
 * script/soak/couchbase-soak.js — pure-helper unit suite (#CN12).
 *
 * The soak harness itself needs a live Couchbase cluster and is operator/
 * consumer-invoked only — what CI can and does verify are its PURE parts,
 * exported for exactly this purpose: option parsing, the duration parser,
 * the least-squares RSS slope, and the pass/fail evaluator (including the
 * headline criterion: a premature CLEAN exit 0 is a FAILURE).
 *
 * Requiring the script is side-effect-free (`require.main === module` guard);
 * a test below pins that property so a refactor cannot silently turn the
 * module load into a harness run.
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path   = require('path');

var soak = require(path.join(__dirname, '..', '..', 'script', 'soak', 'couchbase-soak.js'));

var BASE_ARGS = [
    '--host=127.0.0.1', '--database=soakbucket',
    '--username=u', '--password=p', '--sdk=4.6.1'
];

/**
 * Builds a healthy cumulative-sample series for the evaluator tests.
 *
 * @param   {number} n            - sample count
 * @param   {object} [o]          - overrides
 * @param   {function} [o.rss]    - (i) => rssBytes
 * @param   {function} [o.arm]    - (i, arm) => counter object
 * @param   {string[]} [o.arms]
 * @returns {Array} samples
 */
function buildSamples(n, o) {
    o = o || {};
    var arms = o.arms || ['query', 'kv', 'session'];
    var out = [];
    for (var i = 0; i < n; i++) {
        var s = { tMs: (i + 1) * 5000, rssBytes: o.rss ? o.rss(i) : 150 * 1024 * 1024, arms: {} };
        for (var a = 0; a < arms.length; a++) {
            s.arms[arms[a]] = o.arm
                ? o.arm(i, arms[a])
                : { ok: (i + 1) * 50, errTransient: 0, errPermanent: 0, transport: 0 };
        }
        out.push(s);
    }
    return out;
}

var TH = { rssSlopeMBperMin: 5, rssFloorMB: 50, driftFactor: 2, driftMinErrors: 20 };

/** @param {object} verdict @param {string} check @returns {?object} */
function failure(verdict, check) {
    return verdict.failures.filter(function (f) { return f.check === check; })[0] || null;
}

// ─── 01 — module shape ──────────────────────────────────────────────────────

describe('01 - module load is pure and exports the documented surface', function () {

    it('exports the pure helpers', function () {
        ['parseArgs', 'parseDuration', 'lsqSlopeMBperMin', 'evaluateRun'].forEach(function (k) {
            assert.equal(typeof soak[k], 'function', k + ' exported');
        });
        assert.ok(soak.DEFAULTS && typeof soak.DEFAULTS === 'object');
        assert.deepEqual(soak.VALID_ARMS, ['query', 'kv', 'session']);
    });

    it('guards execution behind require.main (source pin)', function () {
        var src = require('fs').readFileSync(
            path.join(__dirname, '..', '..', 'script', 'soak', 'couchbase-soak.js'), 'utf8');
        assert.ok(src.indexOf('if (require.main === module) { main(); }') > -1,
            'the main() call must stay behind the require.main guard');
    });
});

// ─── 02 — parseDuration ─────────────────────────────────────────────────────

describe('02 - parseDuration', function () {

    it('parses s / m / h forms and bare seconds', function () {
        assert.equal(soak.parseDuration('90s'), 90000);
        assert.equal(soak.parseDuration('15m'), 900000);
        assert.equal(soak.parseDuration('1h'), 3600000);
        assert.equal(soak.parseDuration('45'), 45000);
        assert.equal(soak.parseDuration('1.5m'), 90000);
    });

    it('rejects garbage, negatives, zero and null', function () {
        assert.equal(soak.parseDuration('abc'), null);
        assert.equal(soak.parseDuration('-5m'), null);
        assert.equal(soak.parseDuration('0'), null);
        assert.equal(soak.parseDuration(null), null);
        assert.equal(soak.parseDuration('5d'), null);
    });
});

// ─── 03 — parseArgs ─────────────────────────────────────────────────────────

describe('03 - parseArgs', function () {

    it('accepts the minimal valid form and applies defaults', function () {
        var r = soak.parseArgs(BASE_ARGS);
        assert.equal(r.ok, true, r.error || '');
        assert.equal(r.opts.protocol, 'couchbase://');
        assert.equal(r.opts.durationMs, 900000);
        assert.equal(r.opts.concurrency, 8);
        assert.deepEqual(r.opts.arms, ['query', 'kv', 'session']);
        assert.equal(r.opts.sessionDatabase, 'soakbucket');
        assert.equal(r.opts.durability, null);
        assert.equal(r.opts.thresholds.rssSlopeMBperMin, 5);
        assert.equal(r.opts.thresholds.driftMinErrors, 20);
    });

    it('requires each of host/database/username/password', function () {
        ['--host=', '--database=', '--username=', '--password='].forEach(function (prefix) {
            var args = BASE_ARGS.filter(function (a) { return a.indexOf(prefix) !== 0; });
            var r = soak.parseArgs(args);
            assert.equal(r.ok, false);
            assert.match(r.error, /missing required option/);
        });
    });

    it('requires exactly one of --sdk / --sdk-path (neither fails)', function () {
        var r = soak.parseArgs(BASE_ARGS.filter(function (a) { return a.indexOf('--sdk=') !== 0; }));
        assert.equal(r.ok, false);
        assert.match(r.error, /exactly one of --sdk/);
    });

    it('requires exactly one of --sdk / --sdk-path (both fails)', function () {
        var r = soak.parseArgs(BASE_ARGS.concat(['--sdk-path=/tmp/couchbase']));
        assert.equal(r.ok, false);
        assert.match(r.error, /exactly one of --sdk/);
    });

    it('validates --arms membership and rejects an empty list', function () {
        var bad = soak.parseArgs(BASE_ARGS.concat(['--arms=query,uploads']));
        assert.equal(bad.ok, false);
        assert.match(bad.error, /invalid --arms/);
        var empty = soak.parseArgs(BASE_ARGS.concat(['--arms=']));
        assert.equal(empty.ok, false);
        var subset = soak.parseArgs(BASE_ARGS.concat(['--arms=kv,session']));
        assert.equal(subset.ok, true);
        assert.deepEqual(subset.opts.arms, ['kv', 'session']);
    });

    it('rejects a sub-10s duration and unparseable durations', function () {
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--duration=5s'])).ok, false);
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--duration=soon'])).ok, false);
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--duration=30s'])).ok, true);
    });

    it('accepts only `majority` for --durability', function () {
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--durability=majority'])).opts.durability, 'majority');
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--durability=paranoid'])).ok, false);
    });

    it('applies threshold overrides and rejects non-numeric ones', function () {
        var r = soak.parseArgs(BASE_ARGS.concat(['--rss-slope=12', '--drift-min=5']));
        assert.equal(r.opts.thresholds.rssSlopeMBperMin, 12);
        assert.equal(r.opts.thresholds.driftMinErrors, 5);
        assert.equal(soak.parseArgs(BASE_ARGS.concat(['--concurrency=lots'])).ok, false);
    });

    it('rejects unrecognized argument shapes', function () {
        var r = soak.parseArgs(BASE_ARGS.concat(['duration=15m']));
        assert.equal(r.ok, false);
        assert.match(r.error, /unrecognized argument/);
    });
});

// ─── 04 — lsqSlopeMBperMin ──────────────────────────────────────────────────

describe('04 - lsqSlopeMBperMin', function () {

    it('reads 0 for a flat series and for degenerate input', function () {
        var flat = [1, 2, 3, 4].map(function (i) { return { tMs: i * 60000, rssBytes: 200 * 1024 * 1024 }; });
        assert.equal(soak.lsqSlopeMBperMin(flat), 0);
        assert.equal(soak.lsqSlopeMBperMin([]), 0);
        assert.equal(soak.lsqSlopeMBperMin([{ tMs: 0, rssBytes: 1 }]), 0);
    });

    it('recovers a known linear slope (60 MB over 1 minute = 60 MB/min)', function () {
        var pts = [0, 1, 2, 3].map(function (i) {
            return { tMs: i * 20000, rssBytes: (100 + i * 20) * 1024 * 1024 };
        });
        var slope = soak.lsqSlopeMBperMin(pts);
        assert.ok(Math.abs(slope - 60) < 0.001, 'got ' + slope);
    });
});

// ─── 05 — evaluateRun ───────────────────────────────────────────────────────

describe('05 - evaluateRun: the filed pass criteria', function () {

    it('passes a healthy full-duration run', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(20), armsRequested: ['query', 'kv', 'session'], thresholds: TH
        });
        assert.equal(v.pass, true, JSON.stringify(v.failures));
        assert.equal(v.failures.length, 0);
        assert.ok(v.metrics.arms.query.ok > 0);
    });

    it('FAILS a premature CLEAN exit 0 — and says so in those terms', function () {
        var v = soak.evaluateRun({
            plannedMs: 900000,
            endedEarly: { atMs: 120000, exit: { code: 0, signal: null } },
            samples: buildSamples(10), armsRequested: ['query'], thresholds: TH
        });
        assert.equal(v.pass, false);
        var f = failure(v, 'liveness');
        assert.ok(f, 'liveness failure present');
        assert.match(f.detail, /CLEAN exit 0/);
        assert.match(f.detail, /FAILURE/);
    });

    it('FAILS a premature crash (exit code) and a signal death', function () {
        var crash = soak.evaluateRun({
            plannedMs: 900000, endedEarly: { atMs: 60000, exit: { code: 1, signal: null } },
            samples: buildSamples(8), armsRequested: ['query'], thresholds: TH
        });
        assert.ok(failure(crash, 'liveness'));
        assert.match(failure(crash, 'liveness').detail, /exit code 1/);
        var sig = soak.evaluateRun({
            plannedMs: 900000, endedEarly: { atMs: 60000, exit: { code: null, signal: 'SIGSEGV' } },
            samples: buildSamples(8), armsRequested: ['query'], thresholds: TH
        });
        assert.match(failure(sig, 'liveness').detail, /SIGSEGV/);
    });

    it('FAILS outright on fewer than 2 samples (no evidence)', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null, samples: [],
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(v.pass, false);
        assert.ok(failure(v, 'samples'));
    });

    it('FAILS unbounded RSS growth (steep slope + real tail growth)', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(30, { rss: function (i) { return (150 + i * 15) * 1024 * 1024; } }),
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(v.pass, false);
        var f = failure(v, 'rss');
        assert.ok(f, JSON.stringify(v));
        assert.match(f.detail, /tail RSS slope/);
    });

    it('PASSES a large but FLAT RSS (absolute size is not the criterion)', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(30, { rss: function () { return 900 * 1024 * 1024; } }),
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(failure(v, 'rss'), null);
        assert.equal(v.pass, true);
    });

    it('skips the RSS check with a warning under 6 samples', function () {
        var v = soak.evaluateRun({
            plannedMs: 60000, endedEarly: null,
            samples: buildSamples(4, { rss: function (i) { return (150 + i * 100) * 1024 * 1024; } }),
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(failure(v, 'rss'), null);
        assert.ok(v.warnings.some(function (w) { return /rss check skipped/.test(w); }));
    });

    it('FAILS error-rate drift (errors concentrated in the tail)', function () {
        var v = soak.evaluateRun({
            plannedMs: 600000, endedEarly: null,
            samples: buildSamples(20, {
                arm: function (i) {
                    // ops slow down as errors mount; all 40 errors land in the tail
                    return {
                        ok           : Math.min(i + 1, 10) * 100,
                        errTransient : i >= 10 ? (i - 9) * 4 : 0,
                        errPermanent : 0,
                        transport    : 0
                    };
                }
            }),
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(v.pass, false);
        assert.ok(failure(v, 'error-drift'), JSON.stringify(v.metrics));
    });

    it('PASSES a steady (non-drifting) error rate', function () {
        var v = soak.evaluateRun({
            plannedMs: 600000, endedEarly: null,
            samples: buildSamples(20, {
                arm: function (i) {
                    return { ok: (i + 1) * 100, errTransient: (i + 1) * 3, errPermanent: 0, transport: 0 };
                }
            }),
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(failure(v, 'error-drift'), null, JSON.stringify(v.failures));
        assert.equal(v.pass, true);
    });

    it('FAILS a requested arm that did zero successful work', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(10, {
                arm: function (i, arm) {
                    return arm === 'kv'
                        ? { ok: 0, errTransient: 0, errPermanent: (i + 1) * 5, transport: 0 }
                        : { ok: (i + 1) * 50, errTransient: 0, errPermanent: 0, transport: 0 };
                }
            }),
            armsRequested: ['query', 'kv'], thresholds: TH
        });
        assert.equal(v.pass, false);
        var f = failure(v, 'dead-arm');
        assert.ok(f);
        assert.match(f.detail, /`kv`/);
    });

    it('FAILS a requested arm with no counters at all, and ignores unrequested arms', function () {
        var v = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(10, { arms: ['query'] }),   // session never sampled
            armsRequested: ['query', 'session'], thresholds: TH
        });
        assert.equal(v.pass, false);
        assert.match(failure(v, 'dead-arm').detail, /`session`.*no counters/);

        var ignored = soak.evaluateRun({
            plannedMs: 300000, endedEarly: null,
            samples: buildSamples(10),                        // kv+session sampled but NOT requested
            armsRequested: ['query'], thresholds: TH
        });
        assert.equal(ignored.pass, true);
        assert.equal(Object.keys(ignored.metrics.arms).length, 1);
    });

    it('transport errors count toward an arm\'s error totals', function () {
        var v = soak.evaluateRun({
            plannedMs: 600000, endedEarly: null,
            samples: buildSamples(20, {
                arm: function (i) {
                    return {
                        ok           : Math.min(i + 1, 10) * 100,
                        errTransient : 0,
                        errPermanent : 0,
                        transport    : i >= 10 ? (i - 9) * 4 : 0
                    };
                }
            }),
            armsRequested: ['kv'], thresholds: TH
        });
        assert.equal(v.pass, false);
        assert.ok(failure(v, 'error-drift'));
    });
});
