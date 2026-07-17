/**
 * lib/cmd/image/list.js + lib/cmd/image/rm.js — the `image:list` and `image:rm`
 * verbs, plus the three lib/image-build primitives they introduce
 * (containerHostSpawn / parseImagesJson / isValidImageRef).
 *
 * Both verbs are HOST-level: they operate on the container host `image:build`
 * targets, resolved through the SAME precedence (env override > native buildah >
 * settings), and neither takes a project.
 *
 * Behavioural tests drive the REAL pure lib (required by path — it reads no
 * framework globals); the CLI handlers (which need the CmdHelper daemon
 * context) are covered by source-inspection pins, matching image-build.test.js
 * and connector-models.test.js. Coverage:
 *
 *   (a) containerHostSpawn — native vs ssh argv assembly, `-p` only when the
 *       descriptor names a port, bad-mode throw
 *   (b) parseImagesJson — the REAL `buildah images --json` shape, `names: null`
 *       (untagged) -> <none>:<none>, multi-tag -> one row per tag, and the
 *       tolerated-garbage matrix
 *   (c) isValidImageRef — the injection gate: shell metacharacters AND option
 *       injection (a `-f` ref) rejected, every legitimate ref shape accepted,
 *       plus a SUBTRACT proving the gate (not the spawn builder) is what stops
 *       a malicious ref from reaching the remote shell
 *   (d) handler pins — registry consumption, the `images --json` / `rmi` argv,
 *       fs.writeSync stdout (a `process.exit` cannot truncate it on a pipe),
 *       and the SECURITY-CRITICAL ordering invariant: rm validates the ref
 *       BEFORE it assembles/executes any command
 *   (e) CmdHelper exemption — `image:rm` is project-agnostic; the anchored
 *       exemption must not leak to `project:rm`
 *   (f) help.txt surface
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW           = require('../fw');
var LIB_MAIN     = path.join(FW, 'lib/image-build/src/main.js');
var LIST_HANDLER = path.join(FW, 'lib/cmd/image/list.js');
var RM_HANDLER   = path.join(FW, 'lib/cmd/image/rm.js');
var HELP_TXT     = path.join(FW, 'lib/cmd/image/help.txt');
var CMD_HELPER   = path.join(FW, 'lib/cmd/helper.js');

var imageBuild = require(LIB_MAIN);

var listSrc   = fs.readFileSync(LIST_HANDLER, 'utf8');
var rmSrc     = fs.readFileSync(RM_HANDLER, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var helperSrc = fs.readFileSync(CMD_HELPER, 'utf8');

// A resolved descriptor, as `resolveContainerHost` returns it.
var NATIVE   = { mode: 'native' };
var SSH      = { mode: 'ssh', descriptor: 'ssh://build@lin', parsed: { sshTarget: 'build@lin', port: null } };
var SSH_PORT = { mode: 'ssh', descriptor: 'ssh://build@lin:2222', parsed: { sshTarget: 'build@lin', port: 2222 } };

describe('image:list + image:rm — host-level image verbs (lib/image-build + lib/cmd/image)', function() {

    // -----------------------------------------------------------------------
    // (a) containerHostSpawn
    // -----------------------------------------------------------------------
    describe('01 — containerHostSpawn', function() {

        it('native runs buildah directly', function() {
            assert.deepEqual(
                imageBuild.containerHostSpawn(NATIVE, ['images', '--json']),
                { command: 'buildah', args: ['images', '--json'] }
            );
        });

        it('ssh wraps buildah on the remote, BatchMode + ConnectTimeout, no -p when the descriptor names no port', function() {
            assert.deepEqual(
                imageBuild.containerHostSpawn(SSH, ['images', '--json']),
                { command: 'ssh', args: [
                    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                    'build@lin', 'buildah', 'images', '--json'
                ] }
            );
        });

        it('ssh adds -p ONLY when the descriptor names a port (a bare ssh://host defers to ssh config)', function() {
            var withPort = imageBuild.containerHostSpawn(SSH_PORT, ['rmi', 'x:1']);
            assert.deepEqual(withPort.args.slice(0, 6), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', '2222']);
            assert.ok(imageBuild.containerHostSpawn(SSH, ['rmi', 'x:1']).args.indexOf('-p') < 0);
        });

        it('does not mutate the caller argv', function() {
            var argv = ['images', '--json'];
            imageBuild.containerHostSpawn(SSH, argv);
            assert.deepEqual(argv, ['images', '--json']);
        });

        it('throws on a mode it cannot execute (an `error` descriptor must never reach it)', function() {
            assert.throws(function() { imageBuild.containerHostSpawn({ mode: 'error', reason: 'x' }, ['images']); }, /native.*or.*ssh/i);
        });
    });

    // -----------------------------------------------------------------------
    // (b) parseImagesJson — against the REAL buildah --json shape
    // -----------------------------------------------------------------------
    describe('02 — parseImagesJson', function() {

        // Captured verbatim from `buildah images --json` (buildah 1.42.1).
        var REAL = JSON.stringify([
            { id: '44b5401ff810', names: ['docker.io/library/node:22-slim'], digest: 'sha256:813a74', createdat: '3 weeks ago', size: '252 MB', created: 1782265788, createdatraw: '2026-06-24T01:49:48.437707756Z', readonly: false, history: null },
            { id: 'f030b57bbc3a', names: null, digest: 'sha256:1b52f1', createdat: '11 days ago', size: '293 MB', created: 1783267491, createdatraw: '2026-07-05T16:04:51.510116611Z', readonly: false, history: null }
        ]);

        it('maps the real buildah shape to { ref, id, size, created, sizeBytes, createdAt }', function() {
            var rows = imageBuild.parseImagesJson(REAL);
            assert.equal(rows.length, 2);
            assert.deepEqual(rows[0], { ref: 'docker.io/library/node:22-slim', id: '44b5401ff810', size: '252 MB', created: '3 weeks ago', sizeBytes: 252000000, createdAt: '2026-06-24T01:49:48.437707756Z' });
        });

        it('renders an untagged image (names: null) as <none>:<none> rather than crashing', function() {
            var rows = imageBuild.parseImagesJson(REAL);
            assert.equal(rows[1].ref, '<none>:<none>');
            assert.equal(rows[1].id, 'f030b57bbc3a');
        });

        it('yields one row per tag for a multi-tagged image', function() {
            var rows = imageBuild.parseImagesJson('[{"id":"i1","names":["a:1","b:2"],"size":"1 MB","createdat":"now"}]');
            assert.deepEqual(rows.map(function(r) { return r.ref; }), ['a:1', 'b:2']);
            assert.equal(rows[0].id, rows[1].id, 'both rows carry the same image id');
        });

        it('tolerates empty stdout, a bare null, a non-array and malformed JSON — each is [] , never a throw', function() {
            ['', '   ', 'null', '{}', '"str"', 'not json', undefined, null].forEach(function(input) {
                assert.deepEqual(imageBuild.parseImagesJson(input), [], 'input: ' + JSON.stringify(input));
            });
        });

        it('an empty image list is [] (a host with no images)', function() {
            assert.deepEqual(imageBuild.parseImagesJson('[]'), []);
        });

        it('truncates a long (64-char) id to the 12-char short form buildah displays', function() {
            var long = 'a'.repeat(64);
            assert.equal(imageBuild.parseImagesJson('[{"id":"' + long + '","names":["x:1"]}]')[0].id, 'a'.repeat(12));
        });

        it('createdAt passes buildah\'s RFC3339 createdatraw through verbatim', function() {
            var rows = imageBuild.parseImagesJson(REAL);
            assert.equal(rows[1].createdAt, '2026-07-05T16:04:51.510116611Z');
        });

        it('createdAt falls back to the epoch `created` field (ISO-converted) when createdatraw is absent', function() {
            var rows = imageBuild.parseImagesJson('[{"id":"i2","names":["y:1"],"size":"5 MB","createdat":"now","created":1783267491}]');
            assert.equal(rows[0].createdAt, '2026-07-05T16:04:51.000Z');
        });

        it('createdAt is "" and sizeBytes null when the machine fields are absent or unparseable', function() {
            var rows = imageBuild.parseImagesJson('[{"id":"i3","names":["z:1"]}]');
            assert.equal(rows[0].createdAt, '');
            assert.equal(rows[0].sizeBytes, null);
        });
    });

    // -----------------------------------------------------------------------
    // (b2) parseHumanSize — the derived sizeBytes primitive
    // -----------------------------------------------------------------------
    describe('02b — parseHumanSize', function() {

        it('parses buildah\'s decimal suffixes (powers of 1000)', function() {
            assert.equal(imageBuild.parseHumanSize('999 B'), 999);
            assert.equal(imageBuild.parseHumanSize('1 KB'), 1000);
            assert.equal(imageBuild.parseHumanSize('252 MB'), 252000000);
            assert.equal(imageBuild.parseHumanSize('1.5 GB'), 1500000000);
            assert.equal(imageBuild.parseHumanSize('2.93 GB'), 2930000000);
            assert.equal(imageBuild.parseHumanSize('1 TB'), 1000000000000);
        });

        it('accepts binary suffixes defensively (powers of 1024)', function() {
            assert.equal(imageBuild.parseHumanSize('2 KiB'), 2048);
            assert.equal(imageBuild.parseHumanSize('1 MiB'), 1048576);
        });

        it('is case- and whitespace-tolerant', function() {
            assert.equal(imageBuild.parseHumanSize('252MB'), 252000000);
            assert.equal(imageBuild.parseHumanSize(' 252 mb '), 252000000);
        });

        it('returns null on anything else — never a throw, never a guess', function() {
            [undefined, null, '', '   ', 'weird', 'MB 252', '-1 MB', '252 XB', '1e3 MB', '252'].forEach(function(input) {
                assert.equal(imageBuild.parseHumanSize(input), null, 'input: ' + JSON.stringify(input));
            });
        });
    });

    // -----------------------------------------------------------------------
    // (c) isValidImageRef — the injection gate
    // -----------------------------------------------------------------------
    describe('03 — isValidImageRef (injection gate)', function() {

        it('accepts every legitimate image-ref shape', function() {
            [
                'localhost/myproject/demo:prod',
                'docker.io/library/node:22-slim',
                'sha256:abc123def456',
                'f030b57bbc3a',
                'a'.repeat(64),
                'registry.example.com:5000/team/app:1.2.3',
                'repo@sha256:abcdef0123456789'
            ].forEach(function(ref) {
                assert.equal(imageBuild.isValidImageRef(ref), true, 'should accept: ' + ref);
            });
        });

        it('REJECTS shell metacharacters — the ref reaches a remote shell via ssh', function() {
            [
                'foo; echo PWNED',
                'foo && id',
                'foo | cat',
                'a$(id)',
                'a`id`',
                'a b',
                'foo\nbar',
                'foo>out',
                "foo'q",
                'foo"q',
                'foo\\bar'
            ].forEach(function(ref) {
                assert.equal(imageBuild.isValidImageRef(ref), false, 'should reject: ' + JSON.stringify(ref));
            });
        });

        it('REJECTS option injection — a leading `-` would be read by buildah as a flag', function() {
            ['-f', '-rf', '--force', '--all', '-'].forEach(function(ref) {
                assert.equal(imageBuild.isValidImageRef(ref), false, 'should reject: ' + ref);
            });
        });

        it('rejects empty, non-string and over-long refs', function() {
            ['', undefined, null, 42, {}, []].forEach(function(ref) {
                assert.equal(imageBuild.isValidImageRef(ref), false, 'should reject: ' + JSON.stringify(ref));
            });
            assert.equal(imageBuild.isValidImageRef('a'.repeat(513)), false, 'over the 512-char cap');
        });

        // SUBTRACT — proves the GATE is load-bearing: containerHostSpawn does NOT
        // sanitise, so a malicious ref that skipped the gate would land verbatim
        // in the argv ssh hands to the remote shell.
        it('SUBTRACT: containerHostSpawn does not sanitise, so the gate is what stops injection', function() {
            var evil = 'foo; echo PWNED';
            var spawned = imageBuild.containerHostSpawn(SSH, ['rmi', evil]);
            assert.ok(spawned.args.indexOf(evil) > -1, 'the spawn builder passes the ref through verbatim');
            assert.equal(imageBuild.isValidImageRef(evil), false, 'so the gate must reject it before it gets here');
        });
    });

    // -----------------------------------------------------------------------
    // (d) handler pins
    // -----------------------------------------------------------------------
    describe('04 — handler pins', function() {

        it('both handlers consume the lib through the registry (never a bare require)', function() {
            assert.match(listSrc, /var imageBuild = lib\.imageBuild;/);
            assert.match(rmSrc,   /var imageBuild = lib\.imageBuild;/);
            assert.doesNotMatch(listSrc, /require\(.*image-build/);
            assert.doesNotMatch(rmSrc,   /require\(.*image-build/);
        });

        it('list asks the host for `images --json` and parses it through the lib', function() {
            assert.match(listSrc, /containerHostSpawn\(host, \['images', '--json'\]\)/);
            assert.match(listSrc, /imageBuild\.parseImagesJson\(/);
        });

        it('rm maps --force to buildah `-f`, and omits it otherwise', function() {
            assert.match(rmSrc, /force \? \['rmi', '-f', ref\] : \['rmi', ref\]/);
        });

        it('rm requires an explicit ref — no bulk delete', function() {
            assert.match(rmSrc, /requires an image reference/);
            assert.doesNotMatch(rmSrc, /'--all'/, 'no --all bulk delete in this slice');
        });

        // SECURITY-CRITICAL: the gate must precede any command assembly. If a
        // refactor ever moved the spawn above the validation, injection goes live.
        it('rm validates the ref BEFORE it assembles or runs any command (ordering invariant)', function() {
            var validateIdx = rmSrc.indexOf('isValidImageRef(ref)');
            var spawnIdx    = rmSrc.indexOf('containerHostSpawn(');
            var execIdx     = rmSrc.indexOf('spawnSync(spawnCmd');
            assert.ok(validateIdx > -1, 'rm validates the ref');
            assert.ok(spawnIdx > -1 && execIdx > -1, 'rm assembles and executes a command');
            assert.ok(validateIdx < spawnIdx, 'validation must precede spawn-arg assembly');
            assert.ok(validateIdx < execIdx,  'validation must precede execution');
        });

        it('both handlers write stdout with fs.writeSync — a process.exit cannot truncate it on a pipe', function() {
            assert.match(listSrc, /fs\.writeSync\(1, JSON\.stringify\(\{ host: hostLabel, images: rows \}\)/);
            assert.match(rmSrc,   /fs\.writeSync\(1, '\[image:rm\] removed '/);
            assert.doesNotMatch(listSrc, /process\.stdout\.write/);
            assert.doesNotMatch(rmSrc,   /process\.stdout\.write/);
        });

        it('both resolve the host with image:build`s precedence — env override, then native, then settings', function() {
            [listSrc, rmSrc].forEach(function(src) {
                assert.match(src, /getEnvVar\('GINA_CONTAINER_HOST'\)/);
                assert.match(src, /imageBuild\.resolveContainerHost\(/);
                assert.match(src, /settingsValue *: *getSettingsContainerHost\(\)/);
                assert.match(src, /host\.mode === 'error'/, 'an unresolvable host fails with the resolver reason');
            });
        });

        it('list validates --format and defaults to text', function() {
            assert.match(listSrc, /\['text', 'json'\]\.indexOf\(self\.format\) < 0/);
            assert.match(listSrc, /var self = \{ format: 'text' \}/);
        });
    });

    // -----------------------------------------------------------------------
    // (e) CmdHelper exemption — image:rm is project-agnostic
    // -----------------------------------------------------------------------
    describe('05 — CmdHelper project exemption', function() {

        it('helper.js exempts image:rm from the project requirement, anchored', function() {
            assert.match(helperSrc, /!\/\^image\\:rm\$\/\.test\(cmd\.task\)/);
        });

        // Pure-logic replica of the helper.js:517 gate — the guard decides whether
        // a task must name a project at all.
        var needsProject = function(task) {
            return !/\:list$/.test(task) && !/^project\:status$/.test(task) && !/^image\:rm$/.test(task);
        };

        it('image:rm needs no project (it removes an image from the host by ref)', function() {
            assert.equal(needsProject('image:rm'), false);
        });

        it('image:list rides the general :list exemption', function() {
            assert.equal(needsProject('image:list'), false);
        });

        it('the exemption does NOT leak to project:rm, which stays project-scoped', function() {
            assert.equal(needsProject('project:rm'), true);
        });

        it('image:build still requires a project', function() {
            assert.equal(needsProject('image:build'), true);
        });

        // SUBTRACT — without the image:rm clause, the verb would demand a project
        // it has no concept of (the "No project name found" failure this fixes).
        it('SUBTRACT: without the exemption clause, image:rm would demand a project', function() {
            var withoutClause = function(task) {
                return !/\:list$/.test(task) && !/^project\:status$/.test(task);
            };
            assert.equal(withoutClause('image:rm'), true, 'the pre-fix gate forced a project on image:rm');
        });
    });

    // -----------------------------------------------------------------------
    // (f) help.txt surface
    // -----------------------------------------------------------------------
    describe('06 — help.txt', function() {

        it('documents both new actions and their flags', function() {
            assert.ok(helpTxt.indexOf('image:list') > -1);
            assert.ok(helpTxt.indexOf('image:rm') > -1);
            assert.ok(helpTxt.indexOf('--force') > -1);
            assert.match(helpTxt, /Options \(image:list\)/);
            assert.match(helpTxt, /Options \(image:rm\)/);
        });

        it('states that list shows every image (there is no gina-only filter)', function() {
            assert.match(helpTxt, /Every image on\s+the host is shown/);
        });
    });
});
