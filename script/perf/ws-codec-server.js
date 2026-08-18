'use strict';
/**
 * ws-codec-server.js — standalone HTTP/2 extended-CONNECT echo server for the
 * #P34 ws arm, driving the framework's OWN RFC 6455 codec (lib/ws-framing)
 * and session wrapper (lib/ws-session) — the #P36 candidate bytes — outside a
 * bundle boot. Isolation is what this instrument is FOR (codec self-time with
 * nothing else in the process); the bring-up's claim that an in-bundle arm
 * was BLOCKED (every ws-handler registration shape silently killing the
 * isolated gina-container boot) was REFUTED on 2026-07-31 — 11/11 fresh-scene
 * arms booted alive; the deaths were the sibling env.json bug (#B181), not
 * the registration shapes. The in-bundle counterpart now exists as
 * profile-baseline.js's `ws-bundle` arm (#P36's re-arm measurement).
 * Cleartext h2 loopback keeps TLS noise out of the codec profile.
 *
 * Spawned by profile-baseline.js under `node --cpu-prof`; prints `PORT <n>`
 * on stdout when listening; SIGTERM destroys sessions, closes, exits 0 (the
 * profile flushes on that path).
 */
var http2 = require('http2');
var path  = require('path');

var FW     = require(path.join(__dirname, '..', '..', 'test', 'fw'));
var wsSess = require(path.join(FW, 'lib', 'ws-session', 'src', 'main'));

var liveSessions = [];
var server = http2.createServer({ settings: { enableConnectProtocol: true } });

server.on('session', function (h2s) { liveSessions.push(h2s); });
server.on('request', function (req, res) {
    if (req.method !== 'CONNECT') { res.end('ok'); }
});
server.on('connect', function (request, response) {
    var session = wsSess.accept(request);
    session.onMessage(function (data, isBinary) {
        session.send('echo: ' + data);
    });
});

server.listen(0, '127.0.0.1', function () {
    process.stdout.write('PORT ' + server.address().port + '\n');
});

process.on('SIGTERM', function () {
    liveSessions.forEach(function (s) { try { s.destroy(); } catch (e) { /* gone */ } });
    server.close(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 1500).unref();
});
