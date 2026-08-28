'use strict';
/**
 * Log redaction (#B433) — `settings.log.redact`, applied at the logger's
 * pre-render choke point.
 *
 * The HTTP access line (and 45 sibling framework sites) log `request.url`
 * verbatim, so a credential carried in a URL reached stdout in plaintext with
 * no seam to redact it. The fix: `lib/logger/src/redact.js`, a pure engine
 * compiled from a bundle's `log.redact` block and applied inside `emit()` —
 * the single point where every levelled message exists as a string before
 * any sink renders it — plus the raw `console.log` path.
 *
 * Covered:
 *   01  engine — the built-in set masks credential shapes (positives)
 *   02  engine — the built-in set leaves non-credential text alone (negatives / false-positive controls)
 *   03  engine — block validation is fail-closed (unknown key, non-boolean, invalid / empty-matching pattern)
 *   04  engine — consumer patterns: string + object forms, `g` enforced, `$1` replacement, dedup
 *   05  engine — union semantics across blocks; disabled ⇒ null state; idempotent apply
 *   06  engine — resolved secret values: verbatim mask, longest-first, short values skipped + reported
 *   07  lib/secrets — getResolvedValues() returns {path, value} for every substitution
 *   08  ordering — redacting the MESSAGE keeps JSON mode valid; redacting the RENDERED line would not (the design proof)
 *   09  logger — the real singleton: setRedaction() reaches emit() (every container) and the raw console.log path
 *   10  source pins — the seam sits in emit() before the envelope; the config.js seam reads the resolved object
 *
 * Section 09 requires the real lib/logger (its module-level init dials the MQ
 * speaker unless GINA_LOG_STDOUT=true is set BEFORE the require, which strips
 * the mq flow). node --test runs each file in its own process, so the
 * singleton state set here cannot leak into other suites.
 */

var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var FRAMEWORK   = path.resolve(require('../fw'));
var REDACT_SRC  = path.join(FRAMEWORK, 'lib/logger/src/redact.js');
var MAIN_SRC    = path.join(FRAMEWORK, 'lib/logger/src/main.js');
var CONFIG_SRC  = path.join(FRAMEWORK, 'core/config.js');
var SECRETS_SRC = path.join(FRAMEWORK, 'lib/secrets/src/main.js');
var TEMPLATE    = path.join(FRAMEWORK, 'core/template/conf/settings.json');
var SCHEMA      = path.resolve(__dirname, '../../schema/settings.json');

var redact = require(REDACT_SRC);
var M      = redact.MARKER;

// A 64-hex value: a sha256 content-address key (storage) and an opaque bearer
// credential share this shape, which is why it is NOT a default.
var HEX64 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
var JWT   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

function defaults() { return redact.compileState([redact.compileBlock()]); }


// ─── 01  built-in set — positives ───────────────────────────────────────────
describe('01 - built-in set masks credential shapes', function () {
    var st = defaults();

    it('named credential query keys: the key survives, the value is masked', function () {
        assert.equal(redact.apply(st, 'GET [200] /reset?token=8f3a9c2e1b7d&x=1'), 'GET [200] /reset?token=' + M + '&x=1');
        assert.equal(redact.apply(st, 'GET [302] /cb?access_token=ya29.a0AfH6SMB&expires=3600'), 'GET [302] /cb?access_token=' + M + '&expires=3600');
        assert.equal(redact.apply(st, 'GET [200] /dl?sig=MEUCIQDx7b3'), 'GET [200] /dl?sig=' + M);
        assert.equal(redact.apply(st, 'GET [200] /api?api_key=AIzaSyD-9tSrke72'), 'GET [200] /api?api_key=' + M);
        assert.equal(redact.apply(st, 'POST [200] /login  Authorization: Bearer ' + JWT), 'POST [200] /login  Authorization: Bearer ' + M);
    });

    it('a bare JWT anywhere in the line is masked', function () {
        assert.equal(redact.apply(st, 'cookie=' + JWT + '; path=/'), 'cookie=' + M + '; path=/');
    });

    it('URL userinfo: the user survives, the password is masked', function () {
        assert.equal(redact.apply(st, 'proxy target https://svc:S3cr3tP%40ss@internal.host:8443/v1'),
            'proxy target https://svc:' + M + '@internal.host:8443/v1');
    });

    it('Basic credentials and api-key headers are masked', function () {
        assert.equal(redact.apply(st, 'authorization: Basic dXNlcjpwYXNzd29yZDEyMw=='), 'authorization: Basic ' + M);
        assert.equal(redact.apply(st, 'x-api-key: 7c9e6679-7425-40de-944b-e07fc1f90ae7'), 'x-api-key: ' + M);
    });

    it('the #ERRREF shape: the URL copy inside the error stack on the continuation line is masked too', function () {
        var line = '[ ref abc ][ req 12 ] GET [ 404 ] /invite?otp=482913\nError: route not found for /invite?otp=482913';
        var out  = redact.apply(st, line);
        assert.equal(out, '[ ref abc ][ req 12 ] GET [ 404 ] /invite?otp=' + M + '\nError: route not found for /invite?otp=' + M);
        assert.equal(out.split(M).length - 1, 2, 'both copies masked');
    });

    it('every occurrence on a line is masked (the g flag)', function () {
        assert.equal(redact.apply(st, 'a?token=one b?token=two'), 'a?token=' + M + ' b?token=' + M);
    });
});


// ─── 02  built-in set — negatives (false-positive controls) ─────────────────
describe('02 - built-in set leaves non-credential text alone', function () {
    var st = defaults();
    var NEG = [
        'GET [200] /files/' + HEX64,                                     // storage CAS key — deliberately NOT a default
        'GET [200] /objects/' + HEX64 + '/original.png',
        'GET [200] /users/7c9e6679-7425-40de-944b-e07fc1f90ae7',         // a UUID path segment
        'GET [200] /list?page=2&sort=name&code=FR&key=name&session=1',   // generic keys (code, key, session)
        'GET [200] /search?q=bearer%20authentication&tokenizer=basic',
        'Bearer authentication is configured; Basic authentication is disabled',  // prose
        'connected to redis://cache.internal:6379/0 in 12ms',
        'fetch https://example.com:8443/path@v2/file',
        'user john.doe@example.com signed in at 2026-08-28T10:00:00.000Z',
        '{"id":"' + HEX64 + '","sha":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}',
        'GET [200] /assets/app.3f2a9c1b.min.js',
        'validator token count=3 secret_key_len=32',
        'my_token=abc mytoken=def'                                        // `_` / letters before the key: not the key
    ];

    it('none of the negatives is altered', function () {
        NEG.forEach(function (l) { assert.equal(redact.apply(st, l), l, 'false positive on: ' + l); });
    });

    it('CONTROL: the same state does alter a positive (the instrument can fire)', function () {
        assert.notEqual(redact.apply(st, 'GET [200] /r?token=abc'), 'GET [200] /r?token=abc');
    });

    it('selectivity: a same-length same-class value without a credential prefix passes byte-unchanged', function () {
        var l = 'GET [200] /objects/' + HEX64;
        assert.equal(redact.apply(st, l), l);
    });

    it('a consumer whose credentials ARE bare 64-hex opts in with one pattern', function () {
        var st2 = redact.compileState([redact.compileBlock({ patterns: ['\\b[0-9a-f]{64}\\b'] })]);
        assert.equal(redact.apply(st2, 'GET [200] /files/' + HEX64), 'GET [200] /files/' + M);
    });
});


// ─── 03  block validation is fail-closed ────────────────────────────────────
describe('03 - block validation is fail-closed', function () {

    it('an absent block compiles to everything-on', function () {
        assert.deepEqual(redact.compileBlock(undefined), { enabled: true, defaults: true, secrets: true, patterns: [] });
        assert.deepEqual(redact.compileBlock(null),      { enabled: true, defaults: true, secrets: true, patterns: [] });
    });

    it('an unknown key is refused (a typo would otherwise drop a rule silently)', function () {
        assert.throws(function () { redact.compileBlock({ pattern: ['x'] }, 'api'); }, /unknown key `pattern`/);
    });

    it('flags must be STRICT booleans', function () {
        assert.throws(function () { redact.compileBlock({ enabled: 'false' }, 'api'); }, /`settings\.log\.redact\.enabled` \(api\) must be a strict boolean/);
        assert.throws(function () { redact.compileBlock({ defaults: 1 }, 'api'); }, /strict boolean/);
        assert.throws(function () { redact.compileBlock({ secrets: null }, 'api'); }, /strict boolean/);
    });

    it('a non-object block, a non-array patterns, and a bad entry are refused', function () {
        assert.throws(function () { redact.compileBlock([], 'api'); }, /must be an object/);
        assert.throws(function () { redact.compileBlock({ patterns: 'x' }, 'api'); }, /must be an array/);
        assert.throws(function () { redact.compileBlock({ patterns: [42] }, 'api'); }, /patterns\[0\]/);
        assert.throws(function () { redact.compileBlock({ patterns: [{ flags: 'g' }] }, 'api'); }, /`pattern` must be a non-empty regex source string/);
        assert.throws(function () { redact.compileBlock({ patterns: [{ pattern: 'x', replacement: 1 }] }, 'api'); }, /`replacement` must be a string/);
    });

    it('an invalid regex is refused with the engine message', function () {
        assert.throws(function () { redact.compileBlock({ patterns: ['('] }, 'api'); }, /invalid regular expression/);
    });

    it('a pattern matching the empty string is refused', function () {
        assert.throws(function () { redact.compileBlock({ patterns: ['a*'] }, 'api'); }, /matches the empty string/);
    });
});


// ─── 04  consumer patterns ──────────────────────────────────────────────────
describe('04 - consumer patterns', function () {

    it('string form: the whole match becomes the marker', function () {
        var st = redact.compileState([redact.compileBlock({ defaults: false, patterns: ['inv_[0-9]+'] })]);
        assert.equal(redact.apply(st, 'GET /i/inv_42 inv_7'), 'GET /i/' + M + ' ' + M);
    });

    it('object form: flags, $1 replacement, name', function () {
        var st = redact.compileState([redact.compileBlock({ defaults: false, patterns: [
            { pattern: '(invite=)[^&\\s]+', flags: 'i', replacement: '$1' + M, name: 'invites' }
        ] })]);
        assert.equal(redact.apply(st, 'GET /j?INVITE=abc&invite=def'), 'GET /j?INVITE=' + M + '&invite=' + M);
        assert.equal(st.rules[0].name, 'invites');
        assert.ok(st.rules[0].re.flags.indexOf('g') > -1, 'g is enforced even when the consumer omitted it');
    });

    it('a duplicate rule collapses to one', function () {
        var st = redact.compileState([
            redact.compileBlock({ defaults: false, patterns: ['dup'] }, 'a'),
            redact.compileBlock({ defaults: false, patterns: ['dup', 'dup'] }, 'b')
        ]);
        assert.equal(st.rules.length, 1);
    });
});


// ─── 05  union semantics / disabled / idempotence ───────────────────────────
describe('05 - union semantics, disabled state, idempotence', function () {

    it('no blocks ⇒ null state ⇒ apply() is a pass-through', function () {
        assert.equal(redact.compileState([]), null);
        assert.equal(redact.apply(null, 'GET /r?token=abc'), 'GET /r?token=abc');
    });

    it('every block disabled ⇒ null state', function () {
        assert.equal(redact.compileState([redact.compileBlock({ enabled: false })]), null);
    });

    it('one bundle enabling redaction is enough for the union to redact', function () {
        var st = redact.compileState([redact.compileBlock({ enabled: false }, 'a'), redact.compileBlock({}, 'b')]);
        assert.ok(st && st.enabled);
        assert.equal(redact.apply(st, 'GET /r?token=abc'), 'GET /r?token=' + M);
    });

    it('a disabled bundle contributes no patterns; defaults follow an enabled bundle', function () {
        var st = redact.compileState([
            redact.compileBlock({ enabled: false, patterns: ['secret-a'] }, 'a'),
            redact.compileBlock({ defaults: false, patterns: ['secret-b'] }, 'b')
        ]);
        assert.equal(st.rules.length, 1);
        assert.equal(redact.apply(st, 'secret-a secret-b ?token=x'), 'secret-a ' + M + ' ?token=x');
    });

    it('apply() is idempotent: a redacted line re-redacts to itself', function () {
        var st   = defaults();
        var once = redact.apply(st, 'GET /r?token=abc Bearer ' + 'x'.repeat(30) + ' ' + JWT);
        assert.equal(redact.apply(st, once), once);
    });

    it('non-string content passes through untouched', function () {
        var st = defaults();
        assert.equal(redact.apply(st, ''), '');
        assert.equal(redact.apply(st, undefined), undefined);
        assert.equal(redact.apply(st, 42), 42);
    });
});


// ─── 06  resolved secret values ─────────────────────────────────────────────
describe('06 - resolved secret values are masked verbatim', function () {

    it('a secret value is masked wherever it appears, before any pattern runs', function () {
        var st = redact.compileState([redact.compileBlock({ defaults: false })], ['correct-horse-battery']);
        assert.equal(st.secretCount, 1);
        assert.equal(redact.apply(st, 'couchbase://correct-horse-battery@db ok correct-horse-battery'),
            'couchbase://' + M + '@db ok ' + M);
    });

    it('longest value first: a value that is a prefix of another cannot leave the tail in the clear', function () {
        var st = redact.compileState([redact.compileBlock({ defaults: false })], ['abcdefgh', 'abcdefgh-longer-tail']);
        assert.equal(redact.apply(st, 'x abcdefgh-longer-tail y'), 'x ' + M + ' y');
    });

    it('regex metacharacters in a value are literal', function () {
        var st = redact.compileState([redact.compileBlock({ defaults: false })], ['p4ss.w0rd(1)+']);
        assert.equal(redact.apply(st, 'pw=p4ss.w0rd(1)+ pw2=p4ssXw0rd(1)+'), 'pw=' + M + ' pw2=p4ssXw0rd(1)+');
    });

    it('the secrets flag OFF drops the values; too-short values are skipped and reported with their path', function () {
        var parts = redact.partitionSecrets([{ path: 'db.password', value: 'correct-horse' }, { path: 'pin', value: '1234' }, { path: 'n', value: 42 }]);
        assert.deepEqual(parts, { values: ['correct-horse'], skipped: ['pin'] });
        var st = redact.compileState([redact.compileBlock({ defaults: false })], ['1234']);
        assert.equal(st, null, 'a too-short value alone yields nothing to apply');
    });
});


// ─── 07  lib/secrets.getResolvedValues ──────────────────────────────────────
describe('07 - lib/secrets getResolvedValues()', function () {
    var secrets = require(SECRETS_SRC);

    it('returns {path, value} for every substitution, on the SAME object resolve() walked', function () {
        process.env.B433_T_A = 'battery-staple';
        process.env.B433_T_B = 'staple-battery';
        var conf = { db: { password: '${secret:B433_T_A}' }, items: ['${secret:B433_T_B}', 'literal'], mixed: 'pre-${secret:B433_T_A}-post' };
        secrets.resolve(conf);
        assert.deepEqual(secrets.getResolvedValues(conf), [
            { path: 'db.password', value: 'battery-staple' },
            { path: 'items[0]',    value: 'staple-battery' }
        ]);
        delete process.env.B433_T_A; delete process.env.B433_T_B;
    });

    it('an unresolved or non-object config yields []', function () {
        assert.deepEqual(secrets.getResolvedValues({}), []);
        assert.deepEqual(secrets.getResolvedValues(null), []);
    });
});


// ─── 08  the ordering proof: redact the MESSAGE, never the rendered line ────
describe('08 - redacting the message keeps JSON mode valid (design proof)', function () {
    var st = defaults();

    it('pre-render: the JSON line stays parseable and carries the masked message', function () {
        var msg  = redact.apply(st, 'GET /r?token=abc');
        var line = JSON.stringify({ ts: 't', level: 'info', bundle: 'b', message: msg, group: 'b', msg: msg });
        var o    = JSON.parse(line);
        assert.equal(o.message, 'GET /r?token=' + M);
    });

    it('SUBTRACT: the same rules applied to the RENDERED JSON line eat its structure', function () {
        var line = JSON.stringify({ ts: 't', level: 'info', bundle: 'b', message: 'GET /r?token=abc', group: 'b', msg: 'GET /r?token=abc' });
        var post = redact.apply(st, line);   // the querykey rule's [^&\s#'"]+ stops at the quote…
        // …so this particular default survives; a consumer rule as loose as `token=\S+` would not:
        var loose = redact.compileState([redact.compileBlock({ defaults: false, patterns: ['token=\\S+'] })]);
        var eaten = redact.apply(loose, line);
        assert.throws(function () { JSON.parse(eaten); }, 'a post-render application with a loose consumer rule must corrupt the JSON');
        assert.doesNotThrow(function () { JSON.parse(post); });
        // and the pre-render form of the same loose rule is fine by construction:
        var safe = JSON.stringify({ message: redact.apply(loose, 'GET /r?token=abc') });
        assert.equal(JSON.parse(safe).message, 'GET /r?' + M);
    });
});


// ─── 09  the real logger singleton ──────────────────────────────────────────
describe('09 - the logger singleton: setRedaction() reaches emit() and the raw path', function () {
    var logger, savedStdout;
    var frames = [];

    before(function () {
        // strip the mq flow BEFORE the module-level init dials it
        process.env.GINA_LOG_STDOUT = 'true';
        logger = require(MAIN_SRC);
        process.on('logger#default', function (p) { frames.push(JSON.parse(p)); });
    });
    after(function () {
        process.removeAllListeners('logger#default');
        delete process.env.GINA_LOG_STDOUT;
    });

    function contentOf(needle) {
        var f = frames.filter(function (x) { return x.content.indexOf(needle) > -1; });
        return f.length ? f[f.length - 1].content : null;
    }

    it('before setRedaction(): a levelled line passes through verbatim (the pre-fix shape)', function () {
        logger.warn('phase0 GET [200] /r?token=abcdef123456');
        assert.ok(contentOf('phase0'), 'the frame reached logger#default');
        assert.ok(contentOf('phase0').indexOf('token=abcdef123456') > -1);
    });

    it('setRedaction() with the defaults + a resolved secret masks a levelled line at the emit seam', function () {
        var summary = logger.setRedaction(undefined, { group: 'redact-test@app', secrets: [{ path: 'db.password', value: 'correct-horse-battery' }, { path: 'pin', value: '12' }] });
        assert.equal(summary.enabled, true);
        assert.equal(summary.rules, redact.DEFAULT_RULES.length);
        assert.equal(summary.secrets, 1);
        assert.deepEqual(summary.skippedSecrets, ['pin']);
        assert.equal(summary.minSecretLength, redact.MIN_SECRET_LENGTH);

        logger.warn('phase1 GET [200] /r?token=abcdef123456 pw=correct-horse-battery');
        var c = contentOf('phase1');
        assert.ok(c, 'the frame reached logger#default');
        assert.ok(c.indexOf('token=' + M) > -1, 'token masked: ' + c);
        assert.ok(c.indexOf('pw=' + M) > -1, 'secret value masked: ' + c);
        assert.ok(c.indexOf('abcdef123456') < 0 && c.indexOf('correct-horse') < 0, 'no raw value survives');
    });

    it('the error level (the #ERRREF ref line shape, with a continuation line) is masked too', function () {
        logger.error('phase2 [ ref x ][ req 1 ] GET [ 404 ] /i?otp=4829\nError: route not found for /i?otp=4829');
        var c = contentOf('phase2');
        assert.ok(c, 'the frame reached logger#default');
        assert.equal(c.split(M).length - 1, 2, 'both copies masked: ' + JSON.stringify(c));
    });

    it('the raw console.log path masks too (it bypasses emit)', function () {
        var captured = [];
        savedStdout = process.stdout.write;
        process.stdout.write = function (s) { captured.push(String(s)); return true; };
        try { logger.log('phase3 GET [200] /r?token=abcdef123456'); }
        finally { process.stdout.write = savedStdout; }
        var line = captured.join('');
        assert.ok(line.indexOf('phase3') > -1, 'the raw line was written');
        assert.ok(line.indexOf('token=' + M) > -1 && line.indexOf('abcdef123456') < 0, 'raw path masked: ' + line);
    });

    it('a second bundle disabling redaction does NOT switch it off (union), and a malformed block throws without installing', function () {
        logger.setRedaction({ enabled: false }, { group: 'other@app' });
        logger.warn('phase4 GET [200] /r?token=abcdef123456');
        assert.ok(contentOf('phase4').indexOf('token=' + M) > -1, 'still redacting after another bundle opted out');
        assert.throws(function () { logger.setRedaction({ patterns: ['('] }, { group: 'bad@app' }); }, /invalid regular expression/);
        logger.warn('phase5 GET [200] /r?token=abcdef123456');
        assert.ok(contentOf('phase5').indexOf('token=' + M) > -1, 'the failed install left the prior state intact');
    });

    it('re-installing the SAME group replaces its contribution (config reload semantics)', function () {
        logger.setRedaction({ enabled: false }, { group: 'redact-test@app' });
        logger.setRedaction({ enabled: false }, { group: 'other@app' });
        logger.warn('phase6 GET [200] /r?token=abcdef123456');
        assert.ok(contentOf('phase6').indexOf('token=abcdef123456') > -1, 'every bundle off ⇒ pass-through again');
    });
});


// ─── 10  source pins ────────────────────────────────────────────────────────
describe('10 - source pins: the seam sits where the design says', function () {
    var main   = fs.readFileSync(MAIN_SRC, 'utf8');
    var config = fs.readFileSync(CONFIG_SRC, 'utf8');

    it('emit() redacts BEFORE the envelope is minted (one pass per message, inside the string)', function () {
        var emitIdx   = main.indexOf('var emit = function(opt, severity, content, skipFormating) {');
        var applyIdx  = main.indexOf('content = redact.apply(ctx._redact.state, content);', emitIdx);
        var minted    = main.indexOf("process.emit('logger#'+container, JSON.stringify({", emitIdx);
        assert.ok(emitIdx > -1 && applyIdx > -1 && minted > -1, 'anchors present');
        assert.ok(applyIdx < minted, 'redact.apply precedes the envelope JSON.stringify');
        // and it sits above the per-flow loop, so it runs once per message
        var loopIdx = main.indexOf('for (let i=0, len=opt.flows.length; i<len; i++) {', emitIdx);
        assert.ok(applyIdx < loopIdx, 'redact.apply precedes the per-flow loop');
    });

    it('self.log redacts before its JSON / raw write', function () {
        var logIdx   = main.indexOf('self.log = function() {');
        var applyIdx = main.indexOf('content = redact.apply(ctx._redact.state, content);', logIdx);
        var jsonGate = main.indexOf("if ( opt.format === 'json' ) {", logIdx);
        assert.ok(logIdx > -1 && applyIdx > -1 && jsonGate > -1, 'anchors present');
        assert.ok(applyIdx < jsonGate, 'redaction precedes the render fork');
    });

    it('the redaction state lives on the persisted context, not on a group option', function () {
        assert.match(main, /ctx\._redact = \{ blocks: \{\}, secrets: \{\}, state: null \};/);
        assert.doesNotMatch(main, /opt\._redact/);
    });

    it("config.js installs the block right after the bundle's secrets resolve, reading the SAME resolved object", function () {
        var resolveIdx = config.indexOf('secrets.resolve(self.envConf[bundle][env], secretsBackend);');
        var installIdx = config.indexOf('console.setRedaction(_redactBlock, {', resolveIdx);
        var valuesIdx  = config.indexOf('secrets.getResolvedValues(self.envConf[bundle][env])', resolveIdx);
        var i18nIdx    = config.indexOf("// #I18N — eager-load this bundle's message catalogs", resolveIdx);
        assert.ok(resolveIdx > -1 && installIdx > -1 && valuesIdx > -1 && i18nIdx > -1, 'anchors present');
        assert.ok(installIdx < i18nIdx, 'the seam sits before the i18n catalog load (i.e. inside the per-bundle config step)');
        assert.ok(valuesIdx > installIdx && valuesIdx < i18nIdx, 'values are read off the resolved envConf object');
        // fail-closed: the seam's catch returns the error through the config callback
        var catchIdx = config.indexOf('} catch (redactErr) {', installIdx);
        assert.ok(catchIdx > -1 && config.indexOf('return callback(redactErr);', catchIdx) > -1, 'a malformed block refuses the config load');
    });

    it('the defaults template ships the block ON, and the schema declares it', function () {
        var tpl = fs.readFileSync(TEMPLATE, 'utf8');
        assert.match(tpl, /"log":\s*\{\s*"redact":\s*\{\s*"enabled":\s*true,\s*"defaults":\s*true,\s*"secrets":\s*true,\s*"patterns":\s*\[\]\s*\}\s*\}/);
        var schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
        assert.equal(schema.properties.log.additionalProperties, false);
        assert.deepEqual(Object.keys(schema.properties.log.properties.redact.properties), ['enabled', 'defaults', 'secrets', 'patterns']);
    });
});
