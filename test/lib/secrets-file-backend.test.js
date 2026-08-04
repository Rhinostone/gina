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
        // core/config.js binds `.settings` BEFORE the ${...} substitution pass
        // and `.content` after it, and substitution returns a new object — so
        // only the content copy has resolved tokens. Reading the other one
        // would hand the backend a literal '${homedir}/secrets.env'.
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
