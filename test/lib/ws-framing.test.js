/**
 * lib/ws-framing — RFC 6455 framing codec behavioural suite (#H13).
 *
 * Require-by-path, mirroring cmd-status-format.test.js / template-loaders.test.js:
 * the module is pure (node builtins only), so it loads with a direct require.
 *
 * Section 10 is a differential oracle against the `ws` package already
 * declared as a framework dependency: frames built by ws's Sender must parse
 * identically in our parser, and frames built by our encoder must be accepted
 * by ws's Receiver. ws is resolved from the framework node_modules (fallback:
 * repo root); the section self-skips if neither install is present.
 */

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');
var crypto = require('crypto');

var FW = require('../fw');
var wsf = require(path.join(FW, 'lib/ws-framing/src/main'));

// Collects every parser callback into inspectable arrays.
function collect(options) {
    var events = { messages: [], pings: [], pongs: [], closes: [], errors: [] };
    var base = {
        onMessage : function(data, isBinary) { events.messages.push({ data: data, isBinary: isBinary }); },
        onPing    : function(payload) { events.pings.push(payload); },
        onPong    : function(payload) { events.pongs.push(payload); },
        onClose   : function(code, reason) { events.closes.push({ code: code, reason: reason }); },
        onError   : function(err) { events.errors.push(err); }
    };
    var opts = Object.assign(base, options || {});
    return { parser: wsf.createParser(opts), events: events };
}

var KEY = Buffer.from([0x01, 0x02, 0x03, 0x04]);

function maskedText(text) {
    return wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: text, mask: true, maskKey: KEY });
}


// 01 — frame encoder: vectors, length-form boundaries, encode-side throws
describe('01 - encodeFrame: vectors, boundaries, encode-side constraints', function() {

    it('encodes the canonical unmasked text vector (FIN + TEXT + 7-bit length)', function() {
        assert.deepEqual(wsf.encodeText('abc'), Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63]));
    });

    it('uses the 7-bit form up to 125 and the 16-bit form from 126', function() {
        var f125 = wsf.encodeBinary(Buffer.alloc(125, 0x41));
        assert.equal(f125[1], 125);
        assert.equal(f125.length, 2 + 125);

        var f126 = wsf.encodeBinary(Buffer.alloc(126, 0x41));
        assert.equal(f126[1], 126);
        assert.equal(f126.readUInt16BE(2), 126);
        assert.equal(f126.length, 4 + 126);
    });

    it('uses the 16-bit form up to 65535 and the 64-bit form from 65536', function() {
        var f65535 = wsf.encodeBinary(Buffer.alloc(65535, 0x41));
        assert.equal(f65535[1], 126);
        assert.equal(f65535.readUInt16BE(2), 65535);

        var f65536 = wsf.encodeBinary(Buffer.alloc(65536, 0x41));
        assert.equal(f65536[1], 127);
        assert.equal(f65536.readBigUInt64BE(2), 65536n);
        assert.equal(f65536.length, 10 + 65536);
    });

    it('masks deterministically with a supplied 4-byte key', function() {
        var frame = maskedText('abc');
        assert.deepEqual(
            frame,
            Buffer.from([0x81, 0x83, 0x01, 0x02, 0x03, 0x04, 0x61 ^ 0x01, 0x62 ^ 0x02, 0x63 ^ 0x03])
        );
    });

    it('throws on a control frame above 125 bytes', function() {
        assert.throws(function() { wsf.encodePing(Buffer.alloc(126)); }, RangeError);
    });

    it('throws on a fragmented control frame', function() {
        assert.throws(function() {
            wsf.encodeFrame({ opcode: wsf.OPCODES.PING, fin: false });
        }, RangeError);
    });

    it('throws on unknown / reserved opcodes and non-Buffer payloads', function() {
        assert.throws(function() { wsf.encodeFrame({ opcode: 0x3, payload: 'x' }); }, TypeError);
        assert.throws(function() { wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: 42 }); }, TypeError);
    });

    it('encodeClose builds [2-byte code][UTF-8 reason] and refuses unsendable codes', function() {
        var f = wsf.encodeClose(1000, 'bye');
        assert.equal(f[0], 0x88);
        assert.equal(f[1], 5);
        assert.equal(f.readUInt16BE(2), 1000);
        assert.equal(f.slice(4).toString('utf8'), 'bye');

        // 1005 / 1006 / 1015 are reserved — MUST NOT be put on the wire (§7.4.1)
        assert.throws(function() { wsf.encodeClose(1005); }, RangeError);
        assert.throws(function() { wsf.encodeClose(1006); }, RangeError);
        assert.throws(function() { wsf.encodeClose(1015); }, RangeError);
        assert.throws(function() { wsf.encodeClose(999); }, RangeError);
        assert.throws(function() { wsf.encodeClose(1000, 'x'.repeat(124)); }, RangeError);
    });

});


// 02 — parser basics: round-trips, chunking resilience
describe('02 - parser: masked round-trips and chunking resilience', function() {

    it('parses a masked text frame (server mode)', function() {
        var c = collect();
        c.parser.feed(maskedText('hello'));
        assert.equal(c.events.errors.length, 0);
        assert.deepEqual(c.events.messages, [{ data: 'hello', isBinary: false }]);
    });

    it('parses unmasked server frames in client mode — full direction symmetry', function() {
        var c = collect({ isServer: false });
        c.parser.feed(wsf.encodeText('from-server'));
        assert.equal(c.events.errors.length, 0);
        assert.deepEqual(c.events.messages, [{ data: 'from-server', isBinary: false }]);
    });

    it('round-trips every length-form boundary: 0, 1, 125, 126, 65535, 65536, 100000', function() {
        [0, 1, 125, 126, 65535, 65536, 100000].forEach(function(len) {
            var payload = Buffer.alloc(len, 0x42);
            var c = collect({ maxPayload: 200000 });
            c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.BINARY, payload: payload, mask: true }));
            assert.equal(c.events.errors.length, 0, 'len ' + len + ' must parse clean');
            assert.equal(c.events.messages.length, 1, 'len ' + len + ' must deliver one message');
            assert.equal(c.events.messages[0].isBinary, true);
            assert.equal(c.events.messages[0].data.length, len);
        });
    });

    it('survives byte-at-a-time delivery', function() {
        var frame = maskedText('drip');
        var c = collect();
        for (var i = 0; i < frame.length; i++) {
            c.parser.feed(frame.slice(i, i + 1));
        }
        assert.deepEqual(c.events.messages, [{ data: 'drip', isBinary: false }]);
    });

    it('processes multiple frames arriving in a single chunk', function() {
        var c = collect();
        c.parser.feed(Buffer.concat([maskedText('one'), maskedText('two'), wsf.encodePing('p', { mask: true })]));
        assert.equal(c.events.messages.length, 2);
        assert.equal(c.events.messages[0].data, 'one');
        assert.equal(c.events.messages[1].data, 'two');
        assert.equal(c.events.pings.length, 1);
    });

});


// 03 — §5.1 masking enforcement
describe('03 - masking enforcement (§5.1)', function() {

    it('server mode fails an UNMASKED client frame with 1002', function() {
        var c = collect();
        c.parser.feed(wsf.encodeText('nope'));
        assert.equal(c.events.messages.length, 0);
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
        assert.equal(c.parser.isDead(), true);
    });

    it('client mode fails a MASKED server frame with 1002', function() {
        var c = collect({ isServer: false });
        c.parser.feed(maskedText('nope'));
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

    it('subtract: the same unmasked frame parses clean when masking is not required', function() {
        var c = collect({ isServer: false });
        c.parser.feed(wsf.encodeText('fine'));
        assert.equal(c.events.errors.length, 0);
        assert.equal(c.events.messages[0].data, 'fine');
    });

});


// 04 — §5.2 minimal length encoding (hand-crafted wire bytes)
describe('04 - minimal length encoding rejections (§5.2)', function() {

    it('rejects a 16-bit length below 126 with 1002, from the header alone', function() {
        var c = collect();
        c.parser.feed(Buffer.from([0x81, 0xFE, 0x00, 0x7C])); // masked, 126-form, len 124
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

    it('rejects a 64-bit length below 65536 with 1002', function() {
        var c = collect();
        c.parser.feed(Buffer.from([0x81, 0xFF, 0, 0, 0, 0, 0, 0, 0x01, 0x00])); // 64-bit form, len 256
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

    it('rejects a 64-bit length with the most significant bit set', function() {
        var c = collect();
        c.parser.feed(Buffer.from([0x81, 0xFF, 0x80, 0, 0, 0, 0, 0, 0, 0]));
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

});


// 05 — malformed-frame rejection table
describe('05 - malformed-frame rejection table', function() {

    function expect1002(bytes, label) {
        var c = collect();
        c.parser.feed(Buffer.from(bytes));
        assert.equal(c.events.errors.length, 1, label + ': expected one error');
        assert.equal(c.events.errors[0].closeCode, 1002, label + ': expected closeCode 1002');
        assert.equal(c.parser.isDead(), true, label + ': parser must be dead');
    }

    it('rejects non-zero RSV bits (no extension negotiated)', function() {
        expect1002([0xC1, 0x81, 1, 2, 3, 4, 0x61], 'RSV1');
    });

    it('rejects reserved non-control opcode 0x3', function() {
        expect1002([0x83, 0x80, 1, 2, 3, 4], 'opcode 0x3');
    });

    it('rejects reserved control opcode 0xB', function() {
        expect1002([0x8B, 0x80, 1, 2, 3, 4], 'opcode 0xB');
    });

    it('rejects a control frame with the 126-byte length form', function() {
        expect1002([0x89, 0xFE], 'oversized ping header'); // ping, masked, len7=126
    });

    it('rejects a fragmented control frame (FIN clear)', function() {
        expect1002([0x09, 0x80, 1, 2, 3, 4], 'fragmented ping');
    });

    it('rejects a continuation frame with no message in progress', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.CONTINUATION, payload: 'x', mask: true }));
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

    it('rejects a new data frame interleaved within a fragmented message', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: 'part', fin: false, mask: true }));
        assert.equal(c.events.errors.length, 0);
        c.parser.feed(maskedText('interloper'));
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

});


// 06 — §5.4 fragmentation + §10.4 caps
describe('06 - fragmentation reassembly and DoS caps (§5.4, §10.4)', function() {

    function frag(opcode, payload, fin) {
        return wsf.encodeFrame({ opcode: opcode, payload: payload, fin: fin, mask: true });
    }

    it('reassembles a three-fragment text message', function() {
        var c = collect();
        c.parser.feed(frag(wsf.OPCODES.TEXT, 'Hel', false));
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'lo ', false));
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'world', true));
        assert.equal(c.events.errors.length, 0);
        assert.deepEqual(c.events.messages, [{ data: 'Hello world', isBinary: false }]);
    });

    it('handles a control frame injected between fragments (§5.4)', function() {
        var c = collect();
        c.parser.feed(frag(wsf.OPCODES.TEXT, 'a', false));
        c.parser.feed(wsf.encodePing('beat', { mask: true }));
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'b', true));
        assert.equal(c.events.errors.length, 0);
        assert.equal(c.events.pings.length, 1);
        assert.equal(c.events.pings[0].toString(), 'beat');
        assert.deepEqual(c.events.messages, [{ data: 'ab', isBinary: false }]);
    });

    it('rejects an oversized DECLARED frame length from the header alone (1009, nothing buffered)', function() {
        var c = collect({ maxPayload: 1000 });
        // masked binary, 126-form, declared length 2000 — only the 4 header bytes are fed
        c.parser.feed(Buffer.from([0x82, 0xFE, 0x07, 0xD0]));
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1009);
    });

    it('caps the REASSEMBLED message size across fragments (1009)', function() {
        var c = collect({ maxPayload: 10 });
        c.parser.feed(frag(wsf.OPCODES.TEXT, 'AAAAAA', false));   // 6 bytes buffered
        assert.equal(c.events.errors.length, 0);
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'BBBBB', true)); // 6 + 5 > 10
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1009);
    });

    it('caps the fragment count (1008)', function() {
        var c = collect({ maxFragments: 3 });
        c.parser.feed(frag(wsf.OPCODES.TEXT, 'a', false));          // count 1
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'b', false));  // count 2
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'c', false));  // count 3
        assert.equal(c.events.errors.length, 0);
        c.parser.feed(frag(wsf.OPCODES.CONTINUATION, 'd', true));   // count 4 > 3
        assert.equal(c.events.errors.length, 1);
        assert.equal(c.events.errors[0].closeCode, 1008);
    });

});


// 07 — §5.5.1 / §7.4 close handling
describe('07 - close frames and the §7.4 status-code table', function() {

    function closeWith(code, reasonBuf) {
        var payload = Buffer.alloc(2 + (reasonBuf ? reasonBuf.length : 0));
        payload.writeUInt16BE(code, 0);
        if (reasonBuf) { reasonBuf.copy(payload, 2); }
        return wsf.encodeFrame({ opcode: wsf.OPCODES.CLOSE, payload: payload, mask: true });
    }

    it('delivers code + reason and stops processing afterwards', function() {
        var c = collect();
        c.parser.feed(closeWith(1000, Buffer.from('done')));
        assert.deepEqual(c.events.closes, [{ code: 1000, reason: 'done' }]);
        assert.equal(c.parser.isDead(), true);
        c.parser.feed(maskedText('after-close'));
        assert.equal(c.events.messages.length, 0, 'frames after Close must be ignored');
    });

    it('reports an empty Close body as 1005 ("no status code was actually present")', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.CLOSE, mask: true }));
        assert.deepEqual(c.events.closes, [{ code: 1005, reason: '' }]);
    });

    it('rejects a 1-byte Close body with 1002', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.CLOSE, payload: Buffer.from([0x03]), mask: true }));
        assert.equal(c.events.errors[0].closeCode, 1002);
    });

    it('rejects every reserved / out-of-range received code with 1002', function() {
        [999, 1004, 1005, 1006, 1015, 1016, 2999].forEach(function(code) {
            var c = collect();
            c.parser.feed(closeWith(code));
            assert.equal(c.events.closes.length, 0, 'code ' + code + ' must not be delivered');
            assert.equal(c.events.errors.length, 1, 'code ' + code + ' must error');
            assert.equal(c.events.errors[0].closeCode, 1002, 'code ' + code + ' must fail with 1002');
        });
    });

    it('accepts the defined, the IANA-registered and the private-use ranges', function() {
        [1000, 1001, 1002, 1003, 1007, 1011, 1012, 1014, 3000, 4999].forEach(function(code) {
            var c = collect();
            c.parser.feed(closeWith(code));
            assert.equal(c.events.errors.length, 0, 'code ' + code + ' must be accepted');
            assert.equal(c.events.closes[0].code, code);
        });
    });

    it('rejects a non-UTF-8 close reason with 1007', function() {
        var c = collect();
        c.parser.feed(closeWith(1000, Buffer.from([0xC3, 0x28])));
        assert.equal(c.events.errors[0].closeCode, 1007);
    });

});


// 08 — §8.1 UTF-8 validation
describe('08 - UTF-8 validation (§8.1)', function() {

    it('round-trips multibyte text', function() {
        var c = collect();
        c.parser.feed(maskedText('héllo 🚀'));
        assert.deepEqual(c.events.messages, [{ data: 'héllo 🚀', isBinary: false }]);
    });

    it('fails an invalid-UTF-8 text payload with 1007', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: Buffer.from([0xFF, 0xFE]), mask: true }));
        assert.equal(c.events.messages.length, 0);
        assert.equal(c.events.errors[0].closeCode, 1007);
    });

    it('validates the WHOLE message after reassembly — a multibyte char may split across fragments', function() {
        // U+1F680 (0xF0 0x9F 0x9A 0x80) split mid-character: each fragment alone is
        // invalid UTF-8, the reassembled message is valid.
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: Buffer.from([0xF0, 0x9F]), fin: false, mask: true }));
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.CONTINUATION, payload: Buffer.from([0x9A, 0x80]), fin: true, mask: true }));
        assert.equal(c.events.errors.length, 0);
        assert.deepEqual(c.events.messages, [{ data: '🚀', isBinary: false }]);
    });

    it('fails an invalid reassembled text message with 1007', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: Buffer.from([0xF0, 0x9F]), fin: false, mask: true }));
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.CONTINUATION, payload: Buffer.from([0xFF]), fin: true, mask: true }));
        assert.equal(c.events.errors[0].closeCode, 1007);
    });

    it('binary frames carry arbitrary bytes — no UTF-8 validation', function() {
        var c = collect();
        c.parser.feed(wsf.encodeFrame({ opcode: wsf.OPCODES.BINARY, payload: Buffer.from([0xFF, 0xFE]), mask: true }));
        assert.equal(c.events.errors.length, 0);
        assert.equal(c.events.messages[0].isBinary, true);
        assert.deepEqual(c.events.messages[0].data, Buffer.from([0xFF, 0xFE]));
    });

});


// 09 — §5.5.2 / §5.5.3 ping & pong
describe('09 - ping / pong control frames', function() {

    it('delivers ping payloads (the consumer pongs them back)', function() {
        var c = collect();
        c.parser.feed(wsf.encodePing('heartbeat', { mask: true }));
        assert.equal(c.events.pings.length, 1);
        assert.equal(c.events.pings[0].toString(), 'heartbeat');
    });

    it('accepts the 125-byte control-frame maximum', function() {
        var c = collect();
        c.parser.feed(wsf.encodePing(Buffer.alloc(125, 0x50), { mask: true }));
        assert.equal(c.events.errors.length, 0);
        assert.equal(c.events.pings[0].length, 125);
    });

    it('accepts an unsolicited pong (unidirectional heartbeat)', function() {
        var c = collect();
        c.parser.feed(wsf.encodePong('beat', { mask: true }));
        assert.equal(c.events.errors.length, 0);
        assert.equal(c.events.pongs[0].toString(), 'beat');
    });

    it('encodePong echoes the ping application data byte-for-byte', function() {
        var payload = crypto.randomBytes(32);
        var pong = wsf.encodePong(payload);
        assert.deepEqual(pong.slice(2), payload);
    });

});


// 10 — differential oracle against the ws package (real framework dependency)
var ws = null;
try {
    ws = require(path.join(FW, 'node_modules/ws'));
} catch (e) {
    try { ws = require(path.join(__dirname, '../../node_modules/ws')); } catch (e2) { /* skip below */ }
}

describe('10 - differential oracle vs ws (Sender/Receiver public API)', function() {

    var oit = ws ? it : it.skip;

    function wsFrame(data, options) {
        return Buffer.concat(ws.Sender.frame(data, Object.assign({
            fin: true, rsv1: false, mask: true, maskBuffer: crypto.randomBytes(4), readOnly: false
        }, options)));
    }

    oit('frames built by ws.Sender parse identically in our parser (text, lengths 5 / 126 / 65536)', function() {
        [5, 126, 65536].forEach(function(len) {
            var text = 'x'.repeat(len);
            var c = collect({ maxPayload: 200000 });
            c.parser.feed(wsFrame(Buffer.from(text), { opcode: 1 }));
            assert.equal(c.events.errors.length, 0, 'len ' + len + ' must parse clean');
            assert.equal(c.events.messages[0].data, text);
            assert.equal(c.events.messages[0].isBinary, false);
        });
    });

    oit('a ws.Sender fragmented message reassembles in our parser', function() {
        var c = collect();
        c.parser.feed(wsFrame(Buffer.from('Hel'), { opcode: 1, fin: false }));
        c.parser.feed(wsFrame(Buffer.from('lo'), { opcode: 0, fin: true }));
        assert.equal(c.events.errors.length, 0);
        assert.deepEqual(c.events.messages, [{ data: 'Hello', isBinary: false }]);
    });

    oit('frames built by our encoder are accepted by ws.Receiver', function() {
        return new Promise(function(resolve, reject) {
            var receiver = new ws.Receiver({
                binaryType: 'nodebuffer', extensions: {}, isServer: true,
                maxPayload: 1048576, skipUTF8Validation: false
            });
            receiver.on('error', reject);
            receiver.on('message', function(data, isBinary) {
                try {
                    assert.equal(data.toString('utf8'), 'cross-checked');
                    assert.equal(isBinary, false);
                    resolve();
                } catch (e) { reject(e); }
            });
            receiver.write(wsf.encodeFrame({ opcode: wsf.OPCODES.TEXT, payload: 'cross-checked', mask: true }));
        });
    });

    oit('our close frame round-trips through ws.Receiver (conclude event)', function() {
        return new Promise(function(resolve, reject) {
            var receiver = new ws.Receiver({
                binaryType: 'nodebuffer', extensions: {}, isServer: true,
                maxPayload: 1048576, skipUTF8Validation: false
            });
            receiver.on('error', reject);
            receiver.on('conclude', function(code, reason) {
                try {
                    assert.equal(code, 1000);
                    assert.equal(reason.toString('utf8'), 'bye');
                    resolve();
                } catch (e) { reject(e); }
            });
            receiver.write(wsf.encodeClose(1000, 'bye', { mask: true }));
        });
    });

    oit('rejection parity: both parsers refuse an unmasked client frame', function() {
        return new Promise(function(resolve, reject) {
            var ours = collect();
            ours.parser.feed(wsf.encodeText('unmasked'));
            try {
                assert.equal(ours.events.errors[0].closeCode, 1002, 'our parser must fail 1002');
            } catch (e) { return reject(e); }

            var receiver = new ws.Receiver({
                binaryType: 'nodebuffer', extensions: {}, isServer: true,
                maxPayload: 1048576, skipUTF8Validation: false
            });
            receiver.on('error', function(err) {
                try {
                    assert.equal(err[Object.getOwnPropertySymbols(err).find(function(s) {
                        return String(s).indexOf('status-code') > -1;
                    })] || 1002, 1002);
                    resolve();
                } catch (e) { reject(e); }
            });
            receiver.on('message', function() { reject(new Error('ws.Receiver accepted an unmasked client frame')); });
            receiver.write(wsf.encodeText('unmasked'));
        });
    });

});
