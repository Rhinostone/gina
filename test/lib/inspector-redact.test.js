'use strict';

var path   = require('path');
var fs     = require('fs');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW       = require('../fw');
var redactor = require(path.join(FW, 'lib/inspector-redact/src/main'));

describe('01 — Defaults', function () {
    it('exports DEFAULT_PATTERNS / DEFAULT_TYPES / REPLACEMENT', function () {
        assert.ok(Array.isArray(redactor.DEFAULT_PATTERNS));
        assert.ok(redactor.DEFAULT_PATTERNS.length > 0);
        assert.deepEqual(redactor.DEFAULT_TYPES, ['password']);
        assert.equal(redactor.REPLACEMENT, '[redacted]');
    });

    it('default patterns include the canonical secret keywords', function () {
        var src = redactor.DEFAULT_PATTERNS.join('|').toLowerCase();
        ['password', 'pwd', 'secret', 'token', 'apikey', 'cvv', 'ssn'].forEach(function (k) {
            assert.ok(src.indexOf(k) !== -1, 'missing default pattern for ' + k);
        });
    });
});

describe('02 — compile() and keyMatches()', function () {
    it('compile() drops invalid regex sources silently', function () {
        var compiled = redactor.compile(['password', '(unterminated', 'token']);
        assert.equal(compiled.length, 2);
    });

    it('compile() returns [] for non-array input', function () {
        assert.deepEqual(redactor.compile(null), []);
        assert.deepEqual(redactor.compile('password'), []);
    });

    it('keyMatches() is case-insensitive', function () {
        var compiled = redactor.compile(['password']);
        assert.equal(redactor.keyMatches('Password', compiled), true);
        assert.equal(redactor.keyMatches('PASSWORD', compiled), true);
        assert.equal(redactor.keyMatches('email', compiled), false);
    });

    it('keyMatches() handles non-string keys', function () {
        var compiled = redactor.compile(['password']);
        assert.equal(redactor.keyMatches(42, compiled), false);
        assert.equal(redactor.keyMatches(null, compiled), false);
        assert.equal(redactor.keyMatches(undefined, compiled), false);
    });
});

describe('03 — redact() — secret keys', function () {
    it('replaces password / token / pwd values with [redacted]', function () {
        var input = {
            email: 'a@b.c',
            password: 'hunter2',
            token: 'abc.def.ghi',
            pwd: 'shh',
            nested: { apiKey: 'sk_live_xxx', name: 'Jane' }
        };
        var out = redactor.redact(input);
        assert.equal(out.email, 'a@b.c');
        assert.equal(out.password, '[redacted]');
        assert.equal(out.token, '[redacted]');
        assert.equal(out.pwd, '[redacted]');
        assert.equal(out.nested.apiKey, '[redacted]');
        assert.equal(out.nested.name, 'Jane');
    });

    it('preserves null / undefined values even when key matches', function () {
        var out = redactor.redact({ password: null, token: undefined });
        assert.equal(out.password, null);
        assert.equal(out.token, undefined);
    });

    it('never mutates the input object', function () {
        var input = { password: 'hunter2', email: 'a@b.c' };
        var copy  = JSON.parse(JSON.stringify(input));
        redactor.redact(input);
        assert.deepEqual(input, copy);
    });

    it('walks arrays', function () {
        var out = redactor.redact([
            { password: 'a', email: 'x@y.z' },
            { password: 'b', email: 'q@w.e' }
        ]);
        assert.equal(out[0].password, '[redacted]');
        assert.equal(out[1].password, '[redacted]');
        assert.equal(out[0].email, 'x@y.z');
    });

    it('handles primitives unchanged', function () {
        assert.equal(redactor.redact('hello'), 'hello');
        assert.equal(redactor.redact(42), 42);
        assert.equal(redactor.redact(null), null);
        assert.equal(redactor.redact(undefined), undefined);
    });

    it('detects circular references', function () {
        var a = { password: 'x' };
        a.self = a;
        var out = redactor.redact(a);
        assert.equal(out.password, '[redacted]');
        assert.equal(out.self, '[circular]');
    });

    it('honours custom replacement string', function () {
        var out = redactor.redact({ password: 'x' }, { replacement: '***' });
        assert.equal(out.password, '***');
    });

    it('honours custom patterns (replacing defaults)', function () {
        // Patterns are matched against tokens or the joined-tokens form, so the
        // token-style form (no separators, lowercase) is the canonical spelling.
        // `custom_secret` → tokens ['custom','secret'] → joined 'customsecret'.
        var out = redactor.redact(
            { password: 'pw', custom_secret: 'cs', email: 'x@y.z' },
            { patterns: ['customsecret'] }
        );
        // 'password' is no longer a secret because patterns replaced defaults
        assert.equal(out.password, 'pw');
        assert.equal(out.custom_secret, '[redacted]');
        assert.equal(out.email, 'x@y.z');
    });

    it('respects maxDepth', function () {
        var deep = { a: { b: { c: { password: 'x' } } } };
        var out = redactor.redact(deep, { maxDepth: 2 });
        // At depth 3 (a.b.c) walk returns the value unchanged → password not redacted
        assert.equal(typeof out.a.b.c, 'object');
        assert.equal(out.a.b.c.password, 'x');
    });
});

describe('04 — getConfig()', function () {
    it('returns defaults for null / undefined / empty conf', function () {
        var cfg = redactor.getConfig(null);
        assert.equal(cfg.patterns, redactor.DEFAULT_PATTERNS);
        assert.equal(cfg.types, redactor.DEFAULT_TYPES);
        assert.equal(cfg.replacement, '[redacted]');
        assert.ok(Array.isArray(cfg.compiledPatterns));
        assert.ok(cfg.compiledPatterns.length > 0);
    });

    it('reads from conf.inspector.redact', function () {
        var cfg = redactor.getConfig({
            inspector: { redact: { patterns: ['fooSecret'], types: ['hidden'], replacement: '<x>' } }
        });
        assert.deepEqual(cfg.patterns, ['fooSecret']);
        assert.deepEqual(cfg.types, ['hidden']);
        assert.equal(cfg.replacement, '<x>');
    });

    it('reads from conf.content.settings.inspector.redact', function () {
        var cfg = redactor.getConfig({
            content: { settings: { inspector: { redact: { patterns: ['x'], replacement: '<y>' } } } }
        });
        assert.deepEqual(cfg.patterns, ['x']);
        assert.equal(cfg.replacement, '<y>');
    });

    it('reads from conf.content.inspector.redact', function () {
        var cfg = redactor.getConfig({
            content: { inspector: { redact: { patterns: ['z'] } } }
        });
        assert.deepEqual(cfg.patterns, ['z']);
    });

    it('falls back to defaults for invalid types', function () {
        var cfg = redactor.getConfig({
            inspector: { redact: { patterns: 'not-an-array', types: [], replacement: 42 } }
        });
        assert.equal(cfg.patterns, redactor.DEFAULT_PATTERNS);
        assert.equal(cfg.types, redactor.DEFAULT_TYPES);
        assert.equal(cfg.replacement, redactor.REPLACEMENT);
    });
});

describe('05 — Integration — render-swig.js wires inspector-redact', function () {
    var src = fs.readFileSync(path.join(FW, 'core/controller/controller.render-swig.js'), 'utf8');

    it('imports inspector-redact at module top', function () {
        assert.ok(/require\(['"]lib\/inspector-redact['"]\)/.test(src));
    });

    it('calls inspectorRedact.getConfig(local.options.conf)', function () {
        assert.ok(/inspectorRedact\.getConfig\(\s*local\.options\.conf\s*\)/.test(src));
    });

    it('calls inspectorRedact.redact(__gdPayload, ...) before stringify and emit', function () {
        // The redact() call must appear before "process.emit('inspector#data'"
        var redactIdx = src.indexOf('inspectorRedact.redact(__gdPayload');
        var emitIdx   = src.indexOf("process.emit('inspector#data'");
        assert.ok(redactIdx > 0, 'inspectorRedact.redact(__gdPayload …) call missing');
        assert.ok(emitIdx > 0, 'process.emit(inspector#data) call missing');
        assert.ok(redactIdx < emitIdx, 'redaction must happen before emit');
    });

    it('exposes redact config via __gdGina.inspectorRedact for the statusbar shim', function () {
        assert.ok(/__gdGina\.inspectorRedact\s*=\s*\{/.test(src));
    });
});

describe('06 — Integration — render-json.js wires inspector-redact', function () {
    var src = fs.readFileSync(path.join(FW, 'core/controller/controller.render-json.js'), 'utf8');

    it('imports inspector-redact at module top', function () {
        assert.ok(/require\(['"]lib\/inspector-redact['"]\)/.test(src));
    });

    it('calls inspectorRedact.redact(__gdPayload, ...) before emit', function () {
        var redactIdx = src.indexOf('inspectorRedact.redact(__gdPayload');
        var emitIdx   = src.indexOf("process.emit('inspector#data'");
        assert.ok(redactIdx > 0, 'inspectorRedact.redact(__gdPayload …) call missing');
        assert.ok(emitIdx > 0, 'process.emit(inspector#data) call missing');
        assert.ok(redactIdx < emitIdx, 'redaction must happen before emit');
    });

    it('exposes inspectorRedact config under gina.inspectorRedact', function () {
        assert.ok(/inspectorRedact:\s*\{/.test(src));
    });

    it('redaction is gated on isCacheless() && _inspectorActive (dev-mode only)', function () {
        // The redact call lives inside the existing #INS block which is gated
        // by `self.isCacheless() && process.gina._inspectorActive`. Confirm the
        // redact call sits inside that block, not above it.
        var gateIdx   = src.indexOf('process.gina._inspectorActive');
        var redactIdx = src.indexOf('inspectorRedact.redact(__gdPayload');
        assert.ok(gateIdx > 0 && redactIdx > gateIdx, 'redact must run inside the dev-mode gate');
    });
});

describe('07 — Integration — statusbar.html shim has inline redactor', function () {
    var src = fs.readFileSync(
        path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/html/statusbar.html'),
        'utf8'
    );

    it('declares _rdc_redact and _rdcKeyHit helpers', function () {
        assert.ok(/function\s+_rdc_redact/.test(src));
        assert.ok(/function\s+_rdcKeyHit/.test(src));
        assert.ok(/function\s+_rdcDomSecrets/.test(src));
    });

    it('reads patterns / types / replacement from window.__ginaData.gina.inspectorRedact', function () {
        assert.ok(/d\.gina\s*&&\s*d\.gina\.inspectorRedact/.test(src));
    });

    it('redacts data-xhr / view-xhr / el-xhr / forms before storing', function () {
        // every assignment to u[section] / fd[k] in update() must go through _rdc_redact
        assert.ok(/_rdc_redact\(sectionData,\s*null\)/.test(src), 'data-xhr/view-xhr/el-xhr path missing');
        assert.ok(/_rdc_redact\(sectionData,\s*sectionData\.id\)/.test(src), 'forms path missing DOM hint');
    });

    it('falls back to default patterns when inspectorRedact is absent', function () {
        // Non-array patterns guard with defaults baked into the shim
        assert.ok(/Array\.isArray\(_rdc\.patterns\)/.test(src));
        assert.ok(/'password','passwd','pwd','secret','token','apikey'/.test(src));
    });

    it('dist copy is in sync with src', function () {
        var dist = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/dist/vendor/gina/html/statusbar.html'),
            'utf8'
        );
        assert.ok(/_rdc_redact/.test(dist), 'dist statusbar.html missing _rdc_redact — rebuild plugin');
    });
});

describe('08 — NON_SECRET_SUFFIX carve-out — rule/policy/config keys', function () {
    var compiled = redactor.compile(redactor.DEFAULT_PATTERNS);

    it('exports NON_SECRET_SUFFIX regex', function () {
        assert.ok(redactor.NON_SECRET_SUFFIX instanceof RegExp);
    });

    it('keyMatches() returns false for rule/policy/validator/config suffixes', function () {
        assert.equal(redactor.keyMatches('passwordRule',       compiled), false);
        assert.equal(redactor.keyMatches('passwordRules',      compiled), false);
        assert.equal(redactor.keyMatches('passwordPolicy',     compiled), false);
        assert.equal(redactor.keyMatches('passwordPolicies',   compiled), false);
        assert.equal(redactor.keyMatches('passwordValidator',  compiled), false);
        assert.equal(redactor.keyMatches('passwordConfig',     compiled), false);
        assert.equal(redactor.keyMatches('passwordSettings',   compiled), false);
        assert.equal(redactor.keyMatches('passwordRequirements', compiled), false);
        assert.equal(redactor.keyMatches('passwordStrength',   compiled), false);
        assert.equal(redactor.keyMatches('passwordConstraints', compiled), false);
        assert.equal(redactor.keyMatches('tokenSchema',        compiled), false);
        assert.equal(redactor.keyMatches('secretSpec',         compiled), false);
    });

    it('keyMatches() still redacts the bare secret keys (control)', function () {
        assert.equal(redactor.keyMatches('password', compiled), true);
        assert.equal(redactor.keyMatches('token',    compiled), true);
        assert.equal(redactor.keyMatches('secret',   compiled), true);
        assert.equal(redactor.keyMatches('apiKey',   compiled), true);
    });

    it('carve-out is case-insensitive', function () {
        assert.equal(redactor.keyMatches('passwordRULE',   compiled), false);
        assert.equal(redactor.keyMatches('PasswordPolicy', compiled), false);
        assert.equal(redactor.keyMatches('TOKEN_CONFIG',   compiled), false);
    });

    it('redact() preserves passwordRule sub-tree but redacts password value', function () {
        var input = {
            password: 'hunter2',
            passwordRule: { minLength: 8, requireUppercase: true, requireDigit: true }
        };
        var out = redactor.redact(input);
        assert.equal(out.password, '[redacted]');
        assert.deepEqual(out.passwordRule, { minLength: 8, requireUppercase: true, requireDigit: true });
    });

    it('redact() preserves nested rule/policy objects across the tree', function () {
        var input = {
            user: { password: 'pw', email: 'a@b.c' },
            forms: {
                signup: {
                    passwordPolicy:  { minLength: 12 },
                    passwordValidator: { regex: '^.{8,}$' },
                    tokenConfig:     { ttlSeconds: 3600 }
                }
            }
        };
        var out = redactor.redact(input);
        assert.equal(out.user.password, '[redacted]');
        assert.deepEqual(out.forms.signup.passwordPolicy,    { minLength: 12 });
        assert.deepEqual(out.forms.signup.passwordValidator, { regex: '^.{8,}$' });
        assert.deepEqual(out.forms.signup.tokenConfig,       { ttlSeconds: 3600 });
    });

    it('statusbar shim mirrors the NON_SECRET_SUFFIX carve-out', function () {
        var src = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/html/statusbar.html'),
            'utf8'
        );
        assert.ok(/_rdcNonSecret\s*=\s*\/\^\(rule\|rules\|policy\|policies\|validator\|config/.test(src),
            'statusbar shim missing _rdcNonSecret regex');
        assert.ok(/_rdcNonSecret\.test\(tokens\[tokens\.length\s*-\s*1\]\)/.test(src),
            'statusbar shim missing _rdcNonSecret guard on last token');
    });

    it('statusbar dist copy carries the NON_SECRET_SUFFIX carve-out', function () {
        var dist = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/dist/vendor/gina/html/statusbar.html'),
            'utf8'
        );
        assert.ok(/_rdcNonSecret/.test(dist),
            'dist statusbar.html missing _rdcNonSecret — rebuild plugin');
    });
});

describe('09 — Primitive-only redaction under secret-like keys', function () {
    it('preserves object value under a matched secret key (rule spec shape)', function () {
        var out = redactor.redact({ password: { isRequired: true, isString: 7 } });
        assert.deepEqual(out.password, { isRequired: true, isString: 7 });
    });

    it('preserves array value under a matched secret key', function () {
        var out = redactor.redact({ token: [{ name: 'a' }, { name: 'b' }] });
        assert.deepEqual(out.token, [{ name: 'a' }, { name: 'b' }]);
    });

    it('preserves validator spec keyed by form field name (Freelancer signup case)', function () {
        var input = {
            rules: {
                'account[password]'        : { isRequired: true, isString: 7 },
                'account[passwordConfirm]' : { isRequired: true, isString: 7 },
                'account[username]'        : { isRequired: true, isString: 3 }
            }
        };
        var out = redactor.redact(input);
        assert.deepEqual(out.rules['account[password]'],        { isRequired: true, isString: 7 });
        assert.deepEqual(out.rules['account[passwordConfirm]'], { isRequired: true, isString: 7 });
        assert.deepEqual(out.rules['account[username]'],        { isRequired: true, isString: 3 });
    });

    it('still redacts primitive values under matched keys (control)', function () {
        var out = redactor.redact({ password: 'hunter2', token: 'abc.def' });
        assert.equal(out.password, '[redacted]');
        assert.equal(out.token,    '[redacted]');
    });

    it('still catches nested primitive secrets inside preserved rule objects', function () {
        // A rule object under `password` is preserved, but if it nests another
        // secret-like key with a primitive value, that inner primitive is still
        // redacted — the walker recurses through the preserved object.
        var input = { password: { default: 'hunter2', apiKey: 'sk_live_xxx' } };
        var out = redactor.redact(input);
        assert.equal(out.password.default, 'hunter2');       // `default` is not a secret key
        assert.equal(out.password.apiKey,  '[redacted]');    // `apiKey` matches, primitive → redacted
    });

    it('statusbar shim mirrors the primitive-only rule', function () {
        var src = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/src/vendor/gina/inspector/html/statusbar.html'),
            'utf8'
        );
        // Shim walker must have the 3-way branch: null/undef preserve, object recurse, primitive redact
        assert.ok(/typeof val === 'object'/.test(src),
            'statusbar shim missing typeof val === object branch');
        assert.ok(/out\[key\] = _rdcWalk\(val/.test(src),
            'statusbar shim missing recursive walk under matched key');
        assert.ok(/out\[key\] = _rdcRepl;/.test(src),
            'statusbar shim missing primitive redaction branch');
    });

    it('statusbar dist copy carries the primitive-only rule', function () {
        var dist = fs.readFileSync(
            path.join(FW, 'core/asset/plugin/dist/vendor/gina/html/statusbar.html'),
            'utf8'
        );
        assert.ok(/typeof val === 'object'/.test(dist),
            'dist statusbar.html missing primitive-only rule — rebuild plugin');
    });
});

describe('10 — Tokenize semantics (regression: real-world false positives)', function () {
    var compiled = redactor.compile(redactor.DEFAULT_PATTERNS);

    it('tokenize() splits camelCase boundaries', function () {
        assert.deepEqual(redactor.tokenize('apiKey'),           ['api', 'key']);
        assert.deepEqual(redactor.tokenize('companyName'),      ['company', 'name']);
        assert.deepEqual(redactor.tokenize('lastCompanyUsedId'), ['last', 'company', 'used', 'id']);
        assert.deepEqual(redactor.tokenize('XMLParser'),        ['xml', 'parser']);
    });

    it('tokenize() splits on separators _ - . [ ] : / whitespace', function () {
        assert.deepEqual(redactor.tokenize('api_key'),     ['api', 'key']);
        assert.deepEqual(redactor.tokenize('api-key'),     ['api', 'key']);
        assert.deepEqual(redactor.tokenize('api.key'),     ['api', 'key']);
        assert.deepEqual(redactor.tokenize('user[token]'), ['user', 'token']);
        assert.deepEqual(redactor.tokenize('auth/scope'),  ['auth', 'scope']);
        assert.deepEqual(redactor.tokenize('auth:scope'),  ['auth', 'scope']);
        assert.deepEqual(redactor.tokenize('api key'),     ['api', 'key']);
    });

    it('tokenize() lowercases every token', function () {
        var out = redactor.tokenize('PasswordRule');
        assert.deepEqual(out, ['password', 'rule']);
    });

    it('tokenize() returns [] for empty / non-string input', function () {
        assert.deepEqual(redactor.tokenize(''),        []);
        assert.deepEqual(redactor.tokenize(null),      []);
        assert.deepEqual(redactor.tokenize(undefined), []);
        assert.deepEqual(redactor.tokenize(42),        []);
    });

    it('does NOT false-positive on companyName (contains "pan" substring)', function () {
        // Pre-fix: /password|pwd|token|.../i.test('companyName') matched because
        // "compa[ny]" contains "pan" as a 3-char substring. Tokenize anchors on
        // whole tokens ("company", "name") so "pan" never matches.
        assert.equal(redactor.keyMatches('companyName',  compiled), false);
        assert.equal(redactor.keyMatches('CompanyName',  compiled), false);
        assert.equal(redactor.keyMatches('company_name', compiled), false);
        assert.equal(redactor.keyMatches('company-name', compiled), false);
    });

    it('does NOT false-positive on lastCompanyUsedId', function () {
        // Real-world Freelancer key that was being redacted pre-fix.
        assert.equal(redactor.keyMatches('lastCompanyUsedId',  compiled), false);
        assert.equal(redactor.keyMatches('LastCompanyUsedId',  compiled), false);
        assert.equal(redactor.keyMatches('last_company_used_id', compiled), false);
    });

    it('does NOT false-positive on other keys containing "pan" / "ssn" / "cvv" as substrings', function () {
        // Anchored tokens mean these keys pass through — only standalone tokens match.
        assert.equal(redactor.keyMatches('expansionPanel',    compiled), false);
        assert.equal(redactor.keyMatches('dessiner',          compiled), false);
        assert.equal(redactor.keyMatches('passenger',         compiled), false);
        assert.equal(redactor.keyMatches('lifespan',          compiled), false);
        assert.equal(redactor.keyMatches('lessons',           compiled), false);
        assert.equal(redactor.keyMatches('impression',        compiled), false);
    });

    it('does NOT false-positive on keys ending in "id" / "name" that do not contain a secret token', function () {
        assert.equal(redactor.keyMatches('userId',        compiled), false);
        assert.equal(redactor.keyMatches('firstName',     compiled), false);
        assert.equal(redactor.keyMatches('lastName',      compiled), false);
        assert.equal(redactor.keyMatches('emailAddress',  compiled), false);
        assert.equal(redactor.keyMatches('phoneNumber',   compiled), false);
    });

    it('STILL redacts bare secret tokens (control)', function () {
        assert.equal(redactor.keyMatches('password',       compiled), true);
        assert.equal(redactor.keyMatches('token',          compiled), true);
        assert.equal(redactor.keyMatches('secret',         compiled), true);
        assert.equal(redactor.keyMatches('apikey',         compiled), true);
        assert.equal(redactor.keyMatches('cvv',            compiled), true);
        assert.equal(redactor.keyMatches('ssn',            compiled), true);
        assert.equal(redactor.keyMatches('pan',            compiled), true);
        assert.equal(redactor.keyMatches('authorization',  compiled), true);
        assert.equal(redactor.keyMatches('credentials',    compiled), true);
    });

    it('STILL redacts camelCase / snake_case / kebab-case secret compounds (joined-tokens match)', function () {
        // apiKey → tokens ['api','key'] → joined 'apikey' → matches pattern 'apikey'
        assert.equal(redactor.keyMatches('apiKey',     compiled), true);
        assert.equal(redactor.keyMatches('api_key',    compiled), true);
        assert.equal(redactor.keyMatches('api-key',    compiled), true);
        assert.equal(redactor.keyMatches('API_KEY',    compiled), true);
        // privateKey → tokens ['private','key'] → joined 'privatekey' → matches pattern 'privatekey'
        assert.equal(redactor.keyMatches('privateKey',  compiled), true);
        assert.equal(redactor.keyMatches('private_key', compiled), true);
    });

    it('STILL redacts when a single token matches (mixed-compound case)', function () {
        // userPassword → tokens ['user','password'] → 'password' matches on per-token pass
        assert.equal(redactor.keyMatches('userPassword',    compiled), true);
        assert.equal(redactor.keyMatches('adminToken',      compiled), true);
        assert.equal(redactor.keyMatches('sharedSecret',    compiled), true);
        assert.equal(redactor.keyMatches('user_password',   compiled), true);
        assert.equal(redactor.keyMatches('auth[token]',     compiled), true);
    });

    it('redact() end-to-end — Freelancer bundle-like payload passes through non-secrets and redacts secrets', function () {
        var input = {
            user: {
                companyName       : 'ACME Corp',
                lastCompanyUsedId : 42,
                firstName         : 'Jane',
                emailAddress      : 'jane@acme.example',
                password          : 'hunter2',
                apiKey            : 'sk_live_xxx',
                preferences       : {
                    companyLogoUrl : 'https://cdn.example/logo.png',
                    passwordRule   : { minLength: 8 }
                }
            }
        };
        var out = redactor.redact(input);
        // Non-secret passthrough
        assert.equal(out.user.companyName,       'ACME Corp');
        assert.equal(out.user.lastCompanyUsedId, 42);
        assert.equal(out.user.firstName,         'Jane');
        assert.equal(out.user.emailAddress,      'jane@acme.example');
        assert.equal(out.user.preferences.companyLogoUrl, 'https://cdn.example/logo.png');
        // Secrets still redacted
        assert.equal(out.user.password, '[redacted]');
        assert.equal(out.user.apiKey,   '[redacted]');
        // NON_SECRET_SUFFIX carve-out kept intact
        assert.deepEqual(out.user.preferences.passwordRule, { minLength: 8 });
    });

    it('compiled patterns are anchored with ^(?:…)$ (whole-token match, no substring bleed)', function () {
        // Manually inspect a compiled RegExp to confirm anchoring.
        var c = redactor.compile(['password']);
        assert.equal(c.length, 1);
        // RegExp source should contain both anchors
        assert.ok(/\^/.test(c[0].source), 'pattern missing ^ anchor');
        assert.ok(/\$/.test(c[0].source), 'pattern missing $ anchor');
        // Substring of "password" must not match on its own (no bleed)
        assert.equal(c[0].test('pass'),      false);
        assert.equal(c[0].test('password'),  true);
        assert.equal(c[0].test('passwords'), false);
    });
});
