'use strict';
/**
 * profile-baseline.js — #P34: runtime CPU profiling baseline for the
 * native-acceleration arc (#P34-#P38).
 *
 * Boots a throwaway bundle in FULL ISOLATION (self-bootstrapping gina home
 * under os.tmpdir(), HOME override — the real ~/.gina is never touched),
 * builds it for the prod env (so the profile is not dominated by dev-mode
 * hot-reload work), then per arm: boots it under `node --cpu-prof` (via
 * NODE_OPTIONS, measured to reach the bundle child and to flush the profile
 * on the SIGTERM drain path), drives load, tears down, and aggregates the
 * bundle child's `.cpuprofile` by acceleration-candidate bucket via
 * analyze-cpuprofile.js.
 *
 * The three arms mirror the 2026-07-28 assessment's prescription:
 *   render — HTTP/2 HTML renders, deliberately UNCACHED (getAssets + swig +
 *            the whole-document replace passes — a warm-cache replay would
 *            bypass exactly the #P37 candidates);
 *   upload — concurrent multipart POSTs (the streamsearch boundary-scan
 *            byte loop, #P35's target);
 *   ws     — WebSocket echo over HTTP/2 extended CONNECT (the RFC 6455
 *            unmask/encode codec in lib/ws-framing, #P36's target). Runs
 *            CODEC-ISOLATED against ws-codec-server.js rather than in-bundle:
 *            every ws-handler registration shape killed the isolated boot
 *            silently (staked bug candidates; see fixture()).
 *
 * The bundle serves h2 over https with a run-local self-signed cert triple
 * (private.key / certificate.crt / ca_bundle.crt) — h2c is NOT used because
 * the port allocator carries no `http/2.0 -> http` slot (measured).
 *
 * Operator-invoked ONLY — never wired into the test suite or CI. Expected
 * runtime: 2-5 minutes for all three arms. Results land in
 * ./tmp/perf-baseline-<stamp>/ (gitignored): per-arm .cpuprofile copies,
 * report.txt, report.json.
 *
 * Usage:
 *   node script/perf/profile-baseline.js                    # all arms
 *   node script/perf/profile-baseline.js --arm=render,ws    # subset
 *   node script/perf/profile-baseline.js --keep             # keep the temp home
 * Options (defaults): --requests=3000 --concurrency=8 --upload-count=200
 *   --upload-kb=1500 --ws-sessions=8 --ws-frames=1500 --ws-payload=4096
 *   --start-port-from=9860
 */

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var net    = require('net');
var http2  = require('http2');
var crypto = require('crypto');
var { spawn, spawnSync } = require('child_process');

var analyzer = require('./analyze-cpuprofile');

// ---------------------------------------------------------------------------
// Options & constants
// ---------------------------------------------------------------------------

/**
 * @param   {string} name
 * @param   {*}      dflt
 * @returns {string|*} the `--name=value` argv value, or the default
 * @inner
 */
function opt(name, dflt) {
    var hit = process.argv.slice(2).filter(function (a) { return a.indexOf('--' + name + '=') === 0; })[0];
    return hit ? hit.split('=').slice(1).join('=') : dflt;
}

var ARMS         = String(opt('arm', 'render,upload,ws')).split(',').filter(Boolean);
var REQUESTS     = parseInt(opt('requests', 3000), 10);
var CONCURRENCY  = parseInt(opt('concurrency', 8), 10);
var UPLOAD_COUNT = parseInt(opt('upload-count', 200), 10);
var UPLOAD_KB    = parseInt(opt('upload-kb', 1500), 10);
var WS_SESSIONS  = parseInt(opt('ws-sessions', 8), 10);
var WS_FRAMES    = parseInt(opt('ws-frames', 1500), 10);
var WS_PAYLOAD   = parseInt(opt('ws-payload', 4096), 10);
var PORT_START   = parseInt(opt('start-port-from', 9860), 10);
var KEEP         = process.argv.indexOf('--keep') > -1;

var STAMP     = Date.now();
var PROJ      = 'perf' + STAMP;
var BUNDLE    = 'demo';
var GINA_ROOT = path.resolve(__dirname, '..', '..');
var FW        = require(path.join(GINA_ROOT, 'test', 'fw'));
var CLI       = path.join(GINA_ROOT, 'bin', 'cli');
var CONTAINER = path.join(GINA_ROOT, 'bin', 'gina-container');

// GINA_PERF_HOME_BASE overrides where the throwaway home lives (kept real-path:
// a symlink-prefixed base records alias paths into every state file).
var HOME_BASE = process.env.GINA_PERF_HOME_BASE
    ? fs.realpathSync(process.env.GINA_PERF_HOME_BASE)
    : fs.realpathSync(os.tmpdir());
var FAKE_HOME = path.join(HOME_BASE, 'gina-perf-' + STAMP);
// Neutral cwd for CLI + boot children: NOT the repo (the CLI auto-link drops a
// stray `gina` symlink at a repo cwd) and NOT the fake home (scaffolding with
// the cwd AT a dir containing .gina/ produced silently-dead prod scenes during
// bring-up; a sibling dir sidesteps both).
var CWD_DIR   = FAKE_HOME + '-cwd';
var GINA_HOME = path.join(FAKE_HOME, '.gina');
var PROJ_DIR  = path.join(FAKE_HOME, 'proj');
var SRC       = path.join(PROJ_DIR, 'src', BUNDLE);
var OUT       = path.join(GINA_ROOT, 'tmp', 'perf-baseline-' + STAMP);

// CLI + boot env: isolate via HOME (both bin/cli and bin/gina-container derive
// ~/.gina from it), silence the MQ transport, and never inherit the operator's
// GINA_HOMEDIR or NODE_OPTIONS (the CLI must not be profiled).
var CHILD_ENV = Object.assign({}, process.env, {
    HOME            : FAKE_HOME,
    GINA_LOG_STDOUT : 'true'
});
delete CHILD_ENV.GINA_HOMEDIR;
delete CHILD_ENV.NODE_OPTIONS;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
function log(msg) { process.stdout.write('[perf-baseline] ' + msg + '\n'); }

/**
 * Runs an offline gina CLI command against the isolated home. Exit status is
 * NOT trusted (the first-run home bootstrap exits non-zero on a benign MQ
 * teardown) — callers verify via on-disk state instead. cwd is the fake home
 * so the CLI's auto-link step can never drop a stray `gina` symlink in the
 * repo (it is still checked at teardown).
 *
 * @param   {string[]} args
 * @returns {{status: (number|null), stdout: string, stderr: string}}
 */
function runCli(args) {
    var r = spawnSync(process.execPath, [CLI].concat(args), {
        env: CHILD_ENV, cwd: CWD_DIR, encoding: 'utf8', timeout: 120000
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** @param {string} file @returns {object} */
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * Parses a gina config JSON (tolerates full-line `//` comments).
 * @param   {string} file
 * @returns {object}
 */
function parseConfigJSON(file) {
    var stripped = fs.readFileSync(file, 'utf8').split('\n')
        .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    return JSON.parse(stripped);
}

/** @param {number} ms @returns {Promise} */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * @param   {number} port
 * @param   {number} timeoutMs
 * @returns {Promise<boolean>} true once something listens on 127.0.0.1:port
 */
function waitForPort(port, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve) {
        (function poll() {
            var sock = new net.Socket();
            sock.setTimeout(800);
            sock.on('connect', function () { sock.destroy(); resolve(true); });
            sock.on('error',   function () { retry(); });
            sock.on('timeout', function () { sock.destroy(); retry(); });
            function retry() {
                if (Date.now() >= deadline) { return resolve(false); }
                setTimeout(poll, 300);
            }
            sock.connect(port, '127.0.0.1');
        })();
    });
}

// ---------------------------------------------------------------------------
// Phase 1 — scaffold + fixture + build
// ---------------------------------------------------------------------------

/**
 * Scaffolds project + bundle + view into the isolated home, verified through
 * the state files (never exit codes).
 * @returns {void} throws on failure
 */
function scaffold() {
    fs.mkdirSync(PROJ_DIR, { recursive: true });
    fs.mkdirSync(CWD_DIR, { recursive: true });
    runCli(['project:add', '@' + PROJ, '--path=' + PROJ_DIR]);
    if (!fs.existsSync(path.join(GINA_HOME, 'projects.json')) ||
        !readJSON(path.join(GINA_HOME, 'projects.json'))[PROJ]) {
        throw new Error('project:add did not register @' + PROJ);
    }
    // The CLI's auto-link of <proj>/node_modules/gina is unreliable under an
    // isolated home; without it the release's require('gina') dies
    // MODULE_NOT_FOUND before the bundle child logs a byte. Link explicitly.
    var nmDir = path.join(PROJ_DIR, 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });
    if (!fs.existsSync(path.join(nmDir, 'gina'))) {
        fs.symlinkSync(GINA_ROOT, path.join(nmDir, 'gina'));
    }
    runCli(['bundle:add', BUNDLE, '@' + PROJ, '--start-port-from=' + PORT_START]);
    var key = BUNDLE + '@' + PROJ;
    if (!readJSON(path.join(GINA_HOME, 'ports.reverse.json'))[key]) {
        throw new Error('bundle:add did not register ' + key);
    }
    runCli(['view:add', BUNDLE, '@' + PROJ]);
    if (!fs.existsSync(path.join(SRC, 'templates', 'html', 'content', 'homepage.html'))) {
        throw new Error('view:add did not scaffold the homepage template');
    }
    log('scaffolded ' + key + ' in ' + FAKE_HOME);
}

/**
 * Applies the arm fixtures to the bundle SRC (settings, routes, controller,
 * ws handler, prod render-cache) and drops a self-signed cert triple for the
 * h2-over-https boot. All served content is rebuilt from src by build().
 * @returns {void}
 */
function fixture() {
    // h2 + extended CONNECT + memory render-cache type
    var settingsPath = path.join(SRC, 'config', 'settings.json');
    var settings = parseConfigJSON(settingsPath);
    settings.server = Object.assign({}, settings.server, {
        protocol     : 'http/2.0',
        scheme       : 'https',
        http2Options : Object.assign({}, (settings.server || {}).http2Options, { enableConnectProtocol: true })
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));

    // routes: uncached render, route-cached render, upload sink.
    // `file: homepage` is explicit because a rule with no `file` defaults to
    // the RULE name and only the default rule's template is scaffolded.
    fs.writeFileSync(path.join(SRC, 'config', 'routing.json'), JSON.stringify({
        '$schema'  : 'https://gina.io/schema/routing.json',
        'homepage' : { namespace: 'content', url: '/', method: 'GET', param: { control: 'home' } },
        'perf-render' : {
            namespace: 'content', url: '/render', method: 'GET',
            param: { control: 'perfRender', file: 'homepage' }
        },
        'perf-upload' : { namespace: 'content', url: '/upload', method: 'POST', param: { control: 'perfUpload' } }
    }, null, 2));

    // content controller: HTML render + upload echo (mirrors the scaffold's shape)
    fs.writeFileSync(path.join(SRC, 'controllers', 'controller.content.js'), [
        'function DemoContentController() {',
        '    var self = this;',
        '    var appConf = this.getConfig(\'app\');',
        '',
        '    this.home = function(req, res) {',
        '        self.renderJSON({ msg: appConf.greeting });',
        '    };',
        '',
        '    this.perfRender = function(req, res) {',
        '        var items = [];',
        '        for (var i = 0; i < 50; i++) { items.push({ n: i, label: \'item-\' + i }); }',
        '        self.render({ msg: appConf.greeting, items: items });',
        '    };',
        '',
        '    this.perfUpload = function(req, res) {',
        '        var files = req.files || [];',
        '        var total = 0;',
        '        for (var i = 0; i < files.length; i++) { total += files[i].size || 0; }',
        '        self.renderJSON({ count: files.length, bytes: total });',
        '    };',
        '}',
        'module.exports = DemoContentController',
        ''
    ].join('\n'));

    // NOTE — the scaffold's index.js is deliberately left UNTOUCHED: every
    // WebSocket-handler registration shape (onInitialize/onWebSocket AND the
    // declarative `method: "ws"` route) — and even a pure onInitialize
    // passthrough — made the isolated boot exit 0 silently during bring-up
    // (staked as bug candidates). The ws arm profiles the codec standalone
    // via ws-codec-server.js instead.

    // NOTE — deliberately NO render-cache config and NO env.json: a warm-cache
    // replay BYPASSES the #P37 candidates (getAssets + the replace passes), so
    // profiling the uncached render is what can convict them; and a project
    // env.json carrying only a partial server block broke the prod boot in
    // three measured ways during harness bring-up (host clobber -> unresolved
    // ${host} cert path; unguarded [bundle][env] read on an empty file; the
    // crash persisting after the file's deletion) — staked as bug candidates.

    // self-signed cert triple (isaac eagerly reads all three for https)
    var certDir = path.join(GINA_HOME, 'certificates', 'scopes', 'local', 'localhost');
    fs.mkdirSync(certDir, { recursive: true });
    var ssl = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', path.join(certDir, 'private.key'),
        '-out', path.join(certDir, 'certificate.crt'),
        '-days', '2', '-subj', '/CN=localhost'
    ], { encoding: 'utf8' });
    if (ssl.status !== 0 || !fs.existsSync(path.join(certDir, 'private.key'))) {
        throw new Error('openssl self-signed cert generation failed: ' + (ssl.stderr || ssl.status));
    }
    fs.copyFileSync(path.join(certDir, 'certificate.crt'), path.join(certDir, 'ca_bundle.crt'));
    log('fixture applied (h2/https + render/upload routes)');
}

/**
 * Builds the prod release (fixture config is BAKED into the release tree, so
 * this must run after every fixture change).
 * @returns {void} throws when no prod entry point was produced
 */
function build() {
    runCli(['bundle:build', BUNDLE, '@' + PROJ, '--env=prod', '--scope=local']);
    var relRoot = path.join(PROJ_DIR, 'releases', BUNDLE, 'local', 'prod');
    var built = fs.existsSync(relRoot) && fs.readdirSync(relRoot).some(function (v) {
        return fs.existsSync(path.join(relRoot, v, 'index.js'));
    });
    if (!built) { throw new Error('bundle:build produced no prod release under ' + relRoot); }
    log('prod release built');
}

/**
 * @returns {number} the prod h2/https port from ports.reverse.json
 */
function resolvePort() {
    var key = BUNDLE + '@' + PROJ;
    var port = null;
    try { port = readJSON(path.join(GINA_HOME, 'ports.reverse.json'))[key].prod['http/2.0'].https; } catch (e) { /* fall through */ }
    if (!port) { throw new Error('could not resolve the prod http/2.0 https port for ' + key); }
    return port;
}

// ---------------------------------------------------------------------------
// Phase 2 — per-arm boot / drive / profile collection
// ---------------------------------------------------------------------------

/**
 * Boots the bundle under --cpu-prof for one arm.
 *
 * @param   {string} arm
 * @param   {number} port
 * @returns {Promise<{proc: object, profDir: string, logRef: {txt: string}, exit: object}>}
 */
async function bootArm(arm, port) {
    var profDir = path.join(OUT, 'profiles', arm);
    fs.mkdirSync(profDir, { recursive: true });
    var env = Object.assign({}, CHILD_ENV, {
        NODE_ENV     : 'prod',
        NODE_OPTIONS : '--cpu-prof --cpu-prof-dir=' + profDir
    });
    var handle = { profDir: profDir, logRef: { txt: '' }, exit: { code: null, signal: null, done: false } };
    handle.proc = spawn(process.execPath, [CONTAINER, BUNDLE, '@' + PROJ], {
        env: env, cwd: CWD_DIR, stdio: ['ignore', 'pipe', 'pipe']
    });
    handle.proc.stdout.on('data', function (d) { handle.logRef.txt += d; });
    handle.proc.stderr.on('data', function (d) { handle.logRef.txt += d; });
    handle.proc.on('exit', function (code, signal) {
        handle.exit = { code: code, signal: signal, done: true };
    });
    var opened = await waitForPort(port, 25000);
    if (!opened) {
        var exitNote = handle.exit.done
            ? 'launcher EXITED (code ' + handle.exit.code + ', signal ' + handle.exit.signal + ') before binding'
            : 'launcher still running at deadline — a stalled boot';
        throw new Error('[' + arm + '] port ' + port + ' never opened. ' + exitNote + '\n--- boot log:\n' + handle.logRef.txt.slice(-3000));
    }
    return handle;
}

/**
 * SIGTERM-drains the arm's boot and returns the BUNDLE child's .cpuprofile
 * (matched by the mounted pid from the boot log; largest-file fallback). The
 * profile is flushed by V8 on the drain-exit path — asserted non-empty here.
 *
 * @param   {string} arm
 * @param   {object} handle - bootArm() result
 * @returns {Promise<string>} profile path
 */
async function stopArm(arm, handle) {
    try { handle.proc.kill('SIGTERM'); } catch (e) { /* already gone */ }
    var until = Date.now() + 10000;
    while (Date.now() < until && !handle.exit.done) { await sleep(150); }
    if (!handle.exit.done) {
        try { handle.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
        await sleep(400);
    }
    await sleep(600);   // let V8 finish writing the profiles

    var files = fs.readdirSync(handle.profDir).filter(function (f) { return /\.cpuprofile$/.test(f); });
    if (!files.length) { throw new Error('[' + arm + '] no .cpuprofile written — SIGKILL used, or the profiler never attached'); }

    var m = handle.logRef.txt.match(/\[ FRAMEWORK \]\[ (\d+) \]/);
    var bundlePid = m ? m[1] : null;
    var pick = null;
    if (bundlePid) {
        pick = files.filter(function (f) { return f.indexOf('.' + bundlePid + '.') > -1; })[0] || null;
    }
    if (!pick) {   // fallback: the bundle profile is the largest one
        pick = files.sort(function (a, b) {
            return fs.statSync(path.join(handle.profDir, b)).size - fs.statSync(path.join(handle.profDir, a)).size;
        })[0];
    }
    var full = path.join(handle.profDir, pick);
    if (fs.statSync(full).size < 1000) { throw new Error('[' + arm + '] bundle profile is empty: ' + full); }
    log('[' + arm + '] bundle profile: ' + pick + ' (' + fs.statSync(full).size + ' bytes, pid-matched: ' + (bundlePid ? 'yes' : 'no') + ')');
    return full;
}

/**
 * @param   {number} port
 * @returns {object} an h2 client session to the bundle (self-signed tolerated)
 * @inner
 */
function h2Session(port) {
    return http2.connect('https://127.0.0.1:' + port, { rejectUnauthorized: false });
}

/**
 * Sequentially GETs `reqPath` n times on one session, discarding bodies.
 *
 * @param   {object} client
 * @param   {string} reqPath
 * @param   {number} n
 * @param   {object} stats - {codes: object} accumulator
 * @returns {Promise<void>}
 * @inner
 */
function seqGet(client, reqPath, n, stats) {
    return new Promise(function (resolve, reject) {
        (function one(left) {
            if (left <= 0) { return resolve(); }
            var req = client.request({ ':path': reqPath });
            req.on('response', function (h) {
                var s = h[':status'];
                stats.codes[s] = (stats.codes[s] || 0) + 1;
            });
            req.on('data', function () { /* discard */ });
            req.on('end', function () { one(left - 1); });
            req.on('error', reject);
        })(n);
    });
}

/**
 * Render arm: N uncached renders then N route-cached renders, C sessions.
 *
 * @param   {number} port
 * @returns {Promise<object>} driver stats
 */
async function driveRender(port) {
    var webroot = '/' + BUNDLE;
    var stats = { arm: 'render', codes: {}, requests: REQUESTS, startMs: Date.now() };
    var clients = [];
    for (var c = 0; c < CONCURRENCY; c++) { clients.push(h2Session(port)); }
    var per = Math.ceil(REQUESTS / CONCURRENCY);
    try {
        await Promise.all(clients.map(function (cl) { return seqGet(cl, webroot + '/render', per, stats); }));
    } finally {
        clients.forEach(function (cl) { try { cl.close(); } catch (e) { /* ignore */ } });
    }
    stats.wallMs = Date.now() - stats.startMs;
    return stats;
}

/**
 * Upload arm: concurrent multipart POSTs of a random binary payload.
 *
 * @param   {number} port
 * @returns {Promise<object>} driver stats
 */
async function driveUpload(port) {
    var boundary = '----ginaPerf' + STAMP;
    var head = Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="blob.bin"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n');
    var tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    var body = Buffer.concat([head, crypto.randomBytes(UPLOAD_KB * 1024), tail]);

    var stats = { arm: 'upload', codes: {}, requests: UPLOAD_COUNT, bodyBytes: body.length, startMs: Date.now() };
    var conc = Math.min(CONCURRENCY, 4);
    var clients = [];
    for (var c = 0; c < conc; c++) { clients.push(h2Session(port)); }

    function postOne(client) {
        return new Promise(function (resolve, reject) {
            var req = client.request({
                ':method'        : 'POST',
                ':path'          : '/' + BUNDLE + '/upload',
                'content-type'   : 'multipart/form-data; boundary=' + boundary,
                'content-length' : body.length
            });
            req.on('response', function (h) {
                var s = h[':status'];
                stats.codes[s] = (stats.codes[s] || 0) + 1;
            });
            req.on('data', function () { /* discard */ });
            req.on('end', resolve);
            req.on('error', reject);
            req.end(body);
        });
    }
    var per = Math.ceil(UPLOAD_COUNT / conc);
    try {
        await Promise.all(clients.map(function (cl) {
            return (function loop(left) {
                if (left <= 0) { return Promise.resolve(); }
                return postOne(cl).then(function () { return loop(left - 1); });
            })(per);
        }));
    } finally {
        clients.forEach(function (cl) { try { cl.close(); } catch (e) { /* ignore */ } });
    }
    stats.wallMs = Date.now() - stats.startMs;
    return stats;
}

/**
 * WS arm: S extended-CONNECT sessions, each ping-ponging N masked TEXT frames
 * against the echo handler (client masks per RFC 6455 §5.1, so every inbound
 * payload byte exercises the server's unmask loop; every echo exercises the
 * encode side). The client codec is the framework's own lib/ws-framing.
 *
 * @param   {number} port
 * @returns {Promise<object>} driver stats
 */
async function driveWs(port) {
    var wsf = require(path.join(FW, 'lib', 'ws-framing', 'src', 'main.js'));
    var payload = 'x'.repeat(WS_PAYLOAD);
    var stats = { arm: 'ws', sessions: WS_SESSIONS, framesPerSession: WS_FRAMES, payloadBytes: WS_PAYLOAD, echoes: 0, startMs: Date.now() };

    function oneSession() {
        return new Promise(function (resolve, reject) {
            var client = http2.connect('http://127.0.0.1:' + port);
            var guard = setTimeout(function () {
                try { client.close(); } catch (e) { /* ignore */ }
                reject(new Error('ws session timed out (' + stats.echoes + ' echoes so far)'));
            }, 120000);
            client.on('error', reject);
            client.on('remoteSettings', function () {
                var req = client.request({
                    ':method': 'CONNECT', ':protocol': 'websocket', ':scheme': 'http',
                    ':path': '/live', ':authority': '127.0.0.1:' + port
                });
                var sent = 0;
                var parser = wsf.createParser({
                    isServer  : false,
                    onMessage : function () {
                        stats.echoes++;
                        if (sent < WS_FRAMES) { pump(); }
                        else {
                            // Close: code 1000 + reason, masked like every client frame
                            req.write(wsf.encodeFrame({
                                opcode  : wsf.OPCODES.CLOSE,
                                payload : Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('done')]),
                                mask    : true
                            }));
                            req.end();
                        }
                    },
                    onClose   : function () { /* server echoes the close */ },
                    onError   : function (e) { reject(e); }
                });
                function pump() {
                    sent++;
                    req.write(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: payload, mask: true }));
                }
                req.on('error', reject);
                req.on('response', function (h) {
                    if (h[':status'] !== 200) { return reject(new Error('ws handshake refused: ' + h[':status'])); }
                    req.on('data', function (chunk) { parser.feed(chunk); });
                    pump();
                });
                req.on('close', function () {
                    clearTimeout(guard);
                    try { client.close(); } catch (e) { /* ignore */ }
                    resolve();
                });
            });
        });
    }

    var sessions = [];
    for (var s = 0; s < WS_SESSIONS; s++) { sessions.push(oneSession()); }
    await Promise.all(sessions);
    stats.wallMs = Date.now() - stats.startMs;
    return stats;
}

/**
 * The whole ws arm: spawns ws-codec-server.js under `node --cpu-prof` (direct
 * argv — no bundle boot involved; see the fixture() note), drives the echo
 * load, SIGTERM-collects the server's profile.
 *
 * @returns {Promise<{stats: object, profile: string}>}
 */
async function runWsArm() {
    var profDir = path.join(OUT, 'profiles', 'ws');
    fs.mkdirSync(profDir, { recursive: true });
    var srv = spawn(process.execPath,
        ['--cpu-prof', '--cpu-prof-dir=' + profDir, path.join(__dirname, 'ws-codec-server.js')],
        { env: CHILD_ENV, cwd: CWD_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    var out = { txt: '' };
    var exited = { done: false };
    srv.stdout.on('data', function (d) { out.txt += d; });
    srv.stderr.on('data', function (d) { out.txt += d; });
    srv.on('exit', function () { exited.done = true; });

    var deadline = Date.now() + 10000;
    var port = null;
    while (Date.now() < deadline && !port) {
        var m = out.txt.match(/PORT (\d+)/);
        if (m) { port = parseInt(m[1], 10); break; }
        if (exited.done) { break; }
        await sleep(150);
    }
    if (!port) {
        try { srv.kill('SIGKILL'); } catch (e) { /* ignore */ }
        throw new Error('[ws] codec server never reported a port.\n' + out.txt.slice(-1500));
    }

    var stats;
    try {
        stats = await driveWs(port);
    } finally {
        try { srv.kill('SIGTERM'); } catch (e) { /* ignore */ }
    }
    var until = Date.now() + 6000;
    while (Date.now() < until && !exited.done) { await sleep(150); }
    await sleep(600);   // profile flush

    var files = fs.readdirSync(profDir).filter(function (f) { return /\.cpuprofile$/.test(f); });
    if (!files.length) { throw new Error('[ws] no .cpuprofile written by the codec server'); }
    var pick = files.sort(function (a, b) {
        return fs.statSync(path.join(profDir, b)).size - fs.statSync(path.join(profDir, a)).size;
    })[0];
    var full = path.join(profDir, pick);
    log('[ws] codec-server profile: ' + pick + ' (' + fs.statSync(full).size + ' bytes)');
    return { stats: stats, profile: full };
}

/**
 * Fires a few webroot GETs so the JIT is warm before the measured load.
 * @param   {number} port
 * @returns {Promise<void>}
 */
async function warmup(port) {
    var client = h2Session(port);
    var stats = { codes: {} };
    try { await seqGet(client, '/' + BUNDLE + '/', 25, stats); }
    finally { try { client.close(); } catch (e) { /* ignore */ } }
    if (!stats.codes[200]) { throw new Error('warmup never saw a 200: ' + JSON.stringify(stats.codes)); }
}

// ---------------------------------------------------------------------------
// Phase 3 — teardown & safety checks
// ---------------------------------------------------------------------------

/**
 * Best-effort teardown: remove the throwaway project + home, hunt surviving
 * processes of THIS run by project name (never other gina processes), verify
 * the real ~/.gina was untouched, and check for the stray repo-root `gina`
 * self-symlink the CLI auto-link step can drop.
 * @returns {string[]} human-readable warnings (empty = clean)
 */
function teardown() {
    var warnings = [];
    if (!KEEP) {   // --keep preserves the WHOLE scene (incl. the registration) for forensics
        try { runCli(['project:rm', '@' + PROJ, '--force']); } catch (e) { /* best effort */ }
        try { fs.rmSync(FAKE_HOME, { recursive: true, force: true }); } catch (e) { warnings.push('could not remove ' + FAKE_HOME + ': ' + e.message); }
        try { fs.rmSync(CWD_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    } else {
        warnings.push('--keep: left ' + FAKE_HOME + ' and the @' + PROJ + ' registration in place');
    }

    // survivors of THIS run only (bundle title is 'gina: demo@perf<stamp>')
    try {
        var ps = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf8' }).stdout || '';
        ps.split('\n').forEach(function (line) {
            if (line.indexOf('@' + PROJ) === -1) { return; }
            var pid = parseInt(line.trim().split(/\s+/)[0], 10);
            if (pid && pid !== process.pid) {
                try { process.kill(pid, 'SIGTERM'); warnings.push('killed surviving process ' + pid + ' (' + line.trim().slice(0, 90) + ')'); } catch (e) { /* gone */ }
            }
        });
        if (/gina: inspector@gina/.test(ps)) {
            warnings.push('an inspector@gina process is running — NOT killed (may belong to another session); ps-hunt it manually if it is this run\'s leak');
        }
    } catch (e) { /* ps unavailable — skip */ }

    // the real home must be untouched
    try {
        var realProjects = path.join(os.homedir(), '.gina', 'projects.json');
        if (fs.existsSync(realProjects) && readJSON(realProjects)[PROJ]) {
            warnings.push('LEAK: @' + PROJ + ' registered in the REAL ~/.gina/projects.json — remove it');
        }
    } catch (e) { /* unreadable — ignore */ }
    try {
        var realDot = path.join(os.homedir(), '.' + PROJ);
        if (fs.existsSync(realDot)) {
            if (!fs.readdirSync(realDot).length) { fs.rmdirSync(realDot); }
            else { warnings.push('LEAK: non-empty ' + realDot + ' on the real home'); }
        }
    } catch (e) { /* ignore */ }

    // stray self-symlink at the repo root
    try {
        var stray = path.join(GINA_ROOT, 'gina');
        if (fs.existsSync(stray) && fs.lstatSync(stray).isSymbolicLink()) {
            fs.unlinkSync(stray);
            warnings.push('removed a stray `gina` self-symlink at the repo root');
        }
    } catch (e) { /* ignore */ }
    return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

var DRIVERS = { render: driveRender, upload: driveUpload, ws: driveWs };

async function main() {
    var bad = ARMS.filter(function (a) { return !DRIVERS[a]; });
    if (bad.length) {
        process.stderr.write('unknown arm(s): ' + bad.join(',') + ' — valid: render,upload,ws\n');
        process.exit(2);
    }
    fs.mkdirSync(OUT, { recursive: true });
    log('output dir: ' + OUT);

    var report = { stamp: STAMP, node: process.version, arms: {} };
    var failures = 0;

    try {
        scaffold();
        fixture();
        build();
        var port = resolvePort();
        log('prod h2 port: ' + port);

        for (var i = 0; i < ARMS.length; i++) {
            var arm = ARMS[i];
            log('── arm: ' + arm);
            var handle = null;
            try {
                var stats, profile;
                if (arm === 'ws') {
                    var wsRun = await runWsArm();   // standalone codec server, no bundle boot
                    stats = wsRun.stats;
                    profile = wsRun.profile;
                } else {
                    handle = await bootArm(arm, port);
                    await warmup(port);
                    stats = await DRIVERS[arm](port);
                    profile = await stopArm(arm, handle);
                    handle = null;
                }
                var analysis = analyzer.analyze(JSON.parse(fs.readFileSync(profile, 'utf8')));
                var label = (arm === 'ws') ? 'ws (codec-isolated standalone server)' : arm + ' (bundle child)';
                report.arms[arm] = {
                    driver  : stats,
                    mode    : (arm === 'ws') ? 'codec-isolated standalone' : 'bundle child (prod, h2/https)',
                    profile : path.relative(GINA_ROOT, profile),
                    totalUs : analysis.totalUs,
                    buckets : analysis.buckets,
                    top     : analysis.frames.slice(0, 20)
                };
                log(analyzer.format(label, analysis));
                log('[' + arm + '] driver: ' + JSON.stringify(stats));
            } catch (e) {
                failures++;
                report.arms[arm] = { error: String(e && e.message || e) };
                log('[' + arm + '] FAILED: ' + (e && e.message || e));
                if (handle && handle.proc) {
                    try { handle.proc.kill('SIGKILL'); } catch (k) { /* ignore */ }
                }
            }
        }
    } catch (e) {
        failures++;
        log('SETUP FAILED: ' + (e && e.stack || e));
    } finally {
        var warnings = teardown();
        report.teardownWarnings = warnings;
        warnings.forEach(function (w) { log('teardown: ' + w); });
    }

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    var lines = ['# perf-baseline ' + STAMP + ' — node ' + process.version, ''];
    Object.keys(report.arms).forEach(function (arm) {
        var a = report.arms[arm];
        if (a.error) { lines.push('## ' + arm + ': FAILED — ' + a.error, ''); return; }
        lines.push('## ' + arm, 'driver: ' + JSON.stringify(a.driver), '');
        lines.push(analyzer.format(arm, { totalUs: a.totalUs, buckets: a.buckets, frames: a.top }), '');
    });
    fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n'));
    log('report: ' + path.join(OUT, 'report.txt'));
    process.exit(failures ? 1 : 0);
}

main();
