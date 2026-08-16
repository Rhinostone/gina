/**
 * Unit tests for the file-backed secrets layer:
 *   lib/secrets/src/env-file.js         — `.env` parsing
 *   lib/secrets/src/backends/file.js    — env-over-file resolution
 *   lib/secrets/src/main.js#selectBackend — backend choice from bundle config
 *
 * The precedence assertions matter more than they look: the environment
 * deliberately BEATS the file, which is the opposite of most `.env` tooling.
 * Every production path that delivers a secret to a bundle (K8s `secretRef`,
 * ECS task secrets, `sops exec-env`, a CI export) arrives via the environment,
 * so a file that won would let a stale plaintext copy shadow the real secret.
 * If someone ever "fixes" that ordering, §04 is what should stop them.
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert');
var fs     = require('node:fs');
var os     = require('node:os');
var path   = require('node:path');

var SECRETS_PATH = path.join(__dirname, '..', '..', 'framework');
var frameworkDir = fs.readdirSync(SECRETS_PATH).filter(function (d) {
    return /^v\d/.test(d) && fs.existsSync(path.join(SECRETS_PATH, d, 'lib/secrets/src/main.js'));
}).sort().pop();
var LIB = path.join(SECRETS_PATH, frameworkDir, 'lib/secrets/src');

var secrets  = require(path.join(LIB, 'main.js'));
var envFile  = require(path.join(LIB, 'env-file.js'));

var TMP, BASE, SCOPE;

function cfg(file) {
    return { content: { settings: { secrets: (file === undefined ? {} : { file: file }) } } };
}

before(function () {
    TMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-secfile-'));
    BASE  = path.join(TMP, 'base.env');
    SCOPE = path.join(TMP, 'scope.env');
    fs.writeFileSync(BASE,  'SHARED=base_shared\nONLY_BASE=base_only\nOVERRIDDEN=from_base\n');
    fs.writeFileSync(SCOPE, 'OVERRIDDEN=from_scope\nONLY_SCOPE=scope_only\n');
});

after(function () {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});


describe('01 - env-file parsing', function () {

    it('parses KEY=value, skipping blanks and # comments', function () {
        var m = envFile.parseEnv('# c\nA=1\n\nB=2\n');
        assert.equal(m.A, '1');
        assert.equal(m.B, '2');
    });

    it('strips an `export ` prefix and surrounding quotes', function () {
        var m = envFile.parseEnv('export A=plain\nB="dq"\nC=\'sq\'\n');
        assert.equal(m.A, 'plain');
        assert.equal(m.B, 'dq');
        assert.equal(m.C, 'sq');
    });

    it('keeps `=` inside the value and splits on the FIRST one only', function () {
        assert.equal(envFile.parseEnv('DSN=a=b=c\n').DSN, 'a=b=c');
    });

    it('skips a line with no `=`', function () {
        assert.equal('NOEQ' in envFile.parseEnv('NOEQ\nA=1\n'), false);
    });

    it('handles CRLF line endings', function () {
        var m = envFile.parseEnv('A=1\r\nB=2\r\n');
        assert.equal(m.A, '1');
        assert.equal(m.B, '2');
    });

    it('returns a null-prototype map, so `constructor` is an ordinary key', function () {
        var m = envFile.parseEnv('constructor=mine\n');
        assert.equal(m.constructor, 'mine');
        assert.equal(Object.getPrototypeOf(m), null);
    });

    it('later duplicate wins, matching shell `source`', function () {
        assert.equal(envFile.parseEnv('D=first\nD=second\n').D, 'second');
    });

    // #B269 — every expectation below was measured against a real `sh` doing
    // `set -a; . file; set +a`, which is the entrypoint pattern the module
    // header documents. The two conditions on the strip (preceded by
    // whitespace, outside quotes) each exist because dropping one corrupts a
    // legitimate secret, so both halves are asserted.
    it('#B269 strips a trailing `#` comment, matching shell `source`', function () {
        assert.equal(envFile.parseEnv('A=abc # note\n').A, 'abc');
        assert.equal(envFile.parseEnv('A=abc # one # two\n').A, 'abc');
        assert.equal(envFile.parseEnv('A=abc  #  spaced\n').A, 'abc');
    });

    it('#B269 a `#` NOT preceded by whitespace is literal, not a comment', function () {
        // `PW=abc#def` is the literal `abc#def` to a shell — stripping here
        // would silently corrupt any password containing a hash.
        assert.equal(envFile.parseEnv('A=abc#def\n').A, 'abc#def');
        // Directly after the `=` it is literal too, which is why the strip
        // runs on the RAW value: trimming first would make this look like a
        // leading `#` and swallow the whole value.
        assert.equal(envFile.parseEnv('A=#leading\n').A, '#leading');
    });

    it('#B269 a quoted `#` is kept — quoting is the escape hatch', function () {
        assert.equal(envFile.parseEnv('A="abc # inside"\n').A, 'abc # inside');
        assert.equal(envFile.parseEnv("A='abc # inside'\n").A, 'abc # inside');
        // First hash quoted, second one a real comment.
        assert.equal(envFile.parseEnv('A="abc # in" # out\n').A, 'abc # in');
    });

    it('#B269 unquoting still applies after a trailing comment is removed', function () {
        // Previously the trailing comment defeated the /^".*"$/ test, so the
        // value kept its literal quote characters and became the credential.
        assert.equal(envFile.parseEnv('A="abc" # note\n').A, 'abc');
        assert.equal(envFile.parseEnv("A='abc' # note\n").A, 'abc');
    });

    it('#B269 `KEY= # comment` is EMPTY, so presence checks report it unset', function () {
        // The consequential case: a shell yields '' here, and both the
        // `secrets:check` gate and the file backend treat '' as unresolved.
        // Before the fix this parsed to '# comment' — non-empty — so the gate
        // reported the key SET while the documented entrypoint delivered it
        // empty, and the file tier would have used '# comment' as the value.
        var m = envFile.parseEnv('A= # comment\n');
        assert.equal(m.A, '');
        assert.equal(typeof m.A === 'string' && m.A !== '', false);
    });

    it('parseEnvFile returns null for an unreadable path (NOT an empty map)', function () {
        assert.strictEqual(envFile.parseEnvFile(path.join(TMP, 'nope.env')), null);
        // control: a readable file must NOT return null
        assert.notStrictEqual(envFile.parseEnvFile(BASE), null);
    });

    it('is re-exported from lib/secrets', function () {
        assert.equal(typeof secrets.parseEnv, 'function');
        assert.equal(typeof secrets.parseEnvFile, 'function');
    });
});


describe('02 - selectBackend opts out cleanly', function () {

    it('returns the SAME default backend when no secrets block is declared', function () {
        var a = secrets.selectBackend({ content: { settings: {} } });
        var b = secrets.selectBackend({ content: { settings: {} } });
        assert.strictEqual(a, b, 'must be the shared default backend instance');
    });

    it('returns the default backend for `secrets: {}` with no file key', function () {
        assert.strictEqual(secrets.selectBackend(cfg(undefined)),
                           secrets.selectBackend({ content: { settings: {} } }));
    });

    it('returns the default backend for a non-object / null config', function () {
        var def = secrets.selectBackend({ content: { settings: {} } });
        assert.strictEqual(secrets.selectBackend(null), def);
        assert.strictEqual(secrets.selectBackend('nope'), def);
    });

    it('reads content.settings, NOT settings', function () {
        // selectBackend reads `content.settings` only, whatever shape it is handed.
        // It is NOT a claim that `.settings` is unresolved: core/config.js re-points
        // that alias at the post-substitution copy since #B257, so for a real bundle
        // config the two are the same object. This arm pins the read TARGET, which
        // still matters for config-shaped objects assembled by other paths.
        var stale = { settings: { secrets: { file: BASE } }, content: { settings: {} } };
        assert.strictEqual(secrets.selectBackend(stale),
                           secrets.selectBackend({ content: { settings: {} } }),
                           'a secrets block on `.settings` must be ignored');
    });
});


describe('03 - file layering', function () {

    it('resolves a key present in a single declared file', function () {
        assert.equal(secrets.selectBackend(cfg(BASE)).resolve('SHARED'), 'base_shared');
    });

    it('accepts an array and lets a LATER file win', function () {
        var b = secrets.selectBackend(cfg([BASE, SCOPE]));
        assert.equal(b.resolve('OVERRIDDEN'), 'from_scope');
        // control: keys unique to each layer still resolve
        assert.equal(b.resolve('ONLY_BASE'),  'base_only');
        assert.equal(b.resolve('ONLY_SCOPE'), 'scope_only');
    });

    it('tolerates an absent file among the layers', function () {
        var b = secrets.selectBackend(cfg([BASE, path.join(TMP, 'absent.env')]));
        assert.equal(b.resolve('ONLY_BASE'), 'base_only');
    });

    it('still fails closed for a key in no layer', function () {
        assert.throws(function () { secrets.selectBackend(cfg([BASE])).resolve('NO_SUCH_KEY'); },
                      /Secret resolution failed/);
    });

    it('failure carries the key non-enumerably, never in the message', function () {
        try {
            secrets.selectBackend(cfg([BASE])).resolve('HIDDEN_KEY');
            assert.fail('should have thrown');
        } catch (e) {
            assert.equal(e.message, 'Secret resolution failed');
            assert.equal(e._ginaSecretKey, 'HIDDEN_KEY');
            assert.equal(JSON.stringify(e), '{}', 'key must not serialise');
            assert.equal(e.message.indexOf('HIDDEN_KEY'), -1);
        }
    });
});


describe('04 - the environment BEATS the file', function () {

    it('an env var wins over every file layer', function () {
        process.env.OVERRIDDEN = 'from_environment';
        try {
            assert.equal(secrets.selectBackend(cfg([BASE, SCOPE])).resolve('OVERRIDDEN'),
                         'from_environment');
        } finally {
            delete process.env.OVERRIDDEN;
        }
    });

    it('CONTROL: with the env var removed, the file wins again', function () {
        delete process.env.OVERRIDDEN;
        assert.equal(secrets.selectBackend(cfg([BASE, SCOPE])).resolve('OVERRIDDEN'),
                     'from_scope');
    });

    it('an EMPTY env var does not shadow the file (empty is unset, fail-closed rule)', function () {
        process.env.ONLY_BASE = '';
        try {
            assert.equal(secrets.selectBackend(cfg([BASE])).resolve('ONLY_BASE'), 'base_only');
        } finally {
            delete process.env.ONLY_BASE;
        }
    });
});


describe('05 - config guards', function () {

    it('rejects a ${secret:...} placeholder in the path (chicken-and-egg)', function () {
        assert.throws(function () { secrets.selectBackend(cfg('${secret:P}/x.env')); },
                      /cannot contain/);
    });

    it('rejects an unresolved ${...} token rather than looking for it literally', function () {
        assert.throws(function () { secrets.selectBackend(cfg('${homedir}/x.env')); },
                      /unresolved/);
    });

    it('rejects a non-string or empty path', function () {
        assert.throws(function () { secrets.selectBackend(cfg([123])); }, /non-empty string/);
        assert.throws(function () { secrets.selectBackend(cfg('')); },   /non-empty string/);
    });

    it('CONTROL: a well-formed absolute path is accepted', function () {
        assert.doesNotThrow(function () { secrets.selectBackend(cfg(BASE)); });
    });
});


/**
 * #B267 — an unreadable layer must NOT be mistaken for an absent one.
 *
 * The distinction is the difference between "skip this layer" and "refuse to
 * boot". Collapsing them let a `["<base>", "<per-scope>"]` chain whose per-scope
 * file lost read permission fall back to the SHARED credential silently, with
 * only a suppressed debug line to say so. §06 is what should stop anyone
 * restoring that behaviour.
 */
describe('06 - #B267 an unreadable layer is fatal, an absent one is not', function () {

    var NOACC, canTestPerms;

    before(function () {
        NOACC = path.join(TMP, 'noaccess.env');
        fs.writeFileSync(NOACC, 'OVERRIDDEN=from_unreadable\n');
        fs.chmodSync(NOACC, 0);
        // Running as root defeats chmod; detect rather than assert a false pass.
        canTestPerms = false;
        try { fs.readFileSync(NOACC, 'utf8'); } catch (e) { canTestPerms = true; }
    });

    after(function () {
        try { fs.chmodSync(NOACC, 0o600); } catch (e) { /* best effort */ }
    });

    it('readEnvFile reports ENOENT for a genuinely absent path', function () {
        var res = envFile.readEnvFile(path.join(TMP, 'never-created.env'));
        assert.equal(res.found, false);
        assert.equal(res.code, 'ENOENT');
        assert.equal(res.map, null);
    });

    it('readEnvFile reports EACCES for a path that exists but cannot be read', function () {
        if (!canTestPerms) { return; }   // root: chmod is not enforced
        var res = envFile.readEnvFile(NOACC);
        assert.equal(res.found, false);
        assert.equal(res.code, 'EACCES');
    });

    it('CONTROL: readEnvFile reports found for a readable path', function () {
        var res = envFile.readEnvFile(BASE);
        assert.equal(res.found, true);
        assert.equal(res.code, null);
        assert.equal(res.map.SHARED, 'base_shared');
    });

    it('parseEnvFile keeps its map-or-null contract on top of readEnvFile', function () {
        assert.strictEqual(envFile.parseEnvFile(path.join(TMP, 'never-created.env')), null);
        assert.notStrictEqual(envFile.parseEnvFile(BASE), null);
    });

    it('building a chain whose layer is UNREADABLE throws, naming the path', function () {
        if (!canTestPerms) { return; }
        assert.throws(
            function () { secrets.selectBackend(cfg([BASE, NOACC])); },
            function (err) {
                return /cannot be read/.test(err.message)
                    && err.message.indexOf(NOACC) > -1
                    && /EACCES/.test(err.message);
            }
        );
    });

    it('CONTROL: a chain whose layer is merely ABSENT still builds', function () {
        assert.doesNotThrow(function () {
            secrets.selectBackend(cfg([BASE, path.join(TMP, 'never-created.env')]));
        });
    });

    it('does NOT silently degrade to the shared value when the override is unreadable', function () {
        if (!canTestPerms) { return; }
        // Healthy chain resolves the scope-specific value...
        var healthy = secrets.selectBackend(cfg([BASE, SCOPE]));
        assert.equal(healthy.resolve('OVERRIDDEN'), 'from_scope');
        // ...and an unreadable override must REFUSE rather than return the base value.
        assert.throws(function () { secrets.selectBackend(cfg([BASE, NOACC])); });
    });

    it('a path that is a DIRECTORY is fatal too, not treated as absent', function () {
        var asDir = path.join(TMP, 'adir.env');
        if (!fs.existsSync(asDir)) { fs.mkdirSync(asDir); }
        var res = envFile.readEnvFile(asDir);
        assert.equal(res.found, false);
        assert.notEqual(res.code, 'ENOENT');
        assert.throws(function () { secrets.selectBackend(cfg([asDir])); }, /cannot be read/);
    });
});


/**
 * #B268 — a SET-but-EMPTY environment variable is treated as absent, so the file
 * fills it. That is deliberate (Docker Compose `environment: ["X=${X}"]` with the
 * outer variable unset produces exactly this shape, and refusing would break it),
 * but it is also what a failed `export X="$(fetch …)"` produces — so the fallback
 * must WARN. These tests pin both halves: the value that is returned, and the fact
 * that it is announced.
 */
describe('07 - #B268 an empty env var falls through to the file, but warns', function () {

    var EMPTYENV, realWarn, warnings;

    before(function () {
        EMPTYENV = path.join(TMP, 'emptyenv.env');
        fs.writeFileSync(EMPTYENV, 'EMPTY_CASE=value_from_file\nABSENT_CASE=file_value\n');
    });

    function capture(fn) {
        warnings = [];
        realWarn = console.warn;
        console.warn = function () { warnings.push(Array.prototype.join.call(arguments, ' ')); };
        try { return fn(); } finally { console.warn = realWarn; }
    }

    it('a NON-EMPTY env value still wins, and warns about nothing', function () {
        process.env.EMPTY_CASE = 'value_from_env';
        var backend = secrets.selectBackend(cfg([EMPTYENV]));
        var got = capture(function () { return backend.resolve('EMPTY_CASE'); });
        delete process.env.EMPTY_CASE;
        assert.equal(got, 'value_from_env');
        assert.equal(warnings.length, 0);
    });

    it('an EMPTY env value falls through to the file (behaviour preserved)', function () {
        process.env.EMPTY_CASE = '';
        var backend = secrets.selectBackend(cfg([EMPTYENV]));
        var got = capture(function () { return backend.resolve('EMPTY_CASE'); });
        delete process.env.EMPTY_CASE;
        assert.equal(got, 'value_from_file');
    });

    it('...and that fall-through WARNS, naming the key but never the value', function () {
        process.env.EMPTY_CASE = '';
        var backend = secrets.selectBackend(cfg([EMPTYENV]));
        capture(function () { return backend.resolve('EMPTY_CASE'); });
        delete process.env.EMPTY_CASE;
        assert.equal(warnings.length, 1, 'expected exactly one warning');
        assert.ok(/EMPTY_CASE/.test(warnings[0]), 'warning must name the key');
        assert.ok(/present but EMPTY/i.test(warnings[0]));
        assert.ok(warnings[0].indexOf('value_from_file') === -1,
            'warning must never contain the resolved secret value');
    });

    it('CONTROL: an ABSENT env var falls through with NO warning', function () {
        delete process.env.ABSENT_CASE;
        var backend = secrets.selectBackend(cfg([EMPTYENV]));
        var got = capture(function () { return backend.resolve('ABSENT_CASE'); });
        assert.equal(got, 'file_value');
        assert.equal(warnings.length, 0,
            'an absent env var is the ordinary case and must stay quiet');
    });
});


/**
 * §08 — the three guards added by the 2026-08-15 adversarial-review batch.
 * Each pins a shape that previously passed in silence:
 *
 *   #B270  the framework-environment tier must not shadow `process.env` with a
 *          NON-STRING. `filterArgs()` stores real booleans, so the old `||`
 *          short-circuited on a truthy boolean and skipped process.env — the
 *          file tier then won over a set environment variable, inverting the
 *          precedence §04 exists to protect. This is §04's blind spot.
 *   #B271  `[]` silently disabled the whole tier; `[" "]` cleared the schema's
 *          `minLength: 1` and built a tier that could never resolve anything.
 *   #B272  a `${…}` token that resolved to EMPTY leaves no token behind for the
 *          unresolved-token guard — only an empty path segment, which POSIX
 *          collapses into a silent read of the file one directory up.
 */
describe('08 - post-review guards (#B270, #B271, #B272)', function () {

    var envBackend = require(path.join(LIB, 'backends', 'env.js'));
    var warnings   = [];

    function capture(fn) {
        var orig = console.warn;
        warnings = [];
        console.warn = function () {
            warnings.push(Array.prototype.slice.call(arguments).join(' '));
        };
        try { return fn(); } finally { console.warn = orig; }
    }

    function withEnvVar(impl, fn) {
        var had  = Object.prototype.hasOwnProperty.call(global, 'getEnvVar');
        var orig = global.getEnvVar;
        global.getEnvVar = impl;
        try { return fn(); }
        finally { if (had) { global.getEnvVar = orig; } else { delete global.getEnvVar; } }
    }

    function defaultBackend() {
        return secrets.selectBackend({ content: { settings: {} } });
    }

    it('#B270 a BOOLEAN from the framework tier does not shadow process.env', function () {
        process.env.B270_KEY = 'a_real_secret_from_the_environment';
        try {
            var got = withEnvVar(function (k) { return (k === 'B270_KEY') ? true : undefined; },
                                 function () { return envBackend.resolve('B270_KEY'); });
            assert.equal(got, 'a_real_secret_from_the_environment',
                'a truthy NON-STRING must fall through to process.env, not win');
        } finally { delete process.env.B270_KEY; }
    });

    it('#B270 CONTROL: a non-empty STRING from the framework tier still wins', function () {
        process.env.B270_KEY = 'from_process_env';
        try {
            var got = withEnvVar(function (k) { return (k === 'B270_KEY') ? 'from_framework' : undefined; },
                                 function () { return envBackend.resolve('B270_KEY'); });
            assert.equal(got, 'from_framework',
                'the framework tier keeps its precedence for real strings');
        } finally { delete process.env.B270_KEY; }
    });

    it('#B270 CONTROL: an EMPTY string from the framework tier falls through too', function () {
        process.env.B270_KEY = 'from_process_env';
        try {
            var got = withEnvVar(function (k) { return (k === 'B270_KEY') ? '' : undefined; },
                                 function () { return envBackend.resolve('B270_KEY'); });
            assert.equal(got, 'from_process_env', 'empty counts as unset on both tiers');
        } finally { delete process.env.B270_KEY; }
    });

    it('#B271 `[]` disables the file tier and no longer does it silently', function () {
        var backend = capture(function () { return secrets.selectBackend(cfg([])); });
        assert.strictEqual(backend, defaultBackend(),
            'an empty array still opts out — refusing boot here would be an outage');
        assert.equal(warnings.length, 1, 'expected exactly one warning');
        assert.ok(/empty array/i.test(warnings[0]), 'the warning must name the shape');
    });

    it('#B271 CONTROL: a populated array opts IN and stays quiet', function () {
        var backend = capture(function () { return secrets.selectBackend(cfg([BASE])); });
        assert.notStrictEqual(backend, defaultBackend(), 'a file tier must have been built');
        assert.equal(warnings.length, 0, 'the ordinary case must not warn');
    });

    it('#B271 a whitespace-only path is refused, not built into a dead tier', function () {
        assert.throws(function () { secrets.selectBackend(cfg([' '])); },  /non-empty string/);
        assert.throws(function () { secrets.selectBackend(cfg('\t')); },   /non-empty string/);
    });

    it('#B272 an empty path segment is refused (a token resolved to EMPTY)', function () {
        assert.throws(function () { secrets.selectBackend(cfg(TMP + '//secrets.env')); },
                      /empty path segment/);
    });

    it('#B272 CONTROL: the same path with the segment present is accepted', function () {
        assert.doesNotThrow(function () { secrets.selectBackend(cfg(TMP + '/scope/secrets.env')); });
    });
});
