'use strict';
/**
 * couchbase-soak.js — #CN12: connector-level SDK × Server soak harness
 * (couchbase first).
 *
 * Screens a Couchbase Node SDK candidate (e.g. an SDK bump under evaluation)
 * against a caller-chosen Couchbase Server BEFORE a consuming project adopts
 * it: the harness scaffolds a throwaway gina project in FULL ISOLATION
 * (self-bootstrapping gina home under os.tmpdir(), HOME override — the real
 * ~/.gina and real projects are never touched), installs the CANDIDATE SDK
 * into that project (the connector resolves `couchbase` from the project's
 * own node_modules, so the install IS the version selector), builds and
 * boots the bundle for the prod env, then drives the connector's three
 * surfaces under sustained concurrent load for a fixed duration:
 *
 *   query   — N1QL entity methods through the connector's real dispatch
 *             (`adhoc: false`, positional params, `$scope` substitution),
 *             including a `request_plus` scan-consistency arm;
 *   kv      — KV through the entity `getConnection()` collection handle, in
 *             BOTH forms consumers use: the 4-arg optional-callback form
 *             (`coll.insert(key, doc, opts, cb)`) and the promise form
 *             (insert → get → periodic remove cycle, expiry-bounded);
 *   session — the couchbase express-session store (set/get/touch/destroy
 *             churn through real HTTP requests with rotating cookie jars).
 *
 * PASS CRITERIA (the whole point — aimed at the silent-death class where a
 * process under sustained SDK load exits cleanly with no JS stack):
 *   1. the bundle process SURVIVES the full duration — ANY premature exit,
 *      explicitly INCLUDING a clean `exit 0`, is a FAILURE;
 *   2. no unbounded RSS growth (least-squares slope over the tail half of
 *      the samples above --rss-slope MB/min AND total tail growth above
 *      --rss-floor MB fails);
 *   3. no error-rate drift (tail-half error rate above --drift-factor × the
 *      whole-run rate, with at least --drift-min tail errors, fails);
 *   4. every requested arm actually did work (an arm with zero successful
 *      operations fails — a dead arm is not a passing arm).
 *
 * Exit codes: 0 = PASS · 1 = FAIL (criteria) · 2 = harness/setup error.
 *
 * HONEST LIMITATION: a generic soak is a SCREEN, not proof. It exercises the
 * connector's real code paths under load, but not your application's workload
 * shape — run it as the FIRST filter on an SDK-bump candidate, with your own
 * workload-shaped soak as the second gate. Recommended usage is two runs:
 * first your current known-good SDK (baseline — also calibrates the RSS and
 * drift thresholds on your hardware), then the candidate.
 *
 * REQUIREMENTS on the target (use a SCRATCH bucket, never a production one):
 *   - the bucket exists and the credentials can read/write it;
 *   - N1QL query service available; the harness issues
 *     `CREATE PRIMARY INDEX IF NOT EXISTS` on the bucket at setup (the query
 *     arm needs an index; USE KEYS and KV arms do not);
 *   - network reachability from this machine (preflighted; --skip-preflight
 *     to bypass);
 *   - `npm` on PATH (installs the candidate SDK + express-session into the
 *     throwaway project — network access required unless --sdk-path).
 *
 * Operator/consumer-invoked ONLY — never wired into the test suite or CI
 * (CI has no cluster). Results land in ./tmp/couchbase-soak-<stamp>/
 * (gitignored): samples.ndjson, boot.log, report.json, report.txt.
 *
 * Usage:
 *   node script/soak/couchbase-soak.js \
 *     --host=127.0.0.1 --database=soakbucket \
 *     --username=Administrator --password=secret \
 *     --sdk=4.6.1 --duration=15m
 *
 * Options (defaults):
 *   --host=              (required) cluster host(s), comma-separated
 *   --database=          (required) bucket name (also the models/ dir name)
 *   --username=          (required) RBAC user
 *   --password=          (required) RBAC password
 *   --sdk=               couchbase npm version/range to install (XOR --sdk-path)
 *   --sdk-path=          absolute path to an existing couchbase install dir
 *                        (symlinked into the throwaway project instead of npm)
 *   --protocol=couchbase://   couchbases:// for TLS clusters
 *   --session-database=  bucket for the session store entry (default: --database)
 *   --duration=15m       soak length (30s / 15m / 1h forms)
 *   --concurrency=8      concurrent driver workers (round-robined over arms)
 *   --arms=query,kv,session   subset selection
 *   --durability=        `majority` adds DurabilityLevel.Majority to the
 *                        callback-form KV insert (needs cluster support; off
 *                        by default — topology-dependent)
 *   --kv-expiry=3600     expiry (s) stamped on soak KV documents
 *   --sample-interval=5  seconds between /soak/stats samples
 *   --rss-slope=5        FAIL threshold: tail RSS slope in MB/min
 *   --rss-floor=50       FAIL threshold: minimum tail RSS growth in MB
 *   --drift-factor=2     FAIL threshold: tail error rate vs whole-run rate
 *   --drift-min=20       FAIL threshold: minimum tail errors to call drift
 *   --setup-timeout=90   seconds allowed for the in-bundle setup route
 *   --start-port-from=9840   port scan base for the throwaway bundle
 *   --skip-preflight     skip the TCP reachability check
 *   --keep               keep the throwaway home + project for forensics
 *
 * @module script/soak/couchbase-soak
 */

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var net    = require('net');
var http   = require('http');
var { spawn, spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Pure helpers (exported for the unit suite — no I/O, no process state)
// ---------------------------------------------------------------------------

/**
 * Default option values + failure thresholds (exported so the unit suite and
 * the docs can pin them).
 * @constant
 * @type {object}
 */
var DEFAULTS = {
    protocol       : 'couchbase://',
    duration       : '15m',
    concurrency    : 8,
    arms           : ['query', 'kv', 'session'],
    kvExpiry       : 3600,
    sampleInterval : 5,
    rssSlope       : 5,      // MB/min over the tail half
    rssFloor       : 50,     // MB minimum tail growth before slope can fail
    driftFactor    : 2,      // tail error rate vs whole-run error rate
    driftMin       : 20,     // minimum tail errors before drift can fail
    setupTimeout   : 90,     // seconds
    startPortFrom  : 9840
};

var VALID_ARMS = ['query', 'kv', 'session'];

/**
 * Parses a human duration (`90s`, `15m`, `2h`; a bare number means seconds)
 * into milliseconds.
 *
 * @param   {string|number} v
 * @returns {number|null} milliseconds, or null when unparseable/non-positive
 */
function parseDuration(v) {
    if (v == null) { return null; }
    var m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i);
    if (!m) { return null; }
    var n = parseFloat(m[1]);
    if (!(n > 0)) { return null; }
    var unit = (m[2] || 's').toLowerCase();
    var mult = (unit === 'h') ? 3600000 : (unit === 'm') ? 60000 : 1000;
    return Math.round(n * mult);
}

/**
 * Parses argv (`--name=value` / bare `--flag` forms) into a validated options
 * object. Pure: no process access, no exit — callers decide what to do with
 * `{ error }`.
 *
 * @param   {string[]} argv - arguments AFTER the script path (process.argv.slice(2))
 * @returns {{ok: boolean, error: (string|null), opts: (object|null)}}
 */
function parseArgs(argv) {
    var raw = {};
    for (var i = 0; i < argv.length; i++) {
        var a = argv[i];
        if (a.indexOf('--') !== 0) { return { ok: false, error: 'unrecognized argument: ' + a, opts: null }; }
        var eq = a.indexOf('=');
        if (eq === -1) { raw[a.slice(2)] = true; }
        else { raw[a.slice(2, eq)] = a.slice(eq + 1); }
    }

    function intOpt(name, dflt) {
        if (raw[name] == null) { return dflt; }
        var n = parseInt(raw[name], 10);
        return isNaN(n) ? NaN : n;
    }
    function numOpt(name, dflt) {
        if (raw[name] == null) { return dflt; }
        var n = parseFloat(raw[name]);
        return isNaN(n) ? NaN : n;
    }

    var required = ['host', 'database', 'username', 'password'];
    for (var r = 0; r < required.length; r++) {
        if (!raw[required[r]] || raw[required[r]] === true) {
            return { ok: false, error: 'missing required option: --' + required[r], opts: null };
        }
    }
    var hasSdk = !!raw.sdk && raw.sdk !== true;
    var hasSdkPath = !!raw['sdk-path'] && raw['sdk-path'] !== true;
    if (hasSdk === hasSdkPath) {   // neither, or both
        return { ok: false, error: 'exactly one of --sdk=<version> or --sdk-path=<dir> is required (the SDK candidate under test must be explicit — there is no default)', opts: null };
    }

    var durationMs = parseDuration(raw.duration || DEFAULTS.duration);
    if (durationMs == null || durationMs < 10000) {
        return { ok: false, error: 'invalid --duration (10s minimum; forms: 90s / 15m / 1h): ' + raw.duration, opts: null };
    }

    // raw.arms == null means "not given" (defaults apply); an explicit
    // `--arms=` (empty) is a selection of zero arms and must error below.
    var armsRaw = (raw.arms == null) ? DEFAULTS.arms.join(',') : String(raw.arms);
    var arms = armsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var badArms = arms.filter(function (a) { return VALID_ARMS.indexOf(a) === -1; });
    if (!arms.length || badArms.length) {
        return { ok: false, error: 'invalid --arms (valid: ' + VALID_ARMS.join(',') + '): ' + (badArms.join(',') || '(empty)'), opts: null };
    }

    if (raw.durability != null && raw.durability !== 'majority') {
        return { ok: false, error: 'invalid --durability (only `majority` is supported): ' + raw.durability, opts: null };
    }

    var opts = {
        host            : String(raw.host),
        database        : String(raw.database),
        username        : String(raw.username),
        password        : String(raw.password),
        protocol        : String(raw.protocol || DEFAULTS.protocol),
        sdk             : hasSdk ? String(raw.sdk) : null,
        sdkPath         : hasSdkPath ? String(raw['sdk-path']) : null,
        sessionDatabase : String(raw['session-database'] || raw.database),
        durationMs      : durationMs,
        concurrency     : intOpt('concurrency', DEFAULTS.concurrency),
        arms            : arms,
        durability      : raw.durability === 'majority' ? 'majority' : null,
        kvExpiry        : intOpt('kv-expiry', DEFAULTS.kvExpiry),
        sampleIntervalMs: numOpt('sample-interval', DEFAULTS.sampleInterval) * 1000,
        thresholds      : {
            rssSlopeMBperMin : numOpt('rss-slope', DEFAULTS.rssSlope),
            rssFloorMB       : numOpt('rss-floor', DEFAULTS.rssFloor),
            driftFactor      : numOpt('drift-factor', DEFAULTS.driftFactor),
            driftMinErrors   : intOpt('drift-min', DEFAULTS.driftMin)
        },
        setupTimeoutMs  : intOpt('setup-timeout', DEFAULTS.setupTimeout) * 1000,
        startPortFrom   : intOpt('start-port-from', DEFAULTS.startPortFrom),
        skipPreflight   : !!raw['skip-preflight'],
        keep            : !!raw.keep
    };

    var numeric = ['concurrency', 'kvExpiry', 'sampleIntervalMs', 'setupTimeoutMs', 'startPortFrom'];
    for (var n = 0; n < numeric.length; n++) {
        if (isNaN(opts[numeric[n]]) || opts[numeric[n]] <= 0) {
            return { ok: false, error: 'invalid numeric option near --' + numeric[n], opts: null };
        }
    }
    for (var t in opts.thresholds) {
        if (isNaN(opts.thresholds[t]) || opts.thresholds[t] < 0) {
            return { ok: false, error: 'invalid threshold option near ' + t, opts: null };
        }
    }
    return { ok: true, error: null, opts: opts };
}

/**
 * Least-squares slope of RSS over time, in MB per minute.
 *
 * @param   {Array<{tMs: number, rssBytes: number}>} points
 * @returns {number} slope in MB/min (0 for fewer than 2 points)
 */
function lsqSlopeMBperMin(points) {
    if (!points || points.length < 2) { return 0; }
    var n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
        var x = points[i].tMs / 60000;             // minutes
        var y = points[i].rssBytes / (1024 * 1024); // MB
        sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    var denom = n * sxx - sx * sx;
    if (denom === 0) { return 0; }
    return (n * sxy - sx * sy) / denom;
}

/**
 * Evaluates a completed (or prematurely ended) soak run against the filed
 * pass criteria. Pure — feed it the recorded inputs, get the verdict.
 *
 * Sample shape (counters are CUMULATIVE totals at sample time):
 *   { tMs, rssBytes, arms: { <arm>: { ok, errTransient, errPermanent, transport } } }
 *
 * @param   {object}  input
 * @param   {number}  input.plannedMs      - requested soak duration
 * @param   {?object} input.endedEarly     - null, or {atMs, exit: {code, signal}}
 * @param   {Array}   input.samples        - chronological samples (shape above)
 * @param   {string[]} input.armsRequested - arms the run was asked to drive
 * @param   {object}  input.thresholds     - {rssSlopeMBperMin, rssFloorMB, driftFactor, driftMinErrors}
 * @returns {{pass: boolean, failures: Array<{check: string, detail: string}>, warnings: string[], metrics: object}}
 */
function evaluateRun(input) {
    var failures = [];
    var warnings = [];
    var metrics  = {};
    var th       = input.thresholds || {};
    var samples  = input.samples || [];

    // 1 — liveness: the process must survive the full duration. A clean
    // exit 0 before the end IS the failure class this harness exists for.
    if (input.endedEarly) {
        var ex = input.endedEarly.exit || {};
        var how = (ex.code === 0)
            ? 'a CLEAN exit 0 — this is the silent-death class, and it counts as FAILURE'
            : (ex.signal ? 'signal ' + ex.signal : 'exit code ' + ex.code);
        failures.push({
            check  : 'liveness',
            detail : 'bundle process ended after ' + Math.round(input.endedEarly.atMs / 1000) + 's of a planned '
                   + Math.round(input.plannedMs / 1000) + 's soak (' + how + ')'
        });
    }

    // 0 — evidence floor: a run with (almost) no samples proves nothing.
    if (samples.length < 2) {
        failures.push({ check: 'samples', detail: 'only ' + samples.length + ' sample(s) recorded — no basis for a verdict' });
        return { pass: false, failures: failures, warnings: warnings, metrics: metrics };
    }

    var last = samples[samples.length - 1];
    var tailStart = Math.floor(samples.length / 2);
    var tail = samples.slice(tailStart);

    // 2 — RSS growth over the tail half.
    if (samples.length >= 6) {
        var slope = lsqSlopeMBperMin(tail);
        var growthMB = (tail[tail.length - 1].rssBytes - tail[0].rssBytes) / (1024 * 1024);
        metrics.rssSlopeMBperMin = Math.round(slope * 100) / 100;
        metrics.rssTailGrowthMB  = Math.round(growthMB * 10) / 10;
        metrics.rssLastMB        = Math.round(last.rssBytes / (1024 * 1024));
        if (slope > th.rssSlopeMBperMin && growthMB > th.rssFloorMB) {
            failures.push({
                check  : 'rss',
                detail : 'tail RSS slope ' + metrics.rssSlopeMBperMin + ' MB/min with ' + metrics.rssTailGrowthMB
                       + ' MB tail growth (thresholds: ' + th.rssSlopeMBperMin + ' MB/min AND ' + th.rssFloorMB + ' MB)'
            });
        }
    } else {
        warnings.push('rss check skipped — fewer than 6 samples (run longer or lower --sample-interval)');
    }

    // 3 + 4 — per-arm error drift and dead arms, from cumulative counters.
    var armsRequested = input.armsRequested || [];
    metrics.arms = {};
    for (var a = 0; a < armsRequested.length; a++) {
        var arm = armsRequested[a];
        var endC   = (last.arms || {})[arm];
        var midC   = (samples[tailStart].arms || {})[arm];
        if (!endC) {
            failures.push({ check: 'dead-arm', detail: 'arm `' + arm + '` reported no counters at all' });
            continue;
        }
        var okTotal  = endC.ok || 0;
        var errTotal = (endC.errTransient || 0) + (endC.errPermanent || 0) + (endC.transport || 0);
        var opsTotal = okTotal + errTotal;
        if (okTotal === 0) {
            failures.push({ check: 'dead-arm', detail: 'arm `' + arm + '` completed zero successful operations (' + errTotal + ' errors)' });
        }
        var tailErr = 0, tailOps = 0;
        if (midC) {
            var midErr = (midC.errTransient || 0) + (midC.errPermanent || 0) + (midC.transport || 0);
            var midOps = (midC.ok || 0) + midErr;
            tailErr = errTotal - midErr;
            tailOps = opsTotal - midOps;
        }
        var overallRate = opsTotal ? errTotal / opsTotal : 0;
        var tailRate    = tailOps ? tailErr / tailOps : 0;
        metrics.arms[arm] = {
            ok: okTotal, errors: errTotal,
            overallErrRate: Math.round(overallRate * 10000) / 10000,
            tailErrRate: Math.round(tailRate * 10000) / 10000
        };
        if (tailErr >= th.driftMinErrors && tailRate > overallRate * th.driftFactor) {
            failures.push({
                check  : 'error-drift',
                detail : 'arm `' + arm + '`: tail error rate ' + metrics.arms[arm].tailErrRate
                       + ' vs whole-run ' + metrics.arms[arm].overallErrRate
                       + ' (' + tailErr + ' tail errors; thresholds: ×' + th.driftFactor + ', min ' + th.driftMinErrors + ')'
            });
        }
    }

    return { pass: failures.length === 0, failures: failures, warnings: warnings, metrics: metrics };
}

// ---------------------------------------------------------------------------
// Harness (I/O from here down — nothing below runs when require()d)
// ---------------------------------------------------------------------------

module.exports = {
    DEFAULTS         : DEFAULTS,
    VALID_ARMS       : VALID_ARMS,
    parseDuration    : parseDuration,
    parseArgs        : parseArgs,
    lsqSlopeMBperMin : lsqSlopeMBperMin,
    evaluateRun      : evaluateRun
};

/** @param {string} msg */
function log(msg) { process.stdout.write('[couchbase-soak] ' + msg + '\n'); }

/** @param {number} ms @returns {Promise} */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Builds the per-run context (paths, names, child env). Kept out of module
 * scope so require()ing this file for its pure helpers touches nothing.
 *
 * @param   {object} opts - parseArgs() output
 * @returns {object} run context
 */
function buildRunContext(opts) {
    var STAMP     = Date.now();
    var GINA_ROOT = path.resolve(__dirname, '..', '..');
    var HOME_BASE = process.env.GINA_SOAK_HOME_BASE
        ? fs.realpathSync(process.env.GINA_SOAK_HOME_BASE)
        : fs.realpathSync(os.tmpdir());
    var FAKE_HOME = path.join(HOME_BASE, 'gina-soak-' + STAMP);
    var ctx = {
        stamp     : STAMP,
        proj      : 'soak' + STAMP,
        bundle    : 'soak',
        ginaRoot  : GINA_ROOT,
        cli       : path.join(GINA_ROOT, 'bin', 'cli'),
        container : path.join(GINA_ROOT, 'bin', 'gina-container'),
        fakeHome  : FAKE_HOME,
        // neutral cwd: NOT the repo (stray `gina` self-symlink), NOT the fake
        // home (dead prod scenes when cwd holds .gina/) — a sibling dir.
        cwdDir    : FAKE_HOME + '-cwd',
        ginaHome  : path.join(FAKE_HOME, '.gina'),
        projDir   : path.join(FAKE_HOME, 'proj'),
        out       : path.join(GINA_ROOT, 'tmp', 'couchbase-soak-' + STAMP)
    };
    ctx.src = path.join(ctx.projDir, 'src', ctx.bundle);
    ctx.childEnv = Object.assign({}, process.env, {
        HOME            : FAKE_HOME,
        GINA_LOG_STDOUT : 'true'
    });
    delete ctx.childEnv.GINA_HOMEDIR;
    delete ctx.childEnv.NODE_OPTIONS;
    return ctx;
}

/**
 * Runs an offline gina CLI command against the isolated home. Exit status is
 * NOT trusted (first-run home bootstrap exits non-zero on a benign MQ
 * teardown) — callers verify on-disk state instead.
 *
 * @param   {object}   ctx
 * @param   {string[]} args
 * @returns {{status: (number|null), stdout: string, stderr: string}}
 */
function runCli(ctx, args) {
    var r = spawnSync(process.execPath, [ctx.cli].concat(args), {
        env: ctx.childEnv, cwd: ctx.cwdDir, encoding: 'utf8', timeout: 120000
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** @param {string} file @returns {object} */
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * TCP-dials one host/port with a short timeout.
 * @param   {string} host
 * @param   {number} port
 * @param   {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function dial(host, port, timeoutMs) {
    return new Promise(function (resolve) {
        var sock = new net.Socket();
        var done = false;
        function finish(v) { if (!done) { done = true; try { sock.destroy(); } catch (e) { /* ignore */ } resolve(v); } }
        sock.setTimeout(timeoutMs);
        sock.on('connect', function () { finish(true); });
        sock.on('error',   function () { finish(false); });
        sock.on('timeout', function () { finish(false); });
        sock.connect(port, host);
    });
}

/**
 * Preflight: the first configured host must accept TCP on the KV port (11210)
 * or the management port (8091) — or on its explicit :port when one is given.
 * Without this, an unreachable cluster leaves the connector in its infinite
 * reconnect backoff and the boot never becomes ready.
 *
 * @param   {object} opts
 * @returns {Promise<?string>} null when reachable, else a human explanation
 */
async function preflight(opts) {
    var first = opts.host.split(',')[0].trim();
    var m = first.match(/^(.*?):(\d+)$/);
    if (m) {
        return (await dial(m[1], parseInt(m[2], 10), 4000))
            ? null
            : first + ' did not accept TCP within 4s';
    }
    if (await dial(first, 11210, 4000)) { return null; }
    if (await dial(first, 8091, 4000))  { return null; }
    return first + ' accepted TCP on neither 11210 (KV) nor 8091 (mgmt) within 4s';
}

/**
 * Scaffolds project + bundle into the isolated home (state-file-verified) and
 * links <proj>/node_modules/gina explicitly (the CLI auto-link is unreliable
 * under an isolated home, and npm installs prune it besides).
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @returns {void} throws on failure
 */
function scaffold(ctx, opts) {
    fs.mkdirSync(ctx.projDir, { recursive: true });
    fs.mkdirSync(ctx.cwdDir, { recursive: true });
    runCli(ctx, ['project:add', '@' + ctx.proj, '--path=' + ctx.projDir]);
    if (!fs.existsSync(path.join(ctx.ginaHome, 'projects.json')) ||
        !readJSON(path.join(ctx.ginaHome, 'projects.json'))[ctx.proj]) {
        throw new Error('project:add did not register @' + ctx.proj);
    }
    relinkGina(ctx);
    runCli(ctx, ['bundle:add', ctx.bundle, '@' + ctx.proj, '--start-port-from=' + opts.startPortFrom]);
    var key = ctx.bundle + '@' + ctx.proj;
    if (!readJSON(path.join(ctx.ginaHome, 'ports.reverse.json'))[key]) {
        throw new Error('bundle:add did not register ' + key);
    }
    log('scaffolded ' + key + ' in ' + ctx.fakeHome);
}

/**
 * (Re)creates the <proj>/node_modules/gina symlink — required for the boot's
 * require('gina'), and PRUNED by every npm install in the project (npm treats
 * it as extraneous).
 * @param   {object} ctx
 * @returns {void}
 */
function relinkGina(ctx) {
    var nmDir = path.join(ctx.projDir, 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });
    var link = path.join(nmDir, 'gina');
    try { if (fs.lstatSync(link)) { return; } } catch (e) { /* absent — create */ }
    fs.symlinkSync(ctx.ginaRoot, link);
}

/**
 * Installs the SDK candidate + express-session into the throwaway project.
 * The install is the SDK selector: the connector resolves `couchbase` from
 * the project's node_modules AND derives the v3/v4 dispatch from the
 * project package.json's `dependencies.couchbase`, so both must be real.
 * With --sdk-path the install dir is symlinked and the dependency pin is
 * written from that install's own package.json version.
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @returns {void} throws on failure
 */
function installDeps(ctx, opts) {
    var pkgPath = path.join(ctx.projDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        // never let npm walk up to an ancestor package.json (worst case: this repo)
        throw new Error('scaffolded project has no package.json at ' + pkgPath + ' — refusing to npm install');
    }
    function npmi(args, label) {
        log('npm install: ' + label + ' (this may take a while — native SDK)');
        var r = spawnSync('npm', ['install'].concat(args, ['--no-audit', '--no-fund', '--loglevel=error']), {
            cwd: ctx.projDir, encoding: 'utf8', timeout: 600000
        });
        if (r.status !== 0) {
            throw new Error('npm install ' + label + ' failed (' + r.status + '):\n' + ((r.stderr || '') + (r.stdout || '')).slice(-2500));
        }
    }
    if (opts.sdk) {
        npmi(['couchbase@' + opts.sdk], 'couchbase@' + opts.sdk);
    } else {
        var sdkPkg = path.join(opts.sdkPath, 'package.json');
        if (!fs.existsSync(sdkPkg)) { throw new Error('--sdk-path has no package.json: ' + opts.sdkPath); }
        var v = readJSON(sdkPkg).version;
        var nmDir = path.join(ctx.projDir, 'node_modules');
        fs.mkdirSync(nmDir, { recursive: true });
        fs.symlinkSync(fs.realpathSync(opts.sdkPath), path.join(nmDir, 'couchbase'));
        var pkg = readJSON(pkgPath);
        pkg.dependencies = pkg.dependencies || {};
        pkg.dependencies.couchbase = v;   // the v3/v4 resolver reads this pin
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        log('symlinked SDK from ' + opts.sdkPath + ' (couchbase@' + v + ')');
    }
    npmi(['express-session'], 'express-session');
    relinkGina(ctx);   // npm pruned the extraneous symlink — restore it

    var resolved = path.join(ctx.projDir, 'node_modules', 'couchbase', 'package.json');
    if (!fs.existsSync(resolved)) { throw new Error('couchbase did not land in the project node_modules'); }
    ctx.sdkVersion = readJSON(resolved).version;
    log('SDK under test: couchbase@' + ctx.sdkVersion);
}

/**
 * Writes the soak fixture into the bundle src: connectors.json (data entry
 * named EXACTLY like the bucket + the literally-named `session` entry),
 * entity + N1QL files, routes, the soak controller, and the express-session
 * wire-in (the documented `lib.SessionStore` shape).
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @returns {void}
 */
function fixture(ctx, opts) {
    var db = opts.database;
    var confDir = path.join(ctx.src, 'config');

    // -- connectors.json — entry key == database name so the model registry
    //    (models/<entry>/) and the connector's own walk (models/<database>/)
    //    agree on one directory whichever one resolves.
    var connectors = {};
    connectors[db] = {
        connector : 'couchbase',
        protocol  : opts.protocol,
        host      : opts.host,
        database  : db,
        username  : opts.username,
        password  : opts.password
    };
    connectors.session = {
        connector : 'couchbase',
        protocol  : opts.protocol,
        host      : opts.host,
        database  : opts.sessionDatabase,
        username  : opts.username,
        password  : opts.password
    };
    fs.writeFileSync(path.join(confDir, 'connectors.json'), JSON.stringify(connectors, null, 2));

    // -- models/<db>/entities/soak.js + models/<db>/n1ql/soak/*.sql
    var entDir  = path.join(ctx.src, 'models', db, 'entities');
    var n1qlDir = path.join(ctx.src, 'models', db, 'n1ql', 'soak');
    fs.mkdirSync(entDir, { recursive: true });
    fs.mkdirSync(n1qlDir, { recursive: true });

    var durabilityLines = opts.durability === 'majority'
        ? [
            '    var couchbase = require(' + JSON.stringify(path.join(ctx.projDir, 'node_modules', 'couchbase')) + ');',
            '    var KV_OPTS = { expiry: ' + opts.kvExpiry + ', durabilityLevel: couchbase.DurabilityLevel.Majority };'
        ]
        : [
            '    var KV_OPTS = { expiry: ' + opts.kvExpiry + ' };'
        ];

    fs.writeFileSync(path.join(entDir, 'soak.js'), [
        '/**',
        ' * Soak entity — generated by script/soak/couchbase-soak.js.',
        ' * Custom KV methods are INSTANCE methods (assigned in the constructor):',
        ' * prototype-level user methods do not survive the connector\'s inherits().',
        ' */',
        'function Soak(conn, caller) {',
        '    var self = this;'
    ].concat(durabilityLines, [
        '',
        '    /**',
        '     * Callback-form KV insert — the 4-arg consumer shape:',
        '     * coll.insert(key, doc, opts, cb) on the entity collection handle.',
        '     * @param {string} key',
        '     * @param {object} doc',
        '     * @callback cb - (err, mutationResult)',
        '     */',
        '    this.kvCbInsert = function(key, doc, cb) {',
        '        doc._collection = \'soak\';',
        '        doc._scope = self._scope;',
        '        var coll = self.getConnection();',
        '        coll.insert(key, doc, KV_OPTS, cb);',
        '    };',
        '',
        '    /**',
        '     * Promise-form KV cycle: insert a fresh expiry-bounded doc, read it',
        '     * back, remove every 4th (bounds bucket growth alongside expiry).',
        '     * @param {string} key',
        '     * @param {object} doc',
        '     * @param {number} seq',
        '     * @returns {Promise<object>} the read-back content',
        '     */',
        '    this.kvPromiseCycle = async function(key, doc, seq) {',
        '        doc._collection = \'soak\';',
        '        doc._scope = self._scope;',
        '        var coll = self.getConnection();',
        '        await coll.insert(key, doc, KV_OPTS);',
        '        var got = await coll.get(key);',
        '        if (seq % 4 === 0) { await coll.remove(key); }',
        '        return got.value;',
        '    };',
        '}',
        '',
        'module.exports = Soak;',
        ''
    ]).join('\n'));

    var bt = '`';   // N1QL identifier backtick
    fs.writeFileSync(path.join(n1qlDir, 'findByWorker.sql'), [
        '/**',
        ' * @param {string} $1 worker tag',
        ' * @return {array}',
        ' */',
        'SELECT t.worker, t.seq, t.bumped',
        'FROM ' + bt + db + bt + ' t',
        'WHERE t._collection = \'soak\'',
        '  AND t._scope = $scope',
        '  AND t.worker = $1',
        'LIMIT 20'
    ].join('\n'));

    fs.writeFileSync(path.join(n1qlDir, 'findByWorkerRp.sql'), [
        '/**',
        ' * @options { consistency: "request_plus" }',
        ' * @param {string} $1 worker tag',
        ' * @return {array}',
        ' */',
        'SELECT t.worker, t.seq, t.bumped',
        'FROM ' + bt + db + bt + ' t',
        'WHERE t._collection = \'soak\'',
        '  AND t._scope = $scope',
        '  AND t.worker = $1',
        'LIMIT 20'
    ].join('\n'));

    fs.writeFileSync(path.join(n1qlDir, 'bumpByKey.sql'), [
        '/**',
        ' * @param {string} $1 document key',
        ' * @param {string} $2 bump tag',
        ' * @return {array}',
        ' */',
        'UPDATE ' + bt + db + bt + ' t',
        'USE KEYS $1',
        'SET t.bumped = $2',
        'RETURNING t.seq'
    ].join('\n'));

    // -- routes: all param-less GETs/POST — the controller rotates its own
    //    worker tags/keys server-side, so no request-param API is involved.
    fs.writeFileSync(path.join(confDir, 'routing.json'), JSON.stringify({
        '$schema'            : 'https://gina.io/schema/routing.json',
        'soak-setup'         : { url: '/soak/setup',           method: 'POST', param: { control: 'soakSetup' } },
        'soak-query'         : { url: '/soak/query',           method: 'GET',  param: { control: 'soakQuery' } },
        'soak-query-rp'      : { url: '/soak/query-rp',        method: 'GET',  param: { control: 'soakQueryRp' } },
        'soak-kv-cb'         : { url: '/soak/kv-cb',           method: 'GET',  param: { control: 'soakKvCb' } },
        'soak-kv-p'          : { url: '/soak/kv-p',            method: 'GET',  param: { control: 'soakKvPromise' } },
        'soak-session'       : { url: '/soak/session',         method: 'GET',  param: { control: 'soakSession' } },
        'soak-session-bye'   : { url: '/soak/session-destroy', method: 'GET',  param: { control: 'soakSessionDestroy' } },
        'soak-stats'         : { url: '/soak/stats',           method: 'GET',  param: { control: 'soakStats' } }
    }, null, 2));

    // -- the soak controller (replaces the scaffold default wholesale)
    fs.writeFileSync(path.join(ctx.src, 'controllers', 'controller.js'), [
        '/**',
        ' * SoakController — generated by script/soak/couchbase-soak.js.',
        ' * Counters live on `global.__soakStats` (prod bundle: load-once, but the',
        ' * global guard keeps them restart-safe and hot-reload-safe alike).',
        ' */',
        'var db = getModel(' + JSON.stringify(db) + ');',
        '',
        'function SoakController() {',
        '    var self = this;',
        '',
        '    var STATS = global.__soakStats = global.__soakStats || {',
        '        startedAt : Date.now(),',
        '        rr        : 0,',
        '        arms      : {',
        '            query   : { ok: 0, errTransient: 0, errPermanent: 0 },',
        '            kv      : { ok: 0, errTransient: 0, errPermanent: 0 },',
        '            session : { ok: 0, errTransient: 0, errPermanent: 0 }',
        '        }',
        '    };',
        '',
        '    /**',
        '     * Books one arm outcome, classified via the #CE1 stamp when present.',
        '     * @param {string} arm',
        '     * @param {?Error} err',
        '     * @returns {void}',
        '     * @inner',
        '     */',
        '    function bump(arm, err) {',
        '        var a = STATS.arms[arm];',
        '        if (!err) { a.ok++; return; }',
        '        if (err.isTransient === true) { a.errTransient++; } else { a.errPermanent++; }',
        '    }',
        '',
        '    /** @returns {string} rotating worker tag @inner */',
        '    function nextWorker() { return \'w\' + (STATS.rr++ % 8); }',
        '',
        '    this.soakSetup = function(req, res) {',
        '        if (!db || !db.soak) {',
        '            return self.renderJSON({ ok: false, error: \'model wiring incomplete: getModel(...)\' +',
        '                (db ? \'.soak missing (entities did not load)\' : \' returned nothing\') });',
        '        }',
        '        var cluster = null;',
        '        try { cluster = db.soak.getCluster(); }',
        '        catch (e) { return self.renderJSON({ ok: false, error: \'getCluster(): \' + e.message }); }',
        '        cluster.query(\'CREATE PRIMARY INDEX IF NOT EXISTS ON ' + bt + db + bt + '\', { adhoc: true })',
        '            .then(function () {',
        '                return db.soak.kvPromiseCycle(\'soak:setup:probe\', { worker: \'setup\', seq: 1 }, 1);',
        '            })',
        '            .then(function () { self.renderJSON({ ok: true, indexed: true }); })',
        '            .catch(function (e) { self.renderJSON({ ok: false, error: String(e && e.message || e) }); });',
        '    };',
        '',
        '    this.soakQuery = function(req, res) {',
        '        db.soak.findByWorker(nextWorker()).onComplete(function (err, rows) {',
        '            bump(\'query\', err);',
        '            self.renderJSON({ ok: !err, n: rows ? rows.length : 0 });',
        '        });',
        '    };',
        '',
        '    this.soakQueryRp = function(req, res) {',
        '        db.soak.findByWorkerRp(nextWorker()).onComplete(function (err, rows) {',
        '            bump(\'query\', err);',
        '            self.renderJSON({ ok: !err, n: rows ? rows.length : 0 });',
        '        });',
        '    };',
        '',
        '    this.soakKvCb = function(req, res) {',
        '        var seq = STATS.rr++;',
        '        var key = \'soak:cb:\' + process.pid + \':\' + seq;',
        '        db.soak.kvCbInsert(key, { worker: nextWorker(), seq: seq, via: \'cb\' }, function (err) {',
        '            bump(\'kv\', err);',
        '            if (err) { return self.renderJSON({ ok: false, error: String(err.message || err) }); }',
        '            // follow with a query-path mutation on the same key (UPDATE ... USE KEYS)',
        '            db.soak.bumpByKey(key, \'y\').onComplete(function (uErr) {',
        '                bump(\'query\', uErr);',
        '                self.renderJSON({ ok: !uErr });',
        '            });',
        '        });',
        '    };',
        '',
        '    this.soakKvPromise = function(req, res) {',
        '        var seq = STATS.rr++;',
        '        var key = \'soak:p:\' + process.pid + \':\' + seq;',
        '        db.soak.kvPromiseCycle(key, { worker: nextWorker(), seq: seq, via: \'p\' }, seq)',
        '            .then(function () { bump(\'kv\', null); self.renderJSON({ ok: true }); })',
        '            .catch(function (err) { bump(\'kv\', err); self.renderJSON({ ok: false, error: String(err && err.message || err) }); });',
        '    };',
        '',
        '    this.soakSession = function(req, res) {',
        '        if (!req.session) { return self.renderJSON({ ok: false, error: \'no req.session — store wiring failed\' }); }',
        '        req.session.n = (req.session.n || 0) + 1;',
        '        bump(\'session\', null);',
        '        self.renderJSON({ ok: true, n: req.session.n });',
        '    };',
        '',
        '    this.soakSessionDestroy = function(req, res) {',
        '        if (!req.session) { return self.renderJSON({ ok: false, error: \'no req.session\' }); }',
        '        req.session.destroy(function (err) {',
        '            bump(\'session\', err || null);',
        '            self.renderJSON({ ok: !err });',
        '        });',
        '    };',
        '',
        '    this.soakStats = function(req, res) {',
        '        self.renderJSON({ pid: process.pid, mem: process.memoryUsage(), stats: STATS });',
        '    };',
        '}',
        '',
        'module.exports = SoakController;',
        ''
    ].join('\n'));

    // -- bundle entry: the documented express-session wire-in (guide shape,
    //    #B167: the entry must be literally named `session`; the store takes
    //    the model layer's already-open bucket as options.db).
    fs.writeFileSync(path.join(ctx.src, 'index.js'), [
        '/**',
        ' * Soak bundle entry — generated by script/soak/couchbase-soak.js.',
        ' * Wires the couchbase express-session store per the documented shape.',
        ' */',
        'var soakApp = require(\'gina\');',
        'var expressSession = require(\'express-session\');',
        'var SessionStore = soakApp.lib.SessionStore;',
        '',
        'soakApp.onInitialize(function (event, app) {',
        '    var CouchbaseStore = new SessionStore(expressSession);',
        '    app.use(expressSession({',
        '        secret            : \'soak-\' + process.pid,',
        '        resave            : false,',
        '        saveUninitialized : false,',
        '        store             : new CouchbaseStore({',
        '            db     : getModel(\'session\').getConnection(),',
        '            prefix : \'soak:sess:\'',
        '        }),',
        '        cookie            : { maxAge: 300000 }',
        '    }));',
        '    event.emit(\'complete\', app);',
        '});',
        '',
        'soakApp.onError(function (err, req, res, next) { next(err); });',
        '',
        'soakApp.start();',
        ''
    ].join('\n'));

    log('fixture applied (connectors + entity + n1ql + routes + session wire-in)');
}

/**
 * Builds the prod release (fixture config is baked into the release tree).
 * @param   {object} ctx
 * @returns {void} throws when no prod entry point was produced
 */
function build(ctx) {
    runCli(ctx, ['bundle:build', ctx.bundle, '@' + ctx.proj, '--env=prod', '--scope=local']);
    var relRoot = path.join(ctx.projDir, 'releases', ctx.bundle, 'local', 'prod');
    var built = fs.existsSync(relRoot) && fs.readdirSync(relRoot).some(function (v) {
        return fs.existsSync(path.join(relRoot, v, 'index.js'));
    });
    if (!built) { throw new Error('bundle:build produced no prod release under ' + relRoot); }
    log('prod release built');
}

/**
 * @param   {object} ctx
 * @returns {number} the prod http/1.1 port from ports.reverse.json
 */
function resolvePort(ctx) {
    var key = ctx.bundle + '@' + ctx.proj;
    var port = null;
    try { port = readJSON(path.join(ctx.ginaHome, 'ports.reverse.json'))[key].prod['http/1.1'].http; } catch (e) { /* fall through */ }
    if (!port) { throw new Error('could not resolve the prod http/1.1 port for ' + key); }
    return port;
}

/**
 * @param   {object} ctx
 * @param   {number} port
 * @param   {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForPort(ctx, port, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve) {
        (function poll() {
            dial('127.0.0.1', port, 800).then(function (up) {
                if (up) { return resolve(true); }
                if (Date.now() >= deadline) { return resolve(false); }
                setTimeout(poll, 300);
            });
        })();
    });
}

/**
 * Boots the bundle (prod, daemonless) and records launcher exit + the bundle
 * child's pid from the `[ FRAMEWORK ][ <pid> ]` mount line. Asserts via the
 * launcher's own `App:` line that the boot really is the prod release.
 *
 * @param   {object} ctx
 * @param   {number} port
 * @returns {Promise<object>} boot handle {proc, logRef, exit, bundlePid, bootedAt}
 */
async function boot(ctx, port) {
    var env = Object.assign({}, ctx.childEnv, { NODE_ENV: 'prod' });
    var handle = { logRef: { txt: '' }, exit: { code: null, signal: null, done: false, atMs: null }, bundlePid: null };
    handle.bootedAt = Date.now();
    handle.proc = spawn(process.execPath, [ctx.container, ctx.bundle, '@' + ctx.proj], {
        env: env, cwd: ctx.cwdDir, stdio: ['ignore', 'pipe', 'pipe']
    });
    handle.proc.stdout.on('data', function (d) { handle.logRef.txt += d; });
    handle.proc.stderr.on('data', function (d) { handle.logRef.txt += d; });
    handle.proc.on('exit', function (code, signal) {
        handle.exit = { code: code, signal: signal, done: true, atMs: Date.now() - handle.bootedAt };
    });
    var opened = await waitForPort(ctx, port, 45000);
    if (!opened) {
        var note = handle.exit.done
            ? 'launcher EXITED (code ' + handle.exit.code + ', signal ' + handle.exit.signal + ') before binding'
            : 'launcher still running at deadline — a stalled boot (cluster unreachable? credentials?)';
        throw new Error('port ' + port + ' never opened. ' + note + '\n--- boot log tail:\n' + handle.logRef.txt.slice(-3000));
    }
    var pm = handle.logRef.txt.match(/\[ FRAMEWORK \]\[ (\d+) \]/);
    handle.bundlePid = pm ? parseInt(pm[1], 10) : null;
    var appLine = (handle.logRef.txt.match(/\[ gina-container \] App:.*$/m) || [''])[0];
    if (appLine && appLine.indexOf('/releases/') === -1) {
        throw new Error('boot is NOT the prod release (App: line = ' + appLine + ')');
    }
    log('booted (port ' + port + ', bundle pid ' + (handle.bundlePid || '?') + ')');
    return handle;
}

/**
 * One HTTP GET/POST against the bundle, with a hard timeout.
 *
 * @param   {object}  agent  - shared keep-alive agent
 * @param   {number}  port
 * @param   {string}  reqPath
 * @param   {object}  [o] - {method, cookies: string[], timeoutMs}
 * @returns {Promise<{status: number, body: string, setCookie: string[]}>} rejects on transport error/timeout
 */
function request(agent, port, reqPath, o) {
    o = o || {};
    return new Promise(function (resolve, reject) {
        var req = http.request({
            agent: agent, host: '127.0.0.1', port: port, path: reqPath,
            method: o.method || 'GET',
            headers: (o.cookies && o.cookies.length) ? { Cookie: o.cookies.join('; ') } : {}
        }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () {
                resolve({
                    status: res.statusCode,
                    body: Buffer.concat(chunks).toString(),
                    setCookie: res.headers['set-cookie'] || []
                });
            });
        });
        req.setTimeout(o.timeoutMs || 30000, function () { req.destroy(new Error('request timeout')); });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Runs the in-bundle setup route (primary index + KV probe) and fails loudly
 * on anything but `{ok: true}`.
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @param   {object} agent
 * @param   {number} port
 * @returns {Promise<void>}
 */
async function setupTarget(ctx, opts, agent, port) {
    var webroot = '/' + ctx.bundle;
    var r = await request(agent, port, webroot + '/soak/setup', { method: 'POST', timeoutMs: opts.setupTimeoutMs });
    var payload = null;
    try { payload = JSON.parse(r.body); } catch (e) { /* handled below */ }
    if (!payload || payload.ok !== true) {
        throw new Error('in-bundle setup failed (HTTP ' + r.status + '): '
            + (payload && payload.error ? payload.error : r.body.slice(0, 500))
            + '\nCheck: bucket exists, credentials can write it, query service up, primary index creatable.');
    }
    log('setup ok (primary index ensured + KV probe round-tripped)');
}

/**
 * Drives the load for the full duration and samples /soak/stats, composing
 * server counters + driver transport counters into evaluator-shaped samples.
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @param   {object} handle - boot handle
 * @param   {number} port
 * @returns {Promise<{samples: Array, endedEarly: ?object}>}
 */
async function drive(ctx, opts, handle, port) {
    var webroot = '/' + ctx.bundle;
    var agent = new http.Agent({ keepAlive: true, maxSockets: opts.concurrency + 4 });
    var stopFlag = { stop: false };
    var startMs = Date.now();
    var plannedEnd = startMs + opts.durationMs;
    var driver = {   // transport-level outcomes per arm (server can't see these)
        query   : { sent: 0, http200: 0, httpOther: 0, transport: 0 },
        kv      : { sent: 0, http200: 0, httpOther: 0, transport: 0 },
        session : { sent: 0, http200: 0, httpOther: 0, transport: 0 }
    };

    /**
     * @param {string} arm @param {number} idx @returns {Promise<void>} @inner
     */
    async function worker(arm, idx) {
        var seq = 0;
        var jar = [];
        while (!stopFlag.stop) {
            var reqPath;
            var o = {};
            if (arm === 'query') {
                reqPath = (seq % 3 === 2) ? '/soak/query-rp' : '/soak/query';
            } else if (arm === 'kv') {
                reqPath = (seq % 2 === 0) ? '/soak/kv-cb' : '/soak/kv-p';
            } else {
                if (seq > 0 && seq % 25 === 0) { jar = []; }               // fresh identity
                reqPath = (seq > 0 && seq % 10 === 0) ? '/soak/session-destroy' : '/soak/session';
                o.cookies = jar;
            }
            driver[arm].sent++;
            try {
                var r = await request(agent, port, webroot + reqPath, o);
                if (arm === 'session' && r.setCookie.length) {
                    jar = r.setCookie.map(function (c) { return c.split(';')[0]; });
                }
                if (r.status === 200) { driver[arm].http200++; } else { driver[arm].httpOther++; }
            } catch (e) {
                driver[arm].transport++;
                await sleep(250);   // do not spin on a dead socket
            }
            seq++;
        }
    }

    var samples = [];
    var ndjson = fs.createWriteStream(path.join(ctx.out, 'samples.ndjson'));

    /** @returns {Promise<void>} one stats sample @inner */
    async function sampleOnce() {
        try {
            var r = await request(agent, port, webroot + '/soak/stats', { timeoutMs: 4000 });
            var p = JSON.parse(r.body);
            var s = { tMs: Date.now() - startMs, rssBytes: p.mem.rss, arms: {} };
            for (var a = 0; a < opts.arms.length; a++) {
                var arm = opts.arms[a];
                var srv = (p.stats.arms || {})[arm] || {};
                s.arms[arm] = {
                    ok           : srv.ok || 0,
                    errTransient : srv.errTransient || 0,
                    errPermanent : srv.errPermanent || 0,
                    transport    : driver[arm].transport + driver[arm].httpOther
                };
            }
            // session `ok` is driver-observed (store failures surface as request
            // failures, not server counters — count successes from the wire).
            if (s.arms.session) { s.arms.session.ok = driver.session.http200; }
            samples.push(s);
            ndjson.write(JSON.stringify(s) + '\n');
        } catch (e) { /* liveness is judged below, not by one missed sample */ }
    }

    var workers = [];
    for (var w = 0; w < opts.concurrency; w++) {
        workers.push(worker(opts.arms[w % opts.arms.length], w));
    }

    var endedEarly = null;
    while (Date.now() < plannedEnd) {
        await sleep(Math.min(opts.sampleIntervalMs, plannedEnd - Date.now()));
        await sampleOnce();
        var dead = handle.exit.done
            || (handle.bundlePid && !isAlive(handle.bundlePid));
        if (dead) {
            endedEarly = {
                atMs : handle.exit.done ? handle.exit.atMs : (Date.now() - handle.bootedAt),
                exit : handle.exit.done ? { code: handle.exit.code, signal: handle.exit.signal }
                                        : { code: null, signal: null }
            };
            log('bundle process ENDED EARLY — stopping the drive');
            break;
        }
        var elapsed = Math.round((Date.now() - startMs) / 1000);
        if (elapsed % 30 < opts.sampleIntervalMs / 1000) {
            log('t+' + elapsed + 's — ' + JSON.stringify(samples.length ? samples[samples.length - 1].arms : {}));
        }
    }
    stopFlag.stop = true;
    await Promise.race([Promise.all(workers), sleep(8000)]);
    await sampleOnce();   // final counters
    ndjson.end();
    agent.destroy();
    return { samples: samples, endedEarly: endedEarly, driver: driver };
}

/**
 * @param   {number} pid
 * @returns {boolean} whether the pid is signalable
 */
function isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

/**
 * SIGTERM-drains the boot; escalates to SIGKILL after a grace period — and
 * then ALSO signals the bundle pid (gina-container forwards SIGTERM only; a
 * SIGKILLed launcher orphans the bundle child).
 *
 * @param   {object} handle
 * @returns {Promise<void>}
 */
async function drain(handle) {
    try { handle.proc.kill('SIGTERM'); } catch (e) { /* already gone */ }
    var until = Date.now() + 12000;
    while (Date.now() < until && !handle.exit.done) { await sleep(200); }
    if (!handle.exit.done) {
        try { handle.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
        if (handle.bundlePid && isAlive(handle.bundlePid)) {
            try { process.kill(handle.bundlePid, 'SIGTERM'); } catch (e) { /* ignore */ }
            await sleep(1500);
            if (isAlive(handle.bundlePid)) {
                try { process.kill(handle.bundlePid, 'SIGKILL'); } catch (e) { /* ignore */ }
            }
        }
    }
}

/**
 * Best-effort teardown: unregister + remove the throwaway home, hunt THIS
 * run's surviving processes, verify the real ~/.gina is untouched, and clear
 * stray CLI self-symlinks at the repo root (both the `gina` name and the
 * install-dir basename variant).
 *
 * @param   {object} ctx
 * @param   {object} opts
 * @returns {string[]} human-readable warnings (empty = clean)
 */
function teardown(ctx, opts) {
    var warnings = [];
    if (!opts.keep) {
        try { runCli(ctx, ['project:rm', '@' + ctx.proj, '--force']); } catch (e) { /* best effort */ }
        try { fs.rmSync(ctx.fakeHome, { recursive: true, force: true }); } catch (e) { warnings.push('could not remove ' + ctx.fakeHome + ': ' + e.message); }
        try { fs.rmSync(ctx.cwdDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    } else {
        warnings.push('--keep: left ' + ctx.fakeHome + ' and the @' + ctx.proj + ' registration in place');
    }
    try {
        var ps = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' }).stdout || '';
        ps.split('\n').forEach(function (line) {
            if (line.indexOf('@' + ctx.proj) === -1) { return; }
            var pid = parseInt(line.trim().split(/\s+/)[0], 10);
            if (pid && pid !== process.pid) {
                try { process.kill(pid, 'SIGTERM'); warnings.push('killed surviving process ' + pid); } catch (e) { /* gone */ }
            }
        });
    } catch (e) { /* ps unavailable */ }
    try {
        var realProjects = path.join(os.homedir(), '.gina', 'projects.json');
        if (fs.existsSync(realProjects) && readJSON(realProjects)[ctx.proj]) {
            warnings.push('LEAK: @' + ctx.proj + ' registered in the REAL ~/.gina/projects.json — remove it');
        }
    } catch (e) { /* ignore */ }
    try {
        var realDot = path.join(os.homedir(), '.' + ctx.proj);
        if (fs.existsSync(realDot)) {
            if (!fs.readdirSync(realDot).length) { fs.rmdirSync(realDot); }
            else { warnings.push('LEAK: non-empty ' + realDot + ' on the real home'); }
        }
    } catch (e) { /* ignore */ }
    [path.join(ctx.ginaRoot, 'gina'), path.join(ctx.ginaRoot, path.basename(ctx.ginaRoot))].forEach(function (stray) {
        try {
            if (fs.existsSync(stray) && fs.lstatSync(stray).isSymbolicLink()) {
                fs.unlinkSync(stray);
                warnings.push('removed a stray self-symlink at ' + stray);
            }
        } catch (e) { /* ignore */ }
    });
    return warnings;
}

/**
 * Entry point: setup → soak → verdict → report.
 * @returns {Promise<void>} process.exit()s with 0/1/2
 */
async function main() {
    var parsed = parseArgs(process.argv.slice(2));
    if (!parsed.ok) {
        process.stderr.write('couchbase-soak: ' + parsed.error + '\n(see the header of script/soak/couchbase-soak.js for usage)\n');
        process.exit(2);
    }
    var opts = parsed.opts;
    var ctx = buildRunContext(opts);
    fs.mkdirSync(ctx.out, { recursive: true });
    log('output dir: ' + ctx.out);
    log('arms: ' + opts.arms.join(',') + ' · duration: ' + Math.round(opts.durationMs / 1000) + 's · concurrency: ' + opts.concurrency);

    if (!opts.skipPreflight) {
        var unreachable = await preflight(opts);
        if (unreachable) {
            process.stderr.write('couchbase-soak: preflight failed — ' + unreachable + ' (use --skip-preflight to bypass)\n');
            process.exit(2);
        }
    }

    var handle = null;
    var result = null;
    var verdict = null;
    var report = { stamp: ctx.stamp, node: process.version, opts: Object.assign({}, opts, { password: '(redacted)' }) };

    try {
        scaffold(ctx, opts);
        installDeps(ctx, opts);
        fixture(ctx, opts);
        build(ctx);
        var port = resolvePort(ctx);
        handle = await boot(ctx, port);
        var agent = new http.Agent({ keepAlive: true });
        await setupTarget(ctx, opts, agent, port);
        agent.destroy();

        log('driving load for ' + Math.round(opts.durationMs / 1000) + 's ...');
        result = await drive(ctx, opts, handle, port);
    } catch (e) {
        if (handle) { await drain(handle); }
        if (handle && handle.logRef) {
            try { fs.writeFileSync(path.join(ctx.out, 'boot.log'), handle.logRef.txt); } catch (w) { /* ignore */ }
        }
        var warningsE = teardown(ctx, opts);
        warningsE.forEach(function (w) { log('teardown: ' + w); });
        process.stderr.write('couchbase-soak: SETUP/RUN error — ' + (e && e.stack || e) + '\n');
        process.exit(2);
    }

    await drain(handle);
    try { fs.writeFileSync(path.join(ctx.out, 'boot.log'), handle.logRef.txt); } catch (w) { /* ignore */ }

    verdict = evaluateRun({
        plannedMs     : opts.durationMs,
        endedEarly    : result.endedEarly,
        samples       : result.samples,
        armsRequested : opts.arms,
        thresholds    : opts.thresholds
    });

    report.sdkVersion = ctx.sdkVersion;
    report.driver     = result.driver;
    report.verdict    = verdict;
    fs.writeFileSync(path.join(ctx.out, 'report.json'), JSON.stringify(report, null, 2));

    var lines = [
        '# couchbase-soak ' + ctx.stamp,
        'node ' + process.version + ' · couchbase@' + ctx.sdkVersion + ' · target ' + opts.protocol + opts.host + '/' + opts.database,
        'planned ' + Math.round(opts.durationMs / 1000) + 's · arms ' + opts.arms.join(',') + ' · concurrency ' + opts.concurrency,
        ''
    ];
    verdict.warnings.forEach(function (w) { lines.push('WARN: ' + w); });
    verdict.failures.forEach(function (f) { lines.push('FAIL [' + f.check + ']: ' + f.detail); });
    lines.push('', 'metrics: ' + JSON.stringify(verdict.metrics), '', verdict.pass ? 'VERDICT: PASS' : 'VERDICT: FAIL');
    fs.writeFileSync(path.join(ctx.out, 'report.txt'), lines.join('\n'));
    lines.forEach(function (l) { if (l) { log(l); } });

    var warnings = teardown(ctx, opts);
    warnings.forEach(function (w) { log('teardown: ' + w); });
    log('report: ' + path.join(ctx.out, 'report.txt'));
    process.exit(verdict.pass ? 0 : 1);
}

if (require.main === module) { main(); }
