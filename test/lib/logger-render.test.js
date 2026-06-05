'use strict';
/**
 * Logger render mode (#M12a) — opt-in structured (JSON) logging.
 *
 * The default render format is `text` (the coloured, human-readable line that
 * docker / OrbStack `docker logs` show). JSON mode is opt-in and resolved ONCE at
 * logger init into `opt.format`; the default container then renders accordingly.
 *
 * Covered:
 *   01  main.js resolves opt.format (GINA_LOG_FORMAT > GINA_LOG_STDOUT alias > text) — source
 *   02  default container render branch (opt.format read; additive JSON keys) — source
 *   03  JSON mode emits {ts, level, bundle, message} + back-compat {group, msg} — behavioral
 *   04  text is the default; format() passthrough is not JSON — behavioral
 *   05  console.log raw path (self.log) honours JSON mode — source
 *
 * The behavioral cases drive the DefaultContainer directly with a mock `opt` — the
 * same seam the framework uses (loadContainers() JSON.clone()s opt into each
 * container) — capture process.stdout.write, and emit a `logger#default` payload.
 * No full bundle boot is required.
 */

var { describe, it } = require('node:test');
var assert           = require('node:assert/strict');
var fs               = require('fs');
var path             = require('path');

var FRAMEWORK   = path.resolve(require('../fw'));
var MAIN_SRC    = path.join(FRAMEWORK, 'lib/logger/src/main.js');
var DEFAULT_SRC = path.join(FRAMEWORK, 'lib/logger/src/containers/default/index.js');

// ── behavioral harness ──────────────────────────────────────────────────────
// real opt.levels always carries every syslog level; the container's init ping
// reads opt.levels['debug'].code unconditionally, so the mock must include debug.
var LEVELS = { warn: { code: 4, color: 'yellow' }, debug: { code: 7, color: 'grey' } };
// hierarchy excludes debug(7) so the container's init "loaded" ping stays silent
var HIER   = { warn: [0, 1, 2, 3, 4] };

function baseOpt(fmt) {
    return { name: 'gina', format: fmt, flows: ['default'], hierarchy: 'warn',
             hierarchies: HIER, levels: LEVELS, template: '[%d] [%s][%a] %m' };
}

// Drive one payload through a freshly-required DefaultContainer; return stdout lines.
function renderLines(opt, payload, env) {
    var saved = {};
    Object.keys(env || {}).forEach(function (k) {
        saved[k] = process.env[k];
        if (env[k] === null) { delete process.env[k]; } else { process.env[k] = env[k]; }
    });
    process.removeAllListeners('logger#default');
    delete require.cache[require.resolve(DEFAULT_SRC)];
    var DefaultContainer = require(DEFAULT_SRC);

    var captured = [];
    var orig = process.stdout.write;
    process.stdout.write = function (s) { captured.push(String(s)); return true; };
    try {
        DefaultContainer(opt, { gina: { colors: {} } });
        process.emit('logger#default', JSON.stringify(payload));
    } finally {
        process.stdout.write = orig;
        process.removeAllListeners('logger#default');
        Object.keys(saved).forEach(function (k) {
            if (typeof saved[k] === 'undefined') { delete process.env[k]; }
            else { process.env[k] = saved[k]; }
        });
    }
    return captured.join('').split('\n').filter(Boolean);
}

function findLine(lines, needle) {
    return lines.find(function (l) { return l.indexOf(needle) > -1; }) || null;
}


// ─── 01  main.js — opt.format resolution (source) ───────────────────────────
describe('01 - main.js resolves opt.format', function () {
    var src = fs.readFileSync(MAIN_SRC, 'utf8');

    it('reads GINA_LOG_FORMAT and sets opt.format json/text', function () {
        assert.match(src, /GINA_LOG_FORMAT/, 'GINA_LOG_FORMAT not referenced in main.js');
        assert.match(src, /opt\.format\s*=\s*'json'/, "opt.format = 'json' branch missing");
        assert.match(src, /opt\.format\s*=\s*'text'/, "opt.format = 'text' default missing");
    });

    it('keeps GINA_LOG_STDOUT as a back-compat reference', function () {
        // behaviour (alias maps to json) is proven in section 03; this just locks the reference
        assert.match(src, /GINA_LOG_STDOUT/, 'GINA_LOG_STDOUT reference lost from main.js');
    });
});


// ─── 02  default container — render branch (source) ─────────────────────────
describe('02 - default container render branch', function () {
    var src = fs.readFileSync(DEFAULT_SRC, 'utf8');

    it('reads opt.format and keeps the GINA_LOG_STDOUT fallback', function () {
        assert.match(src, /opt\.format/, 'container does not read opt.format');
        assert.match(src, /GINA_LOG_STDOUT/, 'container lost the GINA_LOG_STDOUT fallback');
    });

    it('JSON branch carries canonical bundle/message AND back-compat group/msg', function () {
        assert.match(src, /bundle\s*:/, 'bundle key missing from JSON output');
        assert.match(src, /message\s*:/, 'message key missing from JSON output');
        assert.match(src, /group\s*:/, 'group back-compat key dropped');
        assert.match(src, /msg\s*:/, 'msg back-compat key dropped');
    });

    it('text branch still delegates to format()', function () {
        assert.match(src, /format\(\s*payloadObj\.group/, 'text path no longer calls format()');
    });
});


// ─── 03  JSON mode output (behavioral) ──────────────────────────────────────
describe('03 - JSON mode output', function () {

    it('opt.format=json emits a parseable object with canonical + back-compat keys', function () {
        var lines = renderLines(baseOpt('json'),
            { group: 'public@app', level: 'warn', content: 'TCP Connection closed', skipFormating: false },
            { GINA_LOG_FORMAT: null, GINA_LOG_STDOUT: null });
        var line = findLine(lines, 'TCP Connection closed');
        assert.ok(line, 'no JSON line captured');
        var o = JSON.parse(line);
        assert.equal(o.level, 'warn');
        assert.equal(o.bundle, 'public@app');                 // canonical
        assert.equal(o.message, 'TCP Connection closed');     // canonical
        assert.equal(o.group, 'public@app');                  // back-compat alias
        assert.equal(o.msg, 'TCP Connection closed');         // back-compat alias
        assert.ok(!isNaN(Date.parse(o.ts)), 'ts is not a valid ISO date');
    });

    it('GINA_LOG_STDOUT=true with no opt.format still yields JSON (back-compat alias)', function () {
        var lines = renderLines(
            { name: 'gina', flows: ['default'], hierarchy: 'warn', hierarchies: HIER, levels: LEVELS },
            { group: 'g@p', level: 'warn', content: 'BACKCOMPAT', skipFormating: false },
            { GINA_LOG_STDOUT: 'true', GINA_LOG_FORMAT: null });
        var line = findLine(lines, 'BACKCOMPAT');
        assert.ok(line, 'no JSON line captured under GINA_LOG_STDOUT');
        assert.equal(JSON.parse(line).message, 'BACKCOMPAT');
    });
});


// ─── 04  text mode is the default (behavioral) ──────────────────────────────
describe('04 - text mode is the default', function () {

    it('opt.format=text passes through format() and does not emit JSON', function () {
        var lines = renderLines(baseOpt('text'),
            { group: 'public@app', level: 'warn', content: 'PLAIN TEXT LINE', skipFormating: true },
            { GINA_LOG_FORMAT: null, GINA_LOG_STDOUT: null });
        var line = findLine(lines, 'PLAIN TEXT LINE');
        assert.ok(line, 'no text line captured');
        assert.notEqual(line.charAt(0), '{', 'text mode must not emit JSON');
    });
});


// ─── 05  console.log raw path honours JSON mode (source) ────────────────────
describe('05 - console.log raw path honours JSON mode', function () {
    var src = fs.readFileSync(MAIN_SRC, 'utf8');

    it("self.log wraps the raw stdout write in JSON when opt.format === 'json'", function () {
        // `=== 'json'` is unique to the self.log gate (the init resolution uses `= 'json'`)
        assert.match(src, /opt\.format === 'json'/, 'self.log json gate missing');
        assert.match(src, /level\s*:\s*'info'/, 'self.log json payload (level: info) missing');
        // text-mode raw passthrough must remain
        assert.match(src, /process\.stdout\.write\(content \+ '\\n'\)/,
            'text-mode raw passthrough was removed');
    });
});
