/**
 * Unit tests for the exec-bridge secrets tier:
 *   lib/secrets/src/backends/exec.js       — one-shot fetch + env-over-exec resolution
 *   lib/secrets/src/declaration.js         — validateBlock / validateExecSpec (shared guards)
 *   lib/secrets/src/main.js#selectBackend  — block-level dispatch (file | exec | default)
 *   lib/cmd/secrets/check.js               — the gate's exec mirror + the #B409 exit widening
 *
 * The tier's whole point is "fail fast, never hang": the fetch is a
 * SIGKILL-bounded blocking child process, so a wedged vendor endpoint
 * becomes a FAILED boot on schedule instead of a hung one. The SIGKILL is
 * load-bearing, measured: spawnSync with the default SIGTERM stays blocked
 * past its timeout against a SIGTERM-ignoring child and then reports
 * {error: ETIMEDOUT, status: 0} — which is also why every result check
 * reads `.error` BEFORE `.status` (a status-first read calls that shape a
 * success). §04's timeout arm drives exactly that child.
 *
 * stdout hygiene is asserted behaviourally, not pinned: the fetched output
 * IS the secrets payload, so §04 plants sentinels on stdout and asserts
 * they appear in NO error message, while stderr's diagnostic tail does.
 *
 * Sections:
 *   01 — module shape (exports + identity of the shared re-exports)
 *   02 — validateBlock behaviour (real bytes, direct)
 *   03 — validateExecSpec behaviour (incl. the DELIBERATE non-mirror of the
 *        file tier's `//` guard — argv elements legitimately carry URLs)
 *   04 — fetchExecMap behaviour (fixture commands, no network)
 *   05 — build + resolve (env precedence, #B268 warn parity, miss contract)
 *   06 — selectBackend dispatch (file | exec | refuse | inherit shapes)
 *   07 — source pins on the fetch's fail-fast mechanics
 *   08 — the secrets:check exec mirror (extract-and-execute, never a replica)
 *   09 — #B409: declaration errors fail the gate's exit code
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert');
var fs     = require('node:fs');
var os     = require('node:os');
var path   = require('node:path');

var FRAMEWORK_ROOT = path.join(__dirname, '..', '..', 'framework');
var frameworkDir = fs.readdirSync(FRAMEWORK_ROOT).filter(function (d) {
    return /^v\d/.test(d) && fs.existsSync(path.join(FRAMEWORK_ROOT, d, 'lib/secrets/src/backends/exec.js'));
}).sort().pop();
var FW  = path.join(FRAMEWORK_ROOT, frameworkDir);
var LIB = path.join(FW, 'lib/secrets/src');

var secrets     = require(path.join(LIB, 'main.js'));
var declaration = require(path.join(LIB, 'declaration.js'));
var execBackend = require(path.join(LIB, 'backends/exec.js'));
var envBackend  = require(path.join(LIB, 'backends/env.js'));

var EXEC_SRC  = fs.readFileSync(path.join(LIB, 'backends/exec.js'), 'utf8');
var CHECK_SRC = fs.readFileSync(path.join(FW, 'lib/cmd/secrets/check.js'), 'utf8');

var NODE = process.execPath;

/** Fixture command printing `map` as its stdout. */
function printCmd(map) {
    return [NODE, '-e', 'process.stdout.write(' + JSON.stringify(JSON.stringify(map)) + ')'];
}

function cfg(block) {
    return { content: { settings: { secrets: block } } };
}

/** Capture console.warn synchronously (resolve() is sync, so no async-restore race). */
function captureWarn(fn) {
    var warnings = [];
    var orig = console.warn;
    console.warn = function (msg) { warnings.push(String(msg)); };
    try { fn(); } finally { console.warn = orig; }
    return warnings;
}

describe('01 - module shape', function () {

    it('exec backend exports build + fetchExecMap', function () {
        assert.equal(typeof execBackend.build, 'function');
        assert.equal(typeof execBackend.fetchExecMap, 'function');
    });

    it('declaration exports validateBlock + validateExecSpec, and main.js re-exports the SAME functions', function () {
        assert.strictEqual(secrets.validateBlock, declaration.validateBlock);
        assert.strictEqual(secrets.validateExecSpec, declaration.validateExecSpec);
        assert.strictEqual(secrets.fetchExecMap, execBackend.fetchExecMap,
            'the gate must run the RUNTIME\'s own fetch, not a copy');
    });

    it('the env backend exports isPresentButEmpty (moved from the file backend — one reading of the environment)', function () {
        assert.equal(typeof envBackend.isPresentButEmpty, 'function');
        process.env.EXECTEST_EMPTY = '';
        assert.equal(envBackend.isPresentButEmpty('EXECTEST_EMPTY'), true);
        delete process.env.EXECTEST_EMPTY;
        assert.equal(envBackend.isPresentButEmpty('EXECTEST_EMPTY'), false);
    });
});

describe('02 - validateBlock behaviour', function () {

    it('accepts a file-only block, an exec-only block, and the empty inherit shape', function () {
        assert.deepEqual(declaration.validateBlock({ file: ['/etc/a.env'] }), []);
        assert.deepEqual(declaration.validateBlock({ exec: { command: ['/opt/bin/fetch'] } }), []);
        assert.deepEqual(declaration.validateBlock({}), []);
    });

    it('accepts the pinned opt-out escapes: {file: null, exec: …} and {exec: null}', function () {
        assert.deepEqual(declaration.validateBlock({ file: null, exec: { command: ['/opt/bin/fetch'] } }), []);
        assert.deepEqual(declaration.validateBlock({ exec: null }), []);
    });

    it('refuses both tiers declared at once, and the message NAMES the null escape', function () {
        var errs = declaration.validateBlock({ file: ['/etc/a.env'], exec: { command: ['/opt/bin/fetch'] } });
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'block-both-tiers');
        assert.match(errs[0].message, /"file": null/,
            'the merge of a shared file chain with a bundle exec block is the case that hits this — the way out must be in the message');
    });

    it('refuses an unknown key, naming it — a typo used to degrade SILENTLY to env-only', function () {
        var errs = declaration.validateBlock({ flie: ['/etc/a.env'] });
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'block-unknown-key');
        assert.match(errs[0].message, /`flie`/);
    });

    it('refuses a non-object block (schema parity — no runtime validator loads the schema)', function () {
        assert.equal(declaration.validateBlock('garbage')[0].code, 'block-shape');
        assert.equal(declaration.validateBlock(['/etc/a.env'])[0].code, 'block-shape');
    });
});

describe('03 - validateExecSpec behaviour', function () {

    it('accepts a minimal spec, and one with a timeout', function () {
        assert.deepEqual(declaration.validateExecSpec({ command: ['/opt/bin/fetch'] }), []);
        assert.deepEqual(declaration.validateExecSpec({ command: ['/opt/bin/fetch', '--json'], timeout: 5000 }), []);
    });

    it('refuses a non-object or array spec', function () {
        assert.equal(declaration.validateExecSpec('sops -d')[0].code, 'exec-spec-shape');
        assert.equal(declaration.validateExecSpec(['sops', '-d'])[0].code, 'exec-spec-shape');
    });

    it('refuses an unknown spec key — forward protection: a future option fails LOUDLY on an older runtime', function () {
        var errs = declaration.validateExecSpec({ command: ['/opt/bin/fetch'], format: 'env' });
        assert.equal(errs[0].code, 'exec-spec-unknown-key');
        assert.match(errs[0].message, /`format`/);
    });

    it('refuses a missing, empty, non-string-element or whitespace-element command', function () {
        assert.equal(declaration.validateExecSpec({})[0].code, 'exec-command-shape');
        assert.equal(declaration.validateExecSpec({ command: [] })[0].code, 'exec-command-shape');
        assert.equal(declaration.validateExecSpec({ command: ['/opt/bin/fetch', 7] })[0].code, 'exec-command-shape');
        assert.equal(declaration.validateExecSpec({ command: ['/opt/bin/fetch', ' '] })[0].code, 'exec-command-shape');
    });

    it('refuses a secret placeholder in an element, and that verdict WINS over the token verdict', function () {
        var errs = declaration.validateExecSpec({ command: ['/opt/bin/fetch', '${secret:API_KEY}'] });
        assert.equal(errs[0].code, 'exec-command-secret-placeholder',
            'the token regex matches a placeholder too — order is load-bearing');
    });

    it('refuses an unresolved token, naming the element', function () {
        var errs = declaration.validateExecSpec({ command: ['/opt/bin/fetch', '${nope}/f.json'] });
        assert.equal(errs[0].code, 'exec-command-unresolved-token');
        assert.match(errs[0].message, /\$\{nope\}\/f\.json/);
    });

    it('ACCEPTS an element carrying `//` — the file tier\'s empty-segment guard is deliberately NOT mirrored (URLs)', function () {
        // A vault address is the canonical case. Mirroring #B272 here would
        // false-refuse every URL-bearing command; the residual (a token
        // resolving empty inside an element) is documented, with the
        // command's own failure as the backstop.
        assert.deepEqual(declaration.validateExecSpec({ command: ['/opt/bin/fetch', '--addr', 'https://vault.internal:8200'] }), []);
    });

    it('refuses a malformed timeout; accepts null', function () {
        assert.equal(declaration.validateExecSpec({ command: ['/x'], timeout: 0 })[0].code, 'exec-timeout-shape');
        assert.equal(declaration.validateExecSpec({ command: ['/x'], timeout: -5 })[0].code, 'exec-timeout-shape');
        assert.equal(declaration.validateExecSpec({ command: ['/x'], timeout: 1.5 })[0].code, 'exec-timeout-shape');
        assert.equal(declaration.validateExecSpec({ command: ['/x'], timeout: '5000' })[0].code, 'exec-timeout-shape');
        assert.deepEqual(declaration.validateExecSpec({ command: ['/x'], timeout: null }), []);
    });
});

describe('04 - fetchExecMap behaviour (fixture commands, no network)', function () {

    it('a clean command yields its flat map, multiline values preserved', function () {
        var map = execBackend.fetchExecMap({ command: printCmd({ K1: 'v1', PEM: 'line1\nline2' }) });
        assert.equal(map.K1, 'v1');
        assert.equal(map.PEM, 'line1\nline2');
    });

    it('a missing binary names the binary', function () {
        assert.throws(function () {
            execBackend.fetchExecMap({ command: ['gina-no-such-binary-exec-test'] });
        }, /command not found: gina-no-such-binary-exec-test/);
    });

    it('a timed-out fetch FAILS FAST against a SIGTERM-ignoring child — the SIGKILL bound is load-bearing', function () {
        // The child sleeps 3s and ignores SIGTERM; the bound is 250ms. With
        // the default killSignal this call would BLOCK the full 3s (measured
        // spawnSync semantics) — the hung boot the tier exists to rule out.
        var t0 = Date.now();
        assert.throws(function () {
            execBackend.fetchExecMap({
                command: [NODE, '-e', 'process.on("SIGTERM", function () {}); setTimeout(function () {}, 3000)'],
                timeout: 250
            });
        }, /timed out after 250ms/);
        var elapsed = Date.now() - t0;
        assert.ok(elapsed < 2000, 'the kill must not wait for the child (took ' + elapsed + 'ms)');
    });

    it('a non-zero exit quotes the stderr tail and NEVER stdout', function () {
        var thrown = null;
        try {
            execBackend.fetchExecMap({
                command: [NODE, '-e',
                    'process.stderr.write("diag-tail-line\\n"); process.stdout.write("SENTINEL_STDOUT_SECRET"); process.exit(3)']
            });
        } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.match(thrown.message, /exit 3/);
        assert.match(thrown.message, /diag-tail-line/, 'stderr is the diagnostic channel');
        assert.ok(thrown.message.indexOf('SENTINEL_STDOUT_SECRET') < 0, 'stdout is the secrets payload — never echoed');
    });

    it('non-JSON stdout refuses WITHOUT an excerpt', function () {
        var thrown = null;
        try {
            execBackend.fetchExecMap({ command: [NODE, '-e', 'process.stdout.write("SENTINEL_NOT_JSON")'] });
        } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.match(thrown.message, /not valid JSON/);
        assert.ok(thrown.message.indexOf('SENTINEL_NOT_JSON') < 0, 'a malformed output may still be secrets');
    });

    it('a JSON array or scalar output refuses — the contract is one flat object', function () {
        assert.throws(function () {
            execBackend.fetchExecMap({ command: printCmd(['a', 'b']) });
        }, /single flat JSON object/);
    });

    it('a non-string value refuses with a GENERIC message — the key rides the debug channel only', function () {
        var thrown = null;
        try {
            execBackend.fetchExecMap({ command: printCmd({ GOOD: 'x', SENTINEL_BAD_KEY: 7 }) });
        } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.match(thrown.message, /non-string value/);
        assert.ok(thrown.message.indexOf('SENTINEL_BAD_KEY') < 0, 'key names stay out of user-facing messages');
    });
});

describe('05 - build + resolve', function () {

    it('a NON-EMPTY environment value beats the fetched map (the tier order that justifies the whole design)', function () {
        var backend = execBackend.build({ command: printCmd({ EXECTEST_PRECEDENCE: 'from-exec' }) });
        process.env.EXECTEST_PRECEDENCE = 'from-env';
        try {
            assert.equal(backend.resolve('EXECTEST_PRECEDENCE'), 'from-env');
        } finally { delete process.env.EXECTEST_PRECEDENCE; }
        assert.equal(backend.resolve('EXECTEST_PRECEDENCE'), 'from-exec');
    });

    it('#B268 parity: an EMPTY env value falls through to the exec tier AND warns, naming the key never the value', function () {
        var backend = execBackend.build({ command: printCmd({ EXECTEST_B268: 'exec-fallback' }) });
        process.env.EXECTEST_B268 = '';
        var out, warnings;
        try {
            warnings = captureWarn(function () { out = backend.resolve('EXECTEST_B268'); });
        } finally { delete process.env.EXECTEST_B268; }
        assert.equal(out, 'exec-fallback');
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /EXECTEST_B268/);
        assert.ok(warnings[0].indexOf('exec-fallback') < 0, 'never the value');
    });

    it('#B268 control: an ABSENT env value falls through SILENTLY', function () {
        var backend = execBackend.build({ command: printCmd({ EXECTEST_ABSENT: 'v' }) });
        delete process.env.EXECTEST_ABSENT;
        var warnings = captureWarn(function () { backend.resolve('EXECTEST_ABSENT'); });
        assert.equal(warnings.length, 0);
    });

    it('an EMPTY-string map value is a miss — fail-closed, file-tier parity', function () {
        var backend = execBackend.build({ command: printCmd({ EXECTEST_EMPTYVAL: '' }) });
        assert.throws(function () { backend.resolve('EXECTEST_EMPTYVAL'); }, /Secret resolution failed/);
    });

    it('the miss contract is byte-parallel to the other backends: generic message + non-enumerable key', function () {
        var backend = execBackend.build({ command: printCmd({}) });
        var thrown = null;
        try { backend.resolve('EXECTEST_MISSING'); } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.equal(thrown.message, 'Secret resolution failed');
        assert.equal(thrown._ginaSecretKey, 'EXECTEST_MISSING');
        assert.ok(Object.keys(thrown).indexOf('_ginaSecretKey') < 0, 'non-enumerable, for debug logging only');
    });
});

describe('06 - selectBackend dispatch', function () {

    it('an exec declaration builds a working env-over-exec backend end-to-end', function () {
        var backend = secrets.selectBackend(cfg({ exec: { command: printCmd({ EXECTEST_E2E: 'ok' }) } }));
        assert.equal(backend.resolve('EXECTEST_E2E'), 'ok');
    });

    it('both tiers declared throws the validator\'s own message (strict equality — surfaces cannot fork)', function () {
        var expected = declaration.validateBlock({ file: ['/a.env'], exec: { command: ['/x'] } })[0].message;
        var thrown = null;
        try { secrets.selectBackend(cfg({ file: ['/a.env'], exec: { command: ['/x'] } })); } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.strictEqual(thrown.message, expected);
    });

    it('{file: null, exec: …} dispatches to the exec tier — the documented merge escape works at boot', function () {
        var backend = secrets.selectBackend(cfg({ file: null, exec: { command: printCmd({ EXECTEST_ESC: 'v' }) } }));
        assert.equal(backend.resolve('EXECTEST_ESC'), 'v');
    });

    it('an unknown key and a non-object block refuse the boot (the approved tightening — was a silent env-only)', function () {
        assert.throws(function () { secrets.selectBackend(cfg({ flie: ['/a.env'] })); }, /unknown key `flie`/);
        assert.throws(function () { secrets.selectBackend(cfg('garbage')); }, /must be an object/);
    });

    it('{}, {exec: null} and a null block stay the SAME default backend instance — byte-identical opt-out preserved', function () {
        var viaNull  = secrets.selectBackend(null);
        assert.strictEqual(secrets.selectBackend(cfg({})), viaNull);
        assert.strictEqual(secrets.selectBackend(cfg({ exec: null })), viaNull);
        assert.strictEqual(secrets.selectBackend(cfg(null)), viaNull);
    });

    it('an invalid exec spec throws the validator\'s own message', function () {
        var expected = declaration.validateExecSpec({ command: [] })[0].message;
        var thrown = null;
        try { secrets.selectBackend(cfg({ exec: { command: [] } })); } catch (e) { thrown = e; }
        assert.ok(thrown);
        assert.strictEqual(thrown.message, expected);
    });

    it('control: the FILE tier still dispatches through the rewritten block logic', function () {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-execdisp-'));
        var f = path.join(tmp, 'a.env');
        fs.writeFileSync(f, 'EXECTEST_FILETIER=file-ok\n');
        try {
            var backend = secrets.selectBackend(cfg({ file: [f] }));
            assert.equal(backend.resolve('EXECTEST_FILETIER'), 'file-ok');
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    it('control: the #B271 empty-array warn survives the dispatch rewrite', function () {
        var warnings = captureWarn(function () {
            var b = secrets.selectBackend(cfg({ file: [] }));
            assert.strictEqual(b, secrets.selectBackend(null));
        });
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /empty array/);
    });
});

describe('07 - source pins: the fetch\'s fail-fast mechanics', function () {

    it('the child is SIGKILL-bounded — SIGTERM leaves spawnSync blocked past its timeout (measured)', function () {
        assert.match(EXEC_SRC, /killSignal\s*:\s*'SIGKILL'/);
    });

    it('`.error` is checked BEFORE `.status` — a timed-out child can report {error, status: 0}', function () {
        var errAt    = EXEC_SRC.indexOf('if (res.error)');
        var statusAt = EXEC_SRC.indexOf('if (res.status !== 0)');
        assert.ok(errAt > -1 && statusAt > -1, 'both checks must exist');
        assert.ok(errAt < statusAt, 'order is load-bearing: a status-first read calls the SIGTERM-timeout shape a success');
    });

    it('the default timeout is 10000ms, applied inside the fetch so BOTH consumers inherit it', function () {
        assert.match(EXEC_SRC, /var DEFAULT_TIMEOUT_MS = 10000;/);
        assert.match(EXEC_SRC, /spec\.timeout\s*:\s*DEFAULT_TIMEOUT_MS/);
    });

    it('output is bounded and decoded as utf8', function () {
        assert.match(EXEC_SRC, /maxBuffer\s*:\s*MAX_OUTPUT_BYTES/);
        assert.match(EXEC_SRC, /encoding\s*:\s*'utf8'/);
    });
});

describe('08 - the secrets:check exec mirror (extract-and-execute, never a replica)', function () {

    /**
     * Terminator-anchored slice, same technique and same reason as the
     * declaration suite's extraction: string literals in these bodies carry
     * unbalanced braces, so a naive brace walk runs past the close.
     */
    function extractExecTier(src) {
        var DECL = 'var resolveSecretsExecTier = function';
        var TERM = 'var resolveSecretsChain = function';
        if (src.split(DECL).length !== 2) { throw new Error('declaration anchor not unique'); }
        if (src.split(TERM).length !== 2) { throw new Error('terminator anchor not unique'); }
        var declIdx = src.indexOf(DECL);
        var termIdx = src.indexOf(TERM);
        if (!(declIdx > -1 && termIdx > declIdx)) { throw new Error('anchors out of order'); }
        var slice = src.slice(declIdx, termIdx);
        var close = slice.lastIndexOf('};');
        if (close < 0) { throw new Error('function close not found in slice'); }
        var rhs = slice.slice(slice.indexOf('=') + 1, close + 1).trim();
        /* jshint evil: true */
        return new Function('whisper', 'buildReps', 'JSON', 'secrets', 'return (' + rhs + ');');
    }

    function runExecTier(execSpec) {
        var factory = extractExecTier(CHECK_SRC);
        var jsonArg = {
            clone: function (x) { return JSON.parse(JSON.stringify(x)); },
            parse: JSON.parse,
            stringify: JSON.stringify
        };
        var fn = factory(
            function whisper(reps, x) { return x; },
            function buildReps() { return {}; },
            jsonArg,
            secrets
        );
        return fn('/tmp/does-not-matter', null, 'demo', execSpec);
    }

    it('extraction control: the exec-tier closure compiles from the shipped bytes', function () {
        assert.equal(typeof extractExecTier(CHECK_SRC), 'function');
    });

    it('a valid spec RUNS the real command and reports the fetch, keys counted never listed', function () {
        var out = runExecTier({ command: printCmd({ A: '1', B: '2' }) });
        assert.equal(out.tier, 'exec');
        assert.equal(out.errors.length, 0);
        assert.equal(out.map.A, '1');
        assert.deepEqual(out.exec.keys, 2);
    });

    it('a spec the runtime refuses is an ERROR here too, through the SAME shared validator', function () {
        var out = runExecTier({ command: [] });
        assert.equal(out.errors.length, 1);
        var shared = declaration.validateExecSpec({ command: [] })[0].message;
        assert.ok(out.errors[0].indexOf(shared) === 0, 'the gate message must start with the shared text');
    });

    it('the unresolved-token verdict carries the shared message PLUS the CLI-only hint', function () {
        var out = runExecTier({ command: ['/opt/bin/fetch', '${nope}'] });
        assert.equal(out.errors.length, 1);
        var shared = declaration.validateExecSpec({ command: ['/opt/bin/fetch', '${nope}'] })[0].message;
        assert.ok(out.errors[0].indexOf(shared) === 0);
        assert.match(out.errors[0], /pass --scope\/--env/);
    });

    it('a FAILING fetch is an error naming the boot refusal — not a soft absence', function () {
        var out = runExecTier({ command: ['gina-no-such-binary-exec-test'] });
        assert.equal(out.errors.length, 1);
        assert.match(out.errors[0], /command not found/);
        assert.match(out.errors[0], /REFUSES to boot/);
    });

    it('checkBundle consumes the tier dispatcher, and lookupSecret labels the exec tier', function () {
        assert.match(CHECK_SRC, /var chain = resolveSecretsChain\(/);
        assert.match(CHECK_SRC, /chain\.tier === 'exec'\) \? 'exec' : 'file'/);
    });

    it('the dispatcher runs the shared block validation BEFORE either tier — as the runtime does', function () {
        var dispatcher = CHECK_SRC.slice(CHECK_SRC.indexOf('var resolveSecretsChain = function'));
        var blockAt = dispatcher.indexOf('secrets.validateBlock(');
        var execAt  = dispatcher.indexOf('resolveSecretsExecTier(');
        var fileAt  = dispatcher.indexOf('resolveSecretsFileChain(');
        assert.ok(blockAt > -1 && execAt > -1 && fileAt > -1, 'all three sites must exist in the dispatcher');
        assert.ok(blockAt < execAt && blockAt < fileAt, 'block validation precedes both tier dispatches');
    });
});

describe('09 - #B409: declaration errors fail the gate\'s exit code', function () {

    it('an anyError accumulator exists, is seeded false, and is reset with anyUnset', function () {
        assert.match(CHECK_SRC, /anyError:\s*false/);
        assert.match(CHECK_SRC, /self\.anyError\s*=\s*false;/);
    });

    it('checkBundle flips anyError on a chain with errors — the runtime refuses to boot on those', function () {
        assert.match(CHECK_SRC, /if \(chain\.errors\.length\) \{ self\.anyError = true; \}/);
    });

    it('BOTH exit sites are widened to (anyUnset || anyError)', function () {
        var matches = CHECK_SRC.match(/process\.exit\(\(\s*self\.anyUnset\s*\|\|\s*self\.anyError\s*\)\s*\?\s*1\s*:\s*0\s*\)/g) || [];
        assert.equal(matches.length, 2,
            'the checkAll branch and the project branch must both fail on declaration errors');
    });

    it('no exit site remains keyed on anyUnset alone', function () {
        assert.ok(CHECK_SRC.indexOf('process.exit(self.anyUnset ? 1 : 0)') < 0,
            'an unset-only exit green-lights a config that cannot boot whenever the environment carries the keys');
    });
});
