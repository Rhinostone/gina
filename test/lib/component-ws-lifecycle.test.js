/**
 * #CC3 — live-data component lifecycle against a `method:"ws"` channel handler.
 *
 * Executes the Client Components guide's "Live connections" contract over a
 * genuine HTTP/2 extended-CONNECT loopback (the lib/ws-session real-loopback
 * scaffolding): a component opens its connection in connectedCallback and
 * closes it with 1000 in disconnectedCallback, and a RE-INSERTED component
 * opens a fresh connection — so the check drives TWO full
 * connect → exchange → close cycles against ONE server, the way a popin
 * close + reopen removes and re-inserts a component.
 *
 * The channel handler under test mirrors the guide's `channels/feed.js`
 * sample shape (`module.exports = function (session, request) { … }`) — the
 * documented server-side pairing is what executes here, not an ad-hoc
 * handler. The isaac dispatcher assigns `request.params` on the CONNECT
 * request before `accept` runs; the connect listener replicates that
 * contract.
 *
 * No live gina daemon, project, or bundle is required.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var http2 = require('http2');

var FW = require('../fw');
var wsSess = require(path.join(FW, 'lib/ws-session/src/main'));
var wsf = require(path.join(FW, 'lib/ws-framing/src/main'));

describe('component-ws-lifecycle — connectedCallback opens, disconnectedCallback closes (#CC3)', function () {

    it('runs two full component cycles (insert, exchange, remove, re-insert) against one channel handler', async function () {
        var server = http2.createServer({ settings: { enableConnectProtocol: true } });
        var serverLog = { invocations: 0, messages: [], closes: [] };
        var liveSessions = [];
        server.on('session', function (h2session) { liveSessions.push(h2session); });

        // mirror the Isaac reality: a compat request listener coexists
        server.on('request', function (req, res) {
            if (req.method !== 'CONNECT') { res.end('ok'); }
        });

        // The guide's channels/feed.js shape — a plain (session, request) function.
        var feedHandler = function (session, request) {
            session.send('welcome to ' + request.params.room);
            session.onMessage(function (data) {
                serverLog.messages.push(data);
                session.send('[' + request.params.room + '] ' + data);
            });
            session.onClose(function (code, reason) {
                // release anything the connection held — observed here for the asserts
                serverLog.closes.push({ code: code, reason: reason });
            });
        };

        server.on('connect', function (request) {
            // the isaac dispatcher assigns request.params before accept — replicated
            request.params = { room: 'lobby' };
            serverLog.invocations++;
            feedHandler(wsSess.accept(request), request);
        });

        await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
        var port = server.address().port;

        /**
         * One component lifecycle: connectedCallback opens the socket (a fresh
         * extended-CONNECT stream), one user interaction sends one message,
         * disconnectedCallback closes with 1000 — then the element is gone.
         *
         * @inner
         * @param {string} message - the cycle's outbound message
         * @param {string} label - cycle name for timeout diagnostics
         * @returns {Promise} resolves with the client-side observations
         */
        function runComponentCycle(message, label) {
            var out = { messages: [], closes: [] };
            var parser = wsf.createParser({
                isServer  : false,
                onMessage : function (d) { out.messages.push(d); },
                onClose   : function (c, r) { out.closes.push({ code: c, reason: r }); },
                onError   : function (e) { out.err = e; }
            });
            return new Promise(function (resolve, reject) {
                var client = http2.connect('http://127.0.0.1:' + port);
                var guard = setTimeout(function () { reject(new Error(label + ' timed out')); }, 3000);
                client.on('error', reject);
                client.on('remoteSettings', function () {
                    var req = client.request({
                        ':method': 'CONNECT', ':protocol': 'websocket', ':scheme': 'http',
                        ':path': '/live/lobby', ':authority': '127.0.0.1:' + port
                    });
                    req.on('error', function (e) { reject(e); });
                    req.on('response', function (headers) {
                        try { assert.equal(headers[':status'], 200); } catch (e) { return reject(e); }
                        req.on('data', function (chunk) { parser.feed(chunk); });
                        req.write(wsf.encodeText(message, { mask: true }));
                        setTimeout(function () {
                            // disconnectedCallback — the teardown half of the contract
                            req.write(wsf.encodeClose(1000, 'component removed', { mask: true }));
                            req.end(); // END_STREAM after the Close frame so the stream fully closes
                        }, 120);
                    });
                    req.on('close', function () {
                        clearTimeout(guard);
                        try { client.close(); } catch (e) {}
                        resolve(out);
                    });
                });
            });
        }

        var cycle1, cycle2;
        try {
            cycle1 = await runComponentCycle('hi', 'cycle 1');
            // the popin-reopen case: the SAME markup re-inserted opens a FRESH connection
            cycle2 = await runComponentCycle('hi again', 'cycle 2');
        } finally {
            // destroy any surviving HTTP/2 session so server.close() cannot hang
            liveSessions.forEach(function (h2session) {
                try { h2session.destroy(); } catch (e) { /* already gone */ }
            });
            await new Promise(function (resolve) { server.close(resolve); });
        }

        // the handler ran once per insertion — fresh state each cycle
        assert.equal(serverLog.invocations, 2);
        assert.deepEqual(serverLog.messages, ['hi', 'hi again']);
        // the server observed the component's clean disconnect, once per cycle
        assert.deepEqual(serverLog.closes, [
            { code: 1000, reason: 'component removed' },
            { code: 1000, reason: 'component removed' }
        ]);
        // each insertion got its own greeting push + its own echo — no cross-cycle state
        assert.deepEqual(cycle1.messages, ['welcome to lobby', '[lobby] hi']);
        assert.deepEqual(cycle2.messages, ['welcome to lobby', '[lobby] hi again']);
        // §5.5.1 — the bridge echoes the STATUS CODE; the reason is not echoed
        assert.deepEqual(cycle1.closes, [{ code: 1000, reason: '' }]);
        assert.deepEqual(cycle2.closes, [{ code: 1000, reason: '' }]);
        assert.equal(cycle1.err, undefined);
        assert.equal(cycle2.err, undefined);
    });

});
