/**
 * Unit tests for the shared `settings.secrets` declaration validation:
 *   lib/secrets/src/declaration.js       — the one implementation (#B408)
 *   lib/secrets/src/main.js#selectBackend — runtime consumer
 *   lib/cmd/secrets/check.js             — CLI-gate consumer
 *
 * Why one implementation matters (#B408): the checker carried a hand-kept
 * mirror of the runtime's declaration guards, and it drifted twice, both
 * times LAX — the whitespace-only entry refusal (#B271) and the empty
 * path segment refusal (#B272) existed at boot only, so
 * `settings.secrets.file: [" "]` and a token-collapsed double-separator
 * path passed `secrets:check` GREEN while boot REFUSED. Sections 04/06
 * drive the shipped checker bytes (extract-and-execute, never a replica)
 * to lock the parity behaviourally; section 05 pins both consumers onto
 * the shared home so a third copy cannot quietly come back.
 *
 * Sections:
 *   01 — module shape + zero-setup load
 *   02 — validateFilePaths behaviour (real bytes, direct)
 *   03 — runtime parity: selectBackend throws the shared messages
 *   04 — checker parity: the shipped resolveSecretsFileChain flags what
 *        boot refuses (#B408 regression arms — red on the pre-fix bytes)
 *   05 — source pins: both consumers delegate; the old local copies are gone
 *   06 — three-way parity matrix (validator / runtime / checker)
 */
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert');
var fs     = require('node:fs');
var os     = require('node:os');
var path   = require('node:path');

var FRAMEWORK_ROOT = path.join(__dirname, '..', '..', 'framework');
var frameworkDir = fs.readdirSync(FRAMEWORK_ROOT).filter(function (d) {
    return /^v\d/.test(d) && fs.existsSync(path.join(FRAMEWORK_ROOT, d, 'lib/secrets/src/main.js'));
}).sort().pop();
var FW  = path.join(FRAMEWORK_ROOT, frameworkDir);
var LIB = path.join(FW, 'lib/secrets/src');

var secrets     = require(path.join(LIB, 'main.js'));
var declaration = require(path.join(LIB, 'declaration.js'));

var MAIN_SRC  = fs.readFileSync(path.join(LIB, 'main.js'), 'utf8');
var DECL_SRC  = fs.readFileSync(path.join(LIB, 'declaration.js'), 'utf8');
var CHECK_SRC = fs.readFileSync(path.join(FW, 'lib/cmd/secrets/check.js'), 'utf8');

/**
 * Comment-stripped view for negative + ordering pins: the retirement
 * comments in both consumers legitimately NAME the retired shapes (the
 * own-comment trap), so those negatives must read code only. Every use
 * pairs with an anti-vacuity anchor proving the stripping did not empty
 * the region the pin examines.
 *
 * ⚠️ Known limit, load-bearing for pin placement: the inline strip eats
 * from any `//` onward, INCLUDING one inside a string literal — so a
 * needle that itself contains `'//'` (the #B272 guard's code form) is
 * blinded by this view in BOTH directions: a positive reads a false
 * absence, and a negative goes stuck-TRUE. Every `//`-bearing needle
 * below therefore reads the RAW source, which is honest because no
 * comment in either consumer carries that code form (prose says
 * "empty path segment", never `indexOf('//')`).
 */
function stripComments(src) {
    return src.split('\n').map(function (l) {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) { return ''; }
        return l.replace(/\/\/.*$/, '');
    }).join('\n');
}

function cfg(file) {
    return { content: { settings: { secrets: (file === undefined ? {} : { file: file }) } } };
}

/**
 * Extract the shipped `resolveSecretsFileChain` closure from check.js and
 * compile it with stubbed closure dependencies — the real checker bytes,
 * not a replica (a replica is exactly what let #B408's drift go unseen).
 *
 * Terminator-anchored slice, NOT a brace walk: the function body carries
 * the string literal for the secret-placeholder guard, whose brace is
 * unbalanced by design, so a naive brace counter runs past the close.
 * Both anchor literals are uniqueness-guarded so the slice cannot drift.
 */
function extractChainResolver(src) {
    var DECL = 'var resolveSecretsFileChain = function';
    var TERM = 'var loadManifest = function';
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
    return new Function(
        'readEffectiveSettings', 'whisper', 'buildReps', 'JSON', 'UNRESOLVED_TOKEN', 'secrets',
        'return (' + rhs + ');'
    );
}

/**
 * Drive the extracted checker against one declared `file` value, with the
 * substitution stubbed to identity (token substitution is not under test
 * here — the validator receives the values as-handed, exactly as the
 * runtime receives the loader's post-substitution values).
 */
function runChain(declared) {
    var factory = extractChainResolver(CHECK_SRC);
    var jsonArg = {
        clone: function (x) { return JSON.parse(JSON.stringify(x)); },
        parse: JSON.parse,
        stringify: JSON.stringify
    };
    var fn = factory(
        function readEffectiveSettings() { return { secrets: { file: declared } }; },
        function whisper(reps, x) { return x; },
        function buildReps() { return {}; },
        jsonArg,
        /\$\{[^}]*\}/,          // pre-fix bytes reference this; post-fix bytes ignore it
        secrets                  // the real lib — readEnvFile + validateFilePaths
    );
    return fn('/tmp/does-not-matter', null, 'demo');
}

var TMP, GOODFILE;

before(function () {
    TMP      = fs.mkdtempSync(path.join(os.tmpdir(), 'gina-secdecl-'));
    GOODFILE = path.join(TMP, 'good.env');
    fs.writeFileSync(GOODFILE, 'FROM_FILE=file_value\n');
});

after(function () {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

describe('01 - module shape + zero-setup load', function () {

    it('declaration.js exports validateFilePaths, and main.js re-exports the SAME function', function () {
        assert.equal(typeof declaration.validateFilePaths, 'function');
        assert.strictEqual(secrets.validateFilePaths, declaration.validateFilePaths,
            'main.js must re-export declaration.js\'s function, not wrap or copy it');
    });

    it('the validator runs with zero ambient setup (this very process installed no globals)', function () {
        // This suite requires lib/secrets bare — no helpers tree, no _(),
        // no requireJSON — so a passing call here IS the zero-setup proof.
        assert.deepEqual(declaration.validateFilePaths(['/etc/app/base.env']), []);
    });
});

describe('02 - validateFilePaths behaviour (real bytes, direct)', function () {

    it('accepts a clean chain', function () {
        assert.deepEqual(declaration.validateFilePaths(['/etc/a.env', '/etc/b.env']), []);
    });

    it('refuses a non-string entry (file-entry-shape)', function () {
        var errs = declaration.validateFilePaths([123]);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'file-entry-shape');
        assert.match(errs[0].message, /non-empty string or an array/);
    });

    it('#B271 refuses a whitespace-only entry — trim, not just an empty check', function () {
        var errs = declaration.validateFilePaths([' ']);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'file-entry-shape');
    });

    it('a path with an INTERNAL space is not a shape error (trim bounds the refusal)', function () {
        assert.deepEqual(declaration.validateFilePaths(['/etc/my app/a.env']), []);
    });

    it('refuses a secret placeholder (file-secret-placeholder)', function () {
        var errs = declaration.validateFilePaths(['${secret:KEY_NAME}']);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'file-secret-placeholder');
    });

    it('the placeholder verdict WINS over the token verdict — a secret placeholder is also a ${…} token', function () {
        // Guard order is load-bearing: the token regex matches `${secret:…}`
        // too, so a reordering would misreport the placeholder as a typo.
        assert.equal(declaration.validateFilePaths(['${secret:KEY_NAME}'])[0].code, 'file-secret-placeholder');
    });

    it('refuses an unresolved token (file-unresolved-token), naming the path', function () {
        var errs = declaration.validateFilePaths(['${nope}/secrets.env']);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'file-unresolved-token');
        assert.match(errs[0].message, /\$\{nope\}\/secrets\.env/);
    });

    it('#B272 refuses an empty path segment (file-empty-segment)', function () {
        var errs = declaration.validateFilePaths(['/home/u//secrets.env']);
        assert.equal(errs.length, 1);
        assert.equal(errs[0].code, 'file-empty-segment');
        assert.match(errs[0].message, /empty path segment/);
    });

    it('first-error-wins, entries in order — one error at most', function () {
        var errs = declaration.validateFilePaths(['/a//b.env', ' ']);
        assert.equal(errs.length, 1, 'at most one error, mirroring the runtime throw-on-first');
        assert.equal(errs[0].code, 'file-empty-segment', 'entry order decides which fires');
    });
});

describe('03 - runtime parity: selectBackend throws the shared messages', function () {

    // The strict message equality is the point: the runtime throws the
    // validator's text VERBATIM, so the two surfaces cannot diverge on
    // what they tell an operator.
    [
        { label: 'whitespace-only entry (#B271)', value: [' '] },
        { label: 'non-string entry',              value: [123] },
        { label: 'secret placeholder',            value: ['${secret:KEY_NAME}'] },
        { label: 'unresolved token',              value: ['${nope}/secrets.env'] },
        { label: 'empty path segment (#B272)',    value: ['/home/u//secrets.env'] }
    ].forEach(function (arm) {
        it('selectBackend(' + arm.label + ') throws the validator\'s own message', function () {
            var expected = declaration.validateFilePaths(arm.value)[0].message;
            var thrown = null;
            try { secrets.selectBackend(cfg(arm.value)); } catch (e) { thrown = e; }
            assert.ok(thrown, 'selectBackend must refuse this declaration');
            assert.strictEqual(thrown.message, expected);
        });
    });

    it('control: a clean declaration still builds the file backend (the refusals discriminate)', function () {
        var backend = secrets.selectBackend(cfg([GOODFILE]));
        assert.equal(typeof backend.resolve, 'function');
        assert.equal(backend.resolve('FROM_FILE'), 'file_value');
    });
});

describe('04 - checker parity: the shipped resolveSecretsFileChain flags what boot refuses', function () {

    it('extraction control: the checker closure compiles from the shipped bytes', function () {
        assert.equal(typeof extractChainResolver(CHECK_SRC), 'function');
    });

    it('#B408 regression: a whitespace-only entry is an ERROR, not a silently-statted path', function () {
        // Pre-fix bytes: the raw-entry loop accepted " " (non-empty string),
        // statted it, read ENOENT as a benign absence, and reported GREEN —
        // while boot throws. This arm is red on those bytes.
        var out = runChain([' ']);
        assert.ok(out.errors.length > 0, 'the checker must refuse what boot refuses');
        assert.match(out.errors[0], /non-empty string or an array/);
    });

    it('#B408 regression: an empty path segment is an ERROR, not a benign absent layer', function () {
        var out = runChain(['/home/u//secrets.env']);
        assert.ok(out.errors.length > 0, 'the checker must refuse what boot refuses');
        assert.match(out.errors[0], /empty path segment/);
    });

    it('an invalid declaration reads NO layer — the runtime reads no file on one either', function () {
        var out = runChain([GOODFILE, ' ']);
        assert.ok(out.errors.length > 0);
        assert.equal(out.layers.length, 0,
            'validation precedes the reads: boot never opens any layer of an invalid chain');
        assert.equal(out.map, null);
    });

    it('the unresolved-token verdict carries the shared message PLUS the CLI-only hint', function () {
        var out = runChain(['${nope}/secrets.env']);
        assert.equal(out.errors.length, 1);
        var shared = declaration.validateFilePaths(['${nope}/secrets.env'])[0].message;
        assert.ok(out.errors[0].indexOf(shared) === 0,
            'the checker message must START with the shared text (surface adds, never forks)');
        assert.match(out.errors[0], /pass --scope\/--env/);
    });

    it('control: a clean chain still layers and maps (the refusals discriminate)', function () {
        var out = runChain([GOODFILE]);
        assert.equal(out.errors.length, 0);
        assert.equal(out.declared, true);
        assert.equal(out.layers.length, 1);
        assert.equal(out.layers[0].found, true);
        assert.equal(out.map.FROM_FILE, 'file_value');
    });

    it('control: an absent file among the layers stays a benign absence, not an error', function () {
        var out = runChain([path.join(TMP, 'not-there.env'), GOODFILE]);
        assert.equal(out.errors.length, 0);
        assert.equal(out.layers.length, 2);
        assert.equal(out.layers[0].found, false);
        assert.equal(out.map.FROM_FILE, 'file_value');
    });
});

describe('05 - source pins: both consumers delegate; the old local copies are gone', function () {

    var mainStripped  = stripComments(MAIN_SRC);
    var checkStripped = stripComments(CHECK_SRC);

    it('selectBackend delegates to declaration.validateFilePaths', function () {
        assert.match(mainStripped, /declErrors\s*=\s*declaration\.validateFilePaths\(/);
    });

    it('main.js no longer carries a local copy of the guards', function () {
        // Code forms of the retired loop — comments naming them are stripped.
        assert.ok(mainStripped.indexOf("p.trim() === ''") < 0, 'trim guard must live in declaration.js only');
        assert.ok(mainStripped.indexOf("p.indexOf('${secret:')") < 0, 'placeholder guard must live in declaration.js only');
        // The `//`-bearing needle reads RAW source — the strip would eat the
        // string-internal `//` and leave this negative stuck-TRUE (see the
        // stripComments docblock). No main.js comment carries the code form.
        assert.ok(MAIN_SRC.indexOf("p.indexOf('//')") < 0, 'empty-segment guard must live in declaration.js only');
        // Anti-vacuity: the stripping left the delegation site in view.
        assert.ok(mainStripped.indexOf('validateFilePaths') > -1, 'stripping emptied the source — pins would pass vacuously');
    });

    it('check.js delegates to secrets.validateFilePaths, BEFORE any layer read', function () {
        assert.match(checkStripped, /declErrors\s*=\s*secrets\.validateFilePaths\(/);
        var callAt = checkStripped.indexOf('secrets.validateFilePaths(');
        var readAt = checkStripped.indexOf('secrets.readEnvFile(path)');
        assert.ok(callAt > -1 && readAt > -1, 'both sites must exist');
        assert.ok(callAt < readAt, 'validation must precede the layer reads, as it does at boot');
    });

    it('check.js no longer carries a local mirror', function () {
        // The retired constant and the retired raw-entry loop, code forms only —
        // the retirement comment names UNRESOLVED_TOKEN, hence the strip.
        assert.ok(checkStripped.indexOf('UNRESOLVED_TOKEN') < 0, 'the local token regex must be retired');
        assert.ok(checkStripped.indexOf("raw[i].indexOf('${secret:')") < 0, 'the raw-entry loop must be retired');
        // Anti-vacuity: the stripping left the chain resolver in view.
        assert.ok(checkStripped.indexOf('secrets.readEnvFile(path)') > -1, 'stripping emptied the source — pins would pass vacuously');
    });

    it('the CLI hint is keyed on the shared error CODE, not on re-detected text', function () {
        assert.match(checkStripped, /file-unresolved-token/);
        assert.match(CHECK_SRC, /pass --scope\/--env if it names one/);
    });

    it('declaration.js carries all four guards in code form', function () {
        // All four on RAW source with FULL code forms no prose carries —
        // the `//` needle in particular is blinded by stripComments (its
        // string-internal `//` reads as an inline comment), and the full
        // forms cannot be satisfied by a docblock mention.
        assert.ok(DECL_SRC.indexOf("typeof p !== 'string' || p.trim() === ''") > -1);
        assert.ok(DECL_SRC.indexOf("p.indexOf('${secret:') > -1") > -1);
        assert.ok(DECL_SRC.indexOf('TOKEN_RE.test(p)') > -1);
        assert.ok(DECL_SRC.indexOf("p.indexOf('//') > -1") > -1);
    });
});

describe('06 - three-way parity matrix (validator / runtime / checker)', function () {

    [
        [' '],
        [123],
        ['${secret:KEY_NAME}'],
        ['${nope}/secrets.env'],
        ['/home/u//secrets.env']
    ].forEach(function (value) {
        it('one verdict for ' + JSON.stringify(value) + ' on all three surfaces', function () {
            var shared = declaration.validateFilePaths(value);
            assert.equal(shared.length, 1, 'matrix rows are all invalid declarations');

            var thrown = null;
            try { secrets.selectBackend(cfg(value)); } catch (e) { thrown = e; }
            assert.ok(thrown, 'the runtime must refuse');
            assert.strictEqual(thrown.message, shared[0].message);

            var out = runChain(value);
            assert.ok(out.errors.length > 0, 'the checker must refuse');
            assert.ok(out.errors[0].indexOf(shared[0].message) === 0,
                'the checker message must start with the shared text');
        });
    });
});
