#!/usr/bin/env node

/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2026 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Consumer-resolution type gate (#DTO3b — Half A).
 *
 * Compiles `test/fixtures/types-consumer/consumer.ts` with the real
 * TypeScript compiler, resolving `gina` BY PACKAGE NAME through the
 * package.json exports map (`moduleResolution: node16`). This is the gate
 * a plain `tsc --noEmit` over the `.d.ts` files cannot be: it verifies the
 * declarations as a CONSUMER receives them. A by-path probe is
 * structurally blind to a broken main-entry `export =`.
 *
 * Then compiles `control.ts`, which MUST FAIL with two specific
 * diagnostics — proving the instrument can fire:
 *   - TS2339 (bogus member) — resolution really loaded gina's declarations
 *     (a silent fallback to `any` would otherwise make the gate vacuous);
 *   - TS2304 (from bad-lib.d.ts) — `skipLibCheck: false` is operative.
 *
 * Exit codes: 0 = gate green; 1 = fixture failed to compile, the control
 * failed to fire, or a precondition is broken.
 *
 * Run with:
 *   node script/check_types_consumer.js
 * or as part of:
 *   npm run types:check
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT   = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'types-consumer');
const TSC_BIN     = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

function out(msg) {
    // Synchronous write: this script can run piped (CI); async stdout would
    // be truncated by process.exit.
    fs.writeSync(1, msg + '\n');
}
function fail(msg) {
    fs.writeSync(2, '[check-types-consumer] ' + msg + '\n');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Preconditions — fail loud and actionable, never silently skip.
// ---------------------------------------------------------------------------

if (!fs.existsSync(TSC_BIN)) {
    fail('typescript is not installed. Run: npm install --ignore-scripts');
}

// `gina` must resolve by package name to THIS repo's declarations (the CI
// symlink / post-install self-link). Without it the fixture cannot exercise
// the exports map at all. The invariant is CONTENT identity: whatever
// checkout the symlink lands on must carry byte-identical `types/*.d.ts`,
// or the fixture would certify a DIFFERENT gina's declarations (a detached
// gate worktree legitimately resolves to its source checkout — same bytes).
let resolvedGina = null;
try {
    resolvedGina = fs.realpathSync(path.join(REPO_ROOT, 'node_modules', 'gina'));
} catch (err) {
    fail('node_modules/gina is missing — the fixture resolves gina by package name.\n' +
         '  Fix: ln -sf "$(pwd)" node_modules/gina   (from the repo root)');
}
if (fs.realpathSync(REPO_ROOT) !== resolvedGina) {
    for (const rel of ['types/index.d.ts', 'types/globals.d.ts', 'types/gna.d.ts']) {
        const ours   = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        const theirs = fs.readFileSync(path.join(resolvedGina, rel), 'utf8');
        if (ours !== theirs) {
            fail('node_modules/gina resolves to ' + resolvedGina + ' whose ' + rel +
                 ' DIFFERS from this repo\'s — the fixture would typecheck a DIFFERENT gina.');
        }
    }
}

// The two config levers the gate depends on must not silently drift.
for (const cfgName of ['tsconfig.json', 'tsconfig.control.json']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, cfgName), 'utf8'));
    if (cfg.compilerOptions.skipLibCheck !== false) {
        fail(cfgName + ': skipLibCheck must be false — with true the gate is vacuous ' +
             '(a deliberately-garbage .d.ts reports clean).');
    }
    if (cfg.compilerOptions.moduleResolution !== 'node16') {
        fail(cfgName + ': moduleResolution must be node16 — anything else bypasses ' +
             'the exports map the gate exists to exercise.');
    }
}

// ---------------------------------------------------------------------------
// Run tsc.
// ---------------------------------------------------------------------------

function runTsc(project) {
    try {
        const stdout = execFileSync(TSC_BIN, ['-p', path.join(FIXTURE_DIR, project)], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return { status: 0, output: stdout || '' };
    } catch (err) {
        return {
            status: (typeof err.status === 'number') ? err.status : 1,
            output: String(err.stdout || '') + String(err.stderr || '')
        };
    }
}

// Half A — the fixture must compile clean.
const fixture = runTsc('tsconfig.json');
if (fixture.status !== 0) {
    fs.writeSync(2, fixture.output + '\n');
    fail('consumer fixture FAILED to typecheck (see diagnostics above) — the published ' +
         'declarations no longer describe the runtime surface the fixture exercises.');
}
out('[check-types-consumer] consumer fixture: clean (exports-map resolution, strict, skipLibCheck:false)');

// The control must FIRE — otherwise the gate cannot fail and proves nothing.
const control = runTsc('tsconfig.control.json');
if (control.status === 0) {
    fail('CONTROL DID NOT FIRE: control.ts compiled clean. The gate is vacuous — ' +
         'most likely `gina` resolved to `any` or lib checking is off.');
}
if (control.output.indexOf('TS2339') === -1) {
    fs.writeSync(2, control.output + '\n');
    fail('CONTROL INCOMPLETE: expected TS2339 on the bogus member (proves gina\'s ' +
         'declarations were actually loaded).');
}
if (control.output.indexOf('TS2304') === -1) {
    fs.writeSync(2, control.output + '\n');
    fail('CONTROL INCOMPLETE: expected TS2304 from bad-lib.d.ts (proves skipLibCheck:false ' +
         'is operative).');
}
out('[check-types-consumer] can-fail control: fired as expected (TS2339 + TS2304)');
out('[check-types-consumer] OK');
