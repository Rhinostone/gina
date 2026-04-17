var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var PROC_SOURCE   = path.join(require('../fw'), 'lib/proc.js');
var SERVER_SOURCE = path.join(require('../fw'), 'core/server.js');


// ---------------------------------------------------------------------------
// Replica of the process.server assignment logic from server.js.
// In production, self.instance.listen() is called with a real port.
// Here we inject a stub so the logic can be exercised without a network.
// ---------------------------------------------------------------------------
function assignProcessServer(selfInstance) {
    var _rawServer = selfInstance.listen(0);
    return (_rawServer && typeof _rawServer.close === 'function') ? _rawServer : selfInstance;
}

// ---------------------------------------------------------------------------
// Replica of the SIGTERM shutdown sequence from proc.js.
// proc and env are injected so the logic can be tested without signals.
// ---------------------------------------------------------------------------
function runShutdown(proc, shutdownMs, done) {
    var _httpServer = proc.server || null;
    if (_httpServer && typeof _httpServer.close === 'function') {
        var _shutdownTimer = setTimeout(function() {
            proc.exit(143);
            done('timeout');
        }, shutdownMs);
        if (typeof _httpServer.closeIdleConnections === 'function') {
            _httpServer.closeIdleConnections();
        }
        _httpServer.close(function() {
            clearTimeout(_shutdownTimer);
            proc.exit(143);
            done(null);
        });
    } else {
        proc.exit(143);
        done(null);
    }
}


// ---------------------------------------------------------------------------
// 01 — Source: server.js — process.server assigned from listen() return value
// ---------------------------------------------------------------------------
describe('01 - graceful shutdown: process.server wired in server.js', function() {

    it('listen() return value is captured into _rawServer', function() {
        var src = fs.readFileSync(SERVER_SOURCE, 'utf8');
        assert.ok(
            /var _rawServer\s*=\s*self\.instance\.listen\(/.test(src),
            'expected `var _rawServer = self.instance.listen(...)` in server.js'
        );
    });

    it('process.server is assigned from _rawServer', function() {
        var src = fs.readFileSync(SERVER_SOURCE, 'utf8');
        assert.ok(
            /process\.server\s*=\s*\(_rawServer\s*&&\s*typeof _rawServer\.close/.test(src),
            'expected `process.server = (_rawServer && typeof _rawServer.close === \'function\') ? ...` in server.js'
        );
    });

    it('process.server assignment falls back to self.instance', function() {
        var src = fs.readFileSync(SERVER_SOURCE, 'utf8');
        assert.ok(
            /\?\s*_rawServer\s*:\s*self\.instance/.test(src),
            'expected ternary fallback to self.instance in server.js'
        );
    });

});


// ---------------------------------------------------------------------------
// 02 — Source: proc.js — SIGTERM handler structure
// ---------------------------------------------------------------------------
describe('02 - graceful shutdown: SIGTERM handler structure in proc.js', function() {

    it('SIGTERM handler reads proc.server', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /proc\.on\('SIGTERM'[\s\S]*?proc\.server/.test(src),
            'expected proc.server referenced inside SIGTERM handler'
        );
    });

    it('server.close() is called with a callback', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /_httpServer\.close\(function\(\)/.test(src),
            'expected `_httpServer.close(function() {...})` in SIGTERM handler'
        );
    });

    it('hard timeout references GINA_SHUTDOWN_TIMEOUT env var', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /GINA_SHUTDOWN_TIMEOUT/.test(src),
            'expected GINA_SHUTDOWN_TIMEOUT env var in SIGTERM handler'
        );
    });

    it('hard timeout defaults to 10 000 ms', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /\|\|\s*10000/.test(src),
            'expected `|| 10000` default for shutdown timeout'
        );
    });

    it('closeIdleConnections() is guarded by typeof check', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /typeof _httpServer\.closeIdleConnections\s*===\s*'function'/.test(src),
            'expected typeof guard before closeIdleConnections() call'
        );
    });

    it('shutdown timer is unref()d', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        assert.ok(
            /_shutdownTimer\.unref/.test(src),
            'expected _shutdownTimer.unref() so the timer does not block natural exit'
        );
    });

    it('fallback immediate exit present when proc.server is absent', function() {
        var src = fs.readFileSync(PROC_SOURCE, 'utf8');
        // The else branch must contain proc.exit(143)
        var sigtermBlock = src.slice(src.indexOf("proc.on('SIGTERM'"));
        sigtermBlock = sigtermBlock.slice(0, sigtermBlock.indexOf("proc.on('SIGABRT'"));
        assert.ok(
            /\}\s*else\s*\{[^}]*proc\.exit\(143\)/.test(sigtermBlock),
            'expected else branch with proc.exit(143) when proc.server is absent'
        );
    });

});


// ---------------------------------------------------------------------------
// 03 — Logic: process.server assignment (isolated, no network)
// ---------------------------------------------------------------------------
describe('03 - graceful shutdown: process.server assignment logic', function() {

    it('uses _rawServer when listen() returns an object with close()', function() {
        var rawServer = { close: function() {} };
        var instance  = { listen: function() { return rawServer; } };
        var result = assignProcessServer(instance);
        assert.strictEqual(result, rawServer,
            'process.server should be the raw server returned by listen()'
        );
    });

    it('falls back to self.instance when listen() returns null', function() {
        var instance = { listen: function() { return null; } };
        var result = assignProcessServer(instance);
        assert.strictEqual(result, instance,
            'process.server should fall back to self.instance when listen() returns null'
        );
    });

    it('falls back to self.instance when listen() returns object without close()', function() {
        var instance = { listen: function() { return {}; } };
        var result = assignProcessServer(instance);
        assert.strictEqual(result, instance,
            'process.server should fall back to self.instance when raw server has no close()'
        );
    });

    it('falls back to self.instance when listen() returns undefined', function() {
        var instance = { listen: function() { return undefined; } };
        var result = assignProcessServer(instance);
        assert.strictEqual(result, instance,
            'process.server should fall back to self.instance when listen() returns undefined'
        );
    });

});


// ---------------------------------------------------------------------------
// 04 — Logic: shutdown sequence (isolated, mock server, no signals)
// ---------------------------------------------------------------------------
describe('04 - graceful shutdown: shutdown sequence logic', function() {

    it('server.close() callback triggers exit(143)', function(_, done) {
        var exitCode = null;
        var proc = {
            server: { close: function(cb) { cb(); } },
            exit:   function(code) { exitCode = code; }
        };
        runShutdown(proc, 5000, function(reason) {
            assert.equal(reason, null,        'should drain cleanly, not time out');
            assert.equal(exitCode, 143,       'exit code must be 143 (128 + SIGTERM)');
            done();
        });
    });

    it('closeIdleConnections() is called when available', function(_, done) {
        var idleClosed = false;
        var proc = {
            server: {
                close:               function(cb) { cb(); },
                closeIdleConnections: function() { idleClosed = true; }
            },
            exit: function() {}
        };
        runShutdown(proc, 5000, function() {
            assert.ok(idleClosed, 'closeIdleConnections() must be called when present');
            done();
        });
    });

    it('closeIdleConnections() is skipped without throwing when absent', function(_, done) {
        var closed = false;
        var proc = {
            server: { close: function(cb) { closed = true; cb(); } },
            exit:   function() {}
        };
        assert.doesNotThrow(function() {
            runShutdown(proc, 5000, function() {
                assert.ok(closed, 'close() must still be called');
                done();
            });
        });
    });

    it('exits immediately when proc.server is null', function() {
        var exitCode = null;
        var proc = {
            server: null,
            exit:   function(code) { exitCode = code; }
        };
        runShutdown(proc, 5000, function() {});
        assert.equal(exitCode, 143, 'must exit immediately with 143 when server is absent');
    });

    it('exits immediately when proc.server has no close() method', function() {
        var exitCode = null;
        var proc = {
            server: { noClose: true },
            exit:   function(code) { exitCode = code; }
        };
        runShutdown(proc, 5000, function() {});
        assert.equal(exitCode, 143, 'must exit immediately with 143 when server lacks close()');
    });

    it('hard timeout fires if close() never calls its callback', function(_, done) {
        var exitCode = null;
        var proc = {
            server: { close: function(_cb) { /* never calls cb */ } },
            exit:   function(code) { exitCode = code; }
        };
        // Use a 50ms timeout so the test does not take 10s
        runShutdown(proc, 50, function(reason) {
            assert.equal(reason,    'timeout', 'shutdown path must be the hard timeout');
            assert.equal(exitCode,  143,        'exit code must be 143 on timeout');
            done();
        });
    });

});


// ---------------------------------------------------------------------------
// 03 — EPIPE uncaughtException loop: re-entry guard
// ---------------------------------------------------------------------------
//
// Bug: detached daemons inherit stdio pipes whose peer (the launching CLI)
//      has exited. Any write triggers EPIPE; without a listener on the
//      stream, it escalates to uncaughtException. The uncaughtException
//      EPIPE branch itself wrote to stdout → recursive EPIPE → CPU pegged
//      at 100% forever.
// Fix (proc.js): install silent stdout/stderr error listeners at init,
//      add a `_inEpipeHandler` re-entry guard, wrap the stdout writes in
//      try/catch so a still-dead stream is swallowed rather than re-thrown.
// ---------------------------------------------------------------------------

/**
 * Replica of the EPIPE branch with the re-entry guard. Returns the number
 * of write attempts that reached the inner `stdout.write` call.
 */
function runEpipeBranch(invocations) {
    var _inEpipeHandler = false;
    var writes = 0;
    var proc = { stdout: { write: function() { writes++; } } };

    for (var i = 0; i < invocations; i++) {
        // Replicates the uncaughtException EPIPE branch:
        //   if (_inEpipeHandler) return false;
        //   _inEpipeHandler = true;
        //   try { proc.stdout.write(...); } catch (_) {}
        //   _inEpipeHandler = false;
        if (_inEpipeHandler) continue;
        _inEpipeHandler = true;
        try { proc.stdout.write('x'); } catch (_) {}
        _inEpipeHandler = false;
    }
    return writes;
}

/**
 * Simulate the re-entrant failure mode: stdout.write throws EPIPE, which
 * (in pre-fix code) would recursively re-enter the handler. With the guard,
 * the second call is suppressed; the try/catch swallows the throw.
 */
function runEpipeBranchWithThrowingStdout() {
    var _inEpipeHandler = false;
    var attempts = 0;

    function handler() {
        if (_inEpipeHandler) return 'reentrant-suppressed';
        _inEpipeHandler = true;
        try {
            attempts++;
            if (attempts <= 3) {
                // Re-enter recursively — simulates stdout.write triggering another EPIPE
                handler();
            }
            throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
        } catch (_) { /* swallow */ }
        _inEpipeHandler = false;
        return 'first-call';
    }

    var outcome = handler();
    return { outcome: outcome, attempts: attempts };
}

describe('03 - EPIPE uncaughtException loop: re-entry guard', function() {

    var procSrc = fs.readFileSync(PROC_SOURCE, 'utf8');

    it('source: silent stdout.on(error) listener is installed at init', function() {
        assert.ok(
            /proc\.stdout[\s\S]*?\.on\(\s*['"]error['"]\s*,\s*function\(\s*\)\s*\{\s*\}\s*\)/.test(procSrc),
            'proc.js must install a no-op error listener on proc.stdout to absorb EPIPE'
        );
    });

    it('source: silent stderr.on(error) listener is installed at init', function() {
        assert.ok(
            /proc\.stderr[\s\S]*?\.on\(\s*['"]error['"]\s*,\s*function\(\s*\)\s*\{\s*\}\s*\)/.test(procSrc),
            'proc.js must install a no-op error listener on proc.stderr to absorb EPIPE'
        );
    });

    it('source: re-entry guard variable `_inEpipeHandler` is declared', function() {
        assert.ok(
            /var\s+_inEpipeHandler\s*=\s*false\s*;/.test(procSrc),
            'proc.js must declare the _inEpipeHandler re-entry guard'
        );
    });

    it('source: uncaughtException EPIPE branch short-circuits on re-entry', function() {
        // Both EPIPE branches (err.code EPIPE) should gate their stdout.write
        // on _inEpipeHandler. Assert the pattern appears at least twice.
        var matches = procSrc.match(/if\s*\(\s*_inEpipeHandler\s*\)\s*return/g) || [];
        assert.ok(
            matches.length >= 2,
            'expected at least two `if (_inEpipeHandler) return` guards in the EPIPE branches'
        );
    });

    it('source: stdout.write inside EPIPE branch is wrapped in try/catch', function() {
        // A bare proc.stdout.write() that throws would re-enter uncaughtException.
        // Require the write to sit inside a try block that catches.
        assert.ok(
            /try\s*\{\s*proc\.stdout\.write\([^\)]*\);\s*\}\s*catch\s*\(\s*_[\w]*\s*\)/.test(procSrc),
            'proc.stdout.write inside the EPIPE branch must be wrapped in try/catch'
        );
    });

    it('replica: re-entry guard prevents the inner write from firing twice in one call', function() {
        var result = runEpipeBranchWithThrowingStdout();
        assert.equal(result.outcome, 'first-call', 'outer call should complete normally after guarding');
        // attempts starts at 1 (first call); every recursive call is blocked by the guard.
        assert.equal(result.attempts, 1,
            'nested re-entry must be suppressed — expected exactly one attempt to reach the write');
    });

    it('replica: guard still allows sequential (non-nested) EPIPEs to each write once', function() {
        var writes = runEpipeBranch(5);
        assert.equal(writes, 5,
            'five sequential EPIPE events should each produce exactly one write — the guard is per-event, not one-shot');
    });

});
