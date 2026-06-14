var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs     = require('fs');
var path   = require('path');

var CMD_SOURCE = path.resolve(__dirname, '../../bin/cmd');
var CMD_SRC    = fs.readFileSync(CMD_SOURCE, 'utf8');


// ---------------------------------------------------------------------------
// Helpers — replica of the per-connection accumulate-and-parse handler in
// bin/cmd (the `conn.on('data')` listener inside net.createServer). We
// replicate only the pure-logic parts here, without opening a socket.
//
// Contract (#B41):
//   - accumulate every chunk into a per-connection buffer;
//   - parse only when the buffer holds a complete JSON value (TCP may split
//     or coalesce the single client write across 'data' chunks);
//   - a partial / non-JSON / empty chunk must NOT throw — keep accumulating;
//   - a valid-but-non-array payload is dropped (warned), never crashes.
// ---------------------------------------------------------------------------

/**
 * Build a fresh handler with its own per-connection buffer + counters.
 * `feed(chunk)` returns the parsed argv array once the payload completes,
 * or null while it is still incomplete / non-JSON / wrong-shape.
 */
function makeHandler() {
    var state = { payload: '', parsed: 0, warned: 0 };

    function feed(chunk) {
        state.payload += String(chunk);

        var argv;
        try {
            argv = JSON.parse(state.payload);
        } catch (parseErr) {
            // incomplete (TCP split) / non-JSON / empty — keep accumulating
            return null;
        }
        // complete payload consumed — reset for any further command
        state.payload = '';

        if (!Array.isArray(argv)) {
            state.warned++;
            return null;
        }
        state.parsed++;
        return argv;
    }

    return { feed: feed, state: state };
}


// ---------------------------------------------------------------------------
// 01 — Source: bin/cmd exists and is required as a module (not spawned directly)
// ---------------------------------------------------------------------------
describe('01 - bin/cmd: file exists', function() {

    it('bin/cmd file exists', function() {
        assert.ok(fs.existsSync(CMD_SOURCE), 'expected bin/cmd to exist');
    });

    it('exports a Cmd constructor', function() {
        assert.ok(
            /module\.exports\s*=\s*Cmd;/.test(CMD_SRC),
            'bin/cmd must export the Cmd constructor'
        );
    });
});


// ---------------------------------------------------------------------------
// 02 — Source-inspection: #B41 hardened command-socket data handler
// ---------------------------------------------------------------------------
describe('02 - #B41 source pins: guarded, accumulating data handler', function() {

    it('declares a per-connection accumulation buffer', function() {
        assert.ok(
            /var\s+_payload\s*=\s*'';/.test(CMD_SRC),
            'bin/cmd must declare a per-connection `var _payload = \'\';` buffer'
        );
    });

    it('appends every chunk to the buffer before parsing', function() {
        assert.ok(
            CMD_SRC.indexOf("_payload += data.toString();") > -1,
            'the data handler must accumulate via `_payload += data.toString();`'
        );
    });

    it('parses the accumulated buffer inside a try/catch', function() {
        assert.ok(
            CMD_SRC.indexOf('argv = JSON.parse( _payload );') > -1,
            'must parse the accumulated `_payload`, not a single chunk'
        );
        assert.ok(
            /try\s*\{[\s\S]{0,120}?argv = JSON\.parse\( _payload \);[\s\S]{0,80}?\}\s*catch\s*\(\s*parseErr\s*\)/.test(CMD_SRC),
            'the JSON.parse must sit inside a try/catch (catch (parseErr))'
        );
    });

    it('no longer parses an individual chunk unguarded', function() {
        assert.equal(
            CMD_SRC.indexOf('JSON.parse( data.toString() )'),
            -1,
            'the original unguarded `JSON.parse( data.toString() )` must be gone'
        );
    });

    it('the catch returns (keeps accumulating) instead of throwing', function() {
        assert.ok(
            /catch\s*\(\s*parseErr\s*\)\s*\{[\s\S]{0,300}?return;/.test(CMD_SRC),
            'the parse catch must `return;` (no rethrow, no crash)'
        );
    });

    it('guards against a valid-but-non-array payload before argv.join', function() {
        var guardIdx = CMD_SRC.indexOf('!Array.isArray(argv)');
        var joinIdx  = CMD_SRC.indexOf("argv.join(' ')");
        assert.ok(guardIdx > -1, 'must guard `!Array.isArray(argv)`');
        assert.ok(joinIdx > -1, 'argv.join must still drive the debug log');
        assert.ok(
            guardIdx < joinIdx,
            'the Array.isArray guard must precede argv.join (which would throw on a non-array)'
        );
    });
});


// ---------------------------------------------------------------------------
// 03 — Pure-logic replica: accumulate-and-parse behaviour
// ---------------------------------------------------------------------------
describe('03 - #B41 replica: accumulate-and-parse never crashes', function() {

    it('parses a complete argv array delivered in one chunk', function() {
        var h = makeHandler();
        var argv = h.feed(JSON.stringify(['node', '/p', 'bundle:start', 'demo']));
        assert.deepStrictEqual(argv, ['node', '/p', 'bundle:start', 'demo']);
        assert.equal(h.state.parsed, 1);
        assert.equal(h.state.payload, '', 'buffer reset after a complete parse');
    });

    it('parses an argv array split across two chunks (TCP split)', function() {
        var h = makeHandler();
        var full = JSON.stringify(['node', '/p', 'framework:start']);
        var mid  = Math.floor(full.length / 2);

        var first = h.feed(full.slice(0, mid));
        assert.equal(first, null, 'partial chunk yields no argv yet');
        assert.notEqual(h.state.payload, '', 'partial chunk is buffered');

        var second = h.feed(full.slice(mid));
        assert.deepStrictEqual(second, ['node', '/p', 'framework:start']);
        assert.equal(h.state.parsed, 1);
    });

    it('coalesced-then-completed payload still parses once', function() {
        var h = makeHandler();
        var full = JSON.stringify(['node', '/p', 'x']);
        // simulate three byte-level fragments
        assert.equal(h.feed(full.slice(0, 3)), null);
        assert.equal(h.feed(full.slice(3, 7)), null);
        assert.deepStrictEqual(h.feed(full.slice(7)), ['node', '/p', 'x']);
        assert.equal(h.state.parsed, 1);
    });

    it('an empty chunk does not throw and yields no argv', function() {
        var h = makeHandler();
        assert.doesNotThrow(function() { h.feed(''); });
        assert.equal(h.feed(''), null);
        assert.equal(h.state.parsed, 0);
        assert.equal(h.state.warned, 0);
    });

    it('garbage non-JSON does not throw (kept accumulating, never parses)', function() {
        var h = makeHandler();
        assert.doesNotThrow(function() { h.feed('not json at all <<<'); });
        assert.equal(h.feed('not json at all <<<'), null);
        assert.equal(h.state.parsed, 0);
    });

    it('valid JSON that is NOT an array is dropped (warned), never crashes', function() {
        var h1 = makeHandler();
        var r1;
        assert.doesNotThrow(function() { r1 = h1.feed('42'); });   // number
        assert.equal(r1, null);
        assert.equal(h1.state.warned, 1);
        assert.equal(h1.state.parsed, 0);

        var h2 = makeHandler();
        assert.equal(h2.feed('{"a":1}'), null);                    // object
        assert.equal(h2.state.warned, 1);
        assert.equal(h2.state.parsed, 0);
    });

    it('resets after a complete parse so a second command on the same connection parses too', function() {
        var h = makeHandler();
        assert.deepStrictEqual(h.feed(JSON.stringify(['node', '/p', 'a'])), ['node', '/p', 'a']);
        assert.deepStrictEqual(h.feed(JSON.stringify(['node', '/p', 'b'])), ['node', '/p', 'b']);
        assert.equal(h.state.parsed, 2);
        assert.equal(h.state.payload, '');
    });
});
