/**
 * lib/cmd/image/run.js — the `image:run` verb, plus the five lib/image-build
 * primitives it introduces (isValidContainerToken / isValidPublishSpec /
 * parseExposedPorts / composeEnvLines / parsePsJson) and the `binary` parameter
 * `containerHostSpawn` grows for it.
 *
 * `image:run` is HOST-level like `image:list`/`image:rm`: it runs an image on the
 * container host `image:build` targets, resolved through the SAME precedence, and
 * takes no project. It shells to **podman** — buildah builds images but cannot run
 * them — so `containerHostSpawn` must be able to name a binary other than buildah,
 * and a build-only host (buildah present, podman absent) is a supported shape.
 *
 * Behavioural tests drive the REAL pure lib (required by path — it reads no
 * framework globals); the CLI handler (which needs the CmdHelper daemon context)
 * is covered by source-inspection pins, matching image-list-rm.test.js and
 * image-build.test.js. Fixtures are captured verbatim from a live podman 5.7.0.
 * Coverage:
 *
 *   (a) containerHostSpawn — the podman arm, and buildah still the default so
 *       every existing caller is untouched
 *   (b) parseExposedPorts — the REAL `podman image inspect` document, the bare
 *       map, and the tolerated-garbage matrix
 *   (c) parsePsJson — the REAL `podman ps --format json` shape (snake_case Ports
 *       + the undocumented `range`), `Ports: null`, and a malformed epoch that
 *       must NOT throw
 *   (d) isValidContainerToken / isValidPublishSpec — the injection gates, with a
 *       SUBTRACT proving the gate (not the spawn builder) stops injection
 *   (e) composeEnvLines — the KEY=VALUE contract, and that a value may hold `=`
 *   (f) handler pins — registry consumption, the podman argv, the env-never-in-
 *       argv invariant, stdout-is-a-value (progress on stderr), and the
 *       SECURITY-CRITICAL ordering invariant: init gates everything and executes
 *       nothing
 *   (g) CmdHelper exemption — `image:run` is project-agnostic; the anchored
 *       exemption must not leak to `project:rm`
 *   (h) help.txt surface
 */

'use strict';

var fs   = require('fs');
var path = require('path');
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var FW          = require('../fw');
var LIB_MAIN    = path.join(FW, 'lib/image-build/src/main.js');
var RUN_HANDLER = path.join(FW, 'lib/cmd/image/run.js');
var HELP_TXT    = path.join(FW, 'lib/cmd/image/help.txt');
var CMD_HELPER  = path.join(FW, 'lib/cmd/helper.js');

var imageBuild = require(LIB_MAIN);

var runSrc    = fs.readFileSync(RUN_HANDLER, 'utf8');
var helpTxt   = fs.readFileSync(HELP_TXT, 'utf8');
var helperSrc = fs.readFileSync(CMD_HELPER, 'utf8');

// A negative code-absence pin trips on the file's OWN prose when the comment
// legitimately NAMES the forbidden token to explain why it is avoided — so the
// pins below that assert "this token appears nowhere in the CODE" run against a
// comment-stripped copy (full-line comments only; no line of run.js code is a
// bare `//` line). §07 validates that this stripper leaves the code intact — an
// over-stripped source would make every doesNotMatch pass vacuously.
var stripComments = function(src) {
    return src.split('\n').filter(function(line) {
        return !/^\s*(\/\/|\*|\/\*)/.test(line);
    }).join('\n');
};
var runCode = stripComments(runSrc);

// A resolved descriptor, as `resolveContainerHost` returns it.
var NATIVE   = { mode: 'native' };
var SSH      = { mode: 'ssh', descriptor: 'ssh://build@lin', parsed: { sshTarget: 'build@lin', port: null } };
var SSH_PORT = { mode: 'ssh', descriptor: 'ssh://build@lin:2222', parsed: { sshTarget: 'build@lin', port: 2222 } };

describe('image:run — the run family (lib/image-build primitives + lib/cmd/image/run)', function() {

    // -----------------------------------------------------------------------
    // (a) containerHostSpawn — the podman arm
    // -----------------------------------------------------------------------
    describe('01 — containerHostSpawn binary parameter', function() {

        it('runs podman natively when asked for it', function() {
            assert.deepEqual(
                imageBuild.containerHostSpawn(NATIVE, ['ps', '--format', 'json'], 'podman'),
                { command: 'podman', args: ['ps', '--format', 'json'] }
            );
        });

        it('names podman as the REMOTE binary over ssh (after the target, before the argv)', function() {
            assert.deepEqual(
                imageBuild.containerHostSpawn(SSH, ['ps', '--format', 'json'], 'podman'),
                { command: 'ssh', args: [
                    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                    'build@lin', 'podman', 'ps', '--format', 'json'
                ] }
            );
        });

        // Back-compat: the parameter is optional, so image:build / image:list /
        // image:rm keep working untouched.
        it('still defaults to buildah when no binary is named (every existing caller)', function() {
            assert.equal(imageBuild.containerHostSpawn(NATIVE, ['images', '--json']).command, 'buildah');
            assert.ok(imageBuild.containerHostSpawn(SSH, ['images', '--json']).args.indexOf('buildah') > -1);
            assert.ok(imageBuild.containerHostSpawn(SSH, ['images', '--json']).args.indexOf('podman') < 0);
        });

        it('the ssh -p rule is unchanged for podman (only when the descriptor names a port)', function() {
            assert.deepEqual(
                imageBuild.containerHostSpawn(SSH_PORT, ['stop', 'x'], 'podman').args.slice(0, 6),
                ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', '2222']
            );
            assert.ok(imageBuild.containerHostSpawn(SSH, ['stop', 'x'], 'podman').args.indexOf('-p') < 0);
        });
    });

    // -----------------------------------------------------------------------
    // (b) parseExposedPorts — against the REAL podman inspect document
    // -----------------------------------------------------------------------
    describe('02 — parseExposedPorts', function() {

        // The FULL document is read (never `--format '{{json .Config.ExposedPorts}}'`):
        // that token carries a SPACE, and containerHostSpawn's ssh path hands argv
        // tokens to a remote shell which splits it (measured: `bad character U+007B`,
        // rc 125). No token here contains a space, so native and ssh behave alike.
        var REAL = JSON.stringify([
            { Id: 'abc123', RepoTags: ['localhost/ocismoke/demo:prod'], Config: { ExposedPorts: { '3101/tcp': {} } } }
        ]);

        it('digs the EXPOSE out of the real inspect document (the allocator-computed port)', function() {
            assert.deepEqual(imageBuild.parseExposedPorts(REAL), [{ port: 3101, protocol: 'tcp' }]);
        });

        it('accepts a bare ExposedPorts map too', function() {
            assert.deepEqual(imageBuild.parseExposedPorts('{"3101/tcp":{}}'), [{ port: 3101, protocol: 'tcp' }]);
        });

        it('defaults a protocol-less key to tcp and keeps udp', function() {
            assert.deepEqual(imageBuild.parseExposedPorts('{"80":{}}'), [{ port: 80, protocol: 'tcp' }]);
            assert.deepEqual(imageBuild.parseExposedPorts('{"53/udp":{}}'), [{ port: 53, protocol: 'udp' }]);
        });

        it('sorts by port so the published order is deterministic', function() {
            assert.deepEqual(
                imageBuild.parseExposedPorts('{"8443/tcp":{},"80/tcp":{},"3101/tcp":{}}').map(function(e) { return e.port; }),
                [80, 3101, 8443]
            );
        });

        it('an image with no EXPOSE yields [] (podman inspects it to null)', function() {
            assert.deepEqual(imageBuild.parseExposedPorts('[{"Config":{}}]'), []);
            assert.deepEqual(imageBuild.parseExposedPorts('[{"Config":{"ExposedPorts":null}}]'), []);
            assert.deepEqual(imageBuild.parseExposedPorts('[{"Config":{"ExposedPorts":{}}}]'), []);
        });

        it('tolerates empty stdout, a bare null, a non-object and malformed JSON — [] , never a throw', function() {
            ['', '   ', 'null', '[]', '"str"', 'not json', undefined, null].forEach(function(input) {
                assert.deepEqual(imageBuild.parseExposedPorts(input), [], 'input: ' + JSON.stringify(input));
            });
        });

        it('drops unparseable and out-of-range port keys rather than guessing', function() {
            assert.deepEqual(imageBuild.parseExposedPorts('{"weird":{},"0/tcp":{},"99999/tcp":{},"3101/tcp":{}}'),
                [{ port: 3101, protocol: 'tcp' }]);
        });
    });

    // -----------------------------------------------------------------------
    // (c) parsePsJson — against the REAL podman ps --format json shape
    // -----------------------------------------------------------------------
    describe('03 — parsePsJson', function() {

        // Captured verbatim from `podman ps --format json` (podman 5.7.0). Note
        // `Ports` is snake_case and carries an undocumented `range` count.
        var REAL = JSON.stringify([
            {
                Id: '745903c26735aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233',
                Names: ['demo'],
                Image: 'localhost/ocismoke/demo:prod',
                ImageID: 'f030b57bbc3a',
                State: 'running',
                Status: 'Up Less than a second',
                Ports: [{ host_ip: '', container_port: 80, host_port: 18080, range: 1, protocol: 'tcp' }],
                ExposedPorts: null,
                CreatedAt: '2 minutes ago',
                Created: 1784256827,
                Exited: false,
                ExitCode: 0,
                ExitedAt: -62135596800,
                AutoRemove: false,
                Command: ['node', 'index.js'],
                Labels: null,
                Networks: ['podman'],
                Pid: 4242
            }
        ]);

        it('maps the real podman shape to the row contract', function() {
            var rows = imageBuild.parsePsJson(REAL);
            assert.equal(rows.length, 1);
            assert.deepEqual(rows[0], {
                id        : '745903c26735',
                name      : 'demo',
                image     : 'localhost/ocismoke/demo:prod',
                state     : 'running',
                status    : 'Up Less than a second',
                ports     : [{ hostPort: 18080, containerPort: 80, protocol: 'tcp' }],
                created   : '2 minutes ago',
                createdAt : '2026-07-17T02:53:47.000Z'
            });
        });

        it('truncates the 64-hex Id to the 12-char short form podman displays', function() {
            assert.equal(imageBuild.parsePsJson(REAL)[0].id, '745903c26735');
        });

        it('carries BOTH the humanized display string and the exact machine sibling (the image:list dual-key convention)', function() {
            var rows = imageBuild.parsePsJson(REAL);
            assert.equal(rows[0].created, '2 minutes ago', 'what podman renders');
            assert.equal(rows[0].createdAt, '2026-07-17T02:53:47.000Z', 'the exact ISO sibling');
        });

        // An empty host_ip is podman's "all interfaces" — reporting it as `''`
        // would be noise, so the key is omitted entirely.
        it('omits an empty host_ip, keeps a real one', function() {
            assert.ok(!('hostIp' in imageBuild.parsePsJson(REAL)[0].ports[0]));
            var bound = imageBuild.parsePsJson('[{"Id":"i","Names":["n"],"Ports":[{"host_ip":"127.0.0.1","container_port":80,"host_port":8080,"range":1,"protocol":"tcp"}]}]');
            assert.equal(bound[0].ports[0].hostIp, '127.0.0.1');
        });

        // container:ps lists EVERY container on the host, including ones podman
        // ran outside gina — so a published RANGE must not silently under-report
        // as a single pair.
        it('carries `range` ONLY when it exceeds 1 (a published port range)', function() {
            assert.ok(!('range' in imageBuild.parsePsJson(REAL)[0].ports[0]), 'range:1 is the ordinary single pair');
            var ranged = imageBuild.parsePsJson('[{"Id":"i","Names":["n"],"Ports":[{"host_ip":"","container_port":8000,"host_port":8000,"range":10,"protocol":"tcp"}]}]');
            assert.equal(ranged[0].ports[0].range, 10);
        });

        it('Ports: null (no published ports) becomes [] , not a crash', function() {
            var rows = imageBuild.parsePsJson('[{"Id":"i","Names":["n"],"Image":"x","State":"exited","Status":"Exited (137) 33 seconds ago","Ports":null}]');
            assert.deepEqual(rows[0].ports, []);
            assert.equal(rows[0].status, 'Exited (137) 33 seconds ago');
        });

        it('an unnamed container yields an empty name rather than crashing on Names', function() {
            assert.equal(imageBuild.parsePsJson('[{"Id":"i","Names":null}]')[0].name, '');
            assert.equal(imageBuild.parsePsJson('[{"Id":"i"}]')[0].name, '');
        });

        it('tolerates empty stdout, a bare null, a non-array and malformed JSON — [] , never a throw', function() {
            ['', '   ', 'null', '{}', '"str"', 'not json', undefined, null].forEach(function(input) {
                assert.deepEqual(imageBuild.parsePsJson(input), [], 'input: ' + JSON.stringify(input));
            });
        });

        it('an empty container list is [] (a host running nothing)', function() {
            assert.deepEqual(imageBuild.parsePsJson('[]'), []);
        });

        // An out-of-range epoch is FINITE, so an isFinite() guard alone lets it
        // through to `new Date(x*1000).toISOString()`, which throws RangeError —
        // breaking this parser's "malformed degrades, never throws" contract.
        it('a malformed (out-of-range but finite) epoch degrades to "" instead of throwing RangeError', function() {
            var rows;
            assert.doesNotThrow(function() {
                rows = imageBuild.parsePsJson('[{"Id":"i","Names":["n"],"Created":1e20}]');
            });
            assert.equal(rows[0].createdAt, '', 'the row survives, only the ISO sibling is empty');
            assert.equal(rows[0].id, 'i', 'the rest of the row is intact');
        });

        // SUBTRACT — proves the guard above is load-bearing rather than ceremony:
        // the pre-fix expression really does throw on this exact input.
        it('SUBTRACT: the unguarded conversion throws on that same epoch, and isFinite does not catch it', function() {
            assert.equal(isFinite(1e20), true, 'so an isFinite-only guard admits it');
            assert.throws(function() { return new Date(1e20 * 1000).toISOString(); }, RangeError);
        });

        it('createdAt is "" when Created is absent or not a number', function() {
            assert.equal(imageBuild.parsePsJson('[{"Id":"i","Names":["n"]}]')[0].createdAt, '');
            assert.equal(imageBuild.parsePsJson('[{"Id":"i","Names":["n"],"Created":"nope"}]')[0].createdAt, '');
        });
    });

    // -----------------------------------------------------------------------
    // (d) the injection gates
    // -----------------------------------------------------------------------
    describe('04 — isValidContainerToken (injection gate)', function() {

        it('accepts every legitimate container name / id shape', function() {
            ['demo', 'demo-prod', 'demo_1', 'a.b-c_d', 'x', '0abc', 'a'.repeat(64), 'a'.repeat(128)].forEach(function(t) {
                assert.equal(imageBuild.isValidContainerToken(t), true, 'should accept: ' + t);
            });
        });

        it('REJECTS shell metacharacters — the token reaches a remote shell via ssh', function() {
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
                'foo\\bar',
                'foo/bar',
                'foo:bar'
            ].forEach(function(t) {
                assert.equal(imageBuild.isValidContainerToken(t), false, 'should reject: ' + JSON.stringify(t));
            });
        });

        it('REJECTS option injection — a leading `-` would be read by podman as a flag', function() {
            ['-f', '-rf', '--force', '--all', '-', '_x', '.x'].forEach(function(t) {
                assert.equal(imageBuild.isValidContainerToken(t), false, 'should reject: ' + t);
            });
        });

        it('rejects empty, non-string and over-long tokens', function() {
            ['', undefined, null, 42, {}, []].forEach(function(t) {
                assert.equal(imageBuild.isValidContainerToken(t), false, 'should reject: ' + JSON.stringify(t));
            });
            assert.equal(imageBuild.isValidContainerToken('a'.repeat(129)), false, 'over the 128-char cap');
        });

        // SUBTRACT — proves the GATE is load-bearing: containerHostSpawn does NOT
        // sanitise, so a malicious name that skipped the gate would land verbatim
        // in the argv ssh hands to the remote shell.
        it('SUBTRACT: containerHostSpawn does not sanitise, so the gate is what stops injection', function() {
            var evil = 'foo; echo PWNED';
            var spawned = imageBuild.containerHostSpawn(SSH, ['stop', evil], 'podman');
            assert.ok(spawned.args.indexOf(evil) > -1, 'the spawn builder passes the token through verbatim');
            assert.equal(imageBuild.isValidContainerToken(evil), false, 'so the gate must reject it before it gets here');
        });
    });

    describe('05 — isValidPublishSpec', function() {

        it('accepts single and multiple host:container pairs', function() {
            ['8080:3100', '8080:3100,8443:8443', '1:1', '65535:65535', '80:3101,81:3102,82:3103'].forEach(function(s) {
                assert.equal(imageBuild.isValidPublishSpec(s), true, 'should accept: ' + s);
            });
        });

        it('rejects out-of-range ports on either side', function() {
            ['0:3100', '3100:0', '65536:80', '80:65536', '99999:3100'].forEach(function(s) {
                assert.equal(imageBuild.isValidPublishSpec(s), false, 'should reject: ' + s);
            });
        });

        it('rejects malformed shapes', function() {
            ['8080', '8080:', ':3100', '8080:3100,', ',8080:3100', '8080:3100:80', 'a:b', '8080-3100', '8080:3100 ', ''].forEach(function(s) {
                assert.equal(imageBuild.isValidPublishSpec(s), false, 'should reject: ' + JSON.stringify(s));
            });
        });

        it('rejects shell metacharacters and non-strings', function() {
            ['8080:3100; id', '$(id):80', '80:80|cat', undefined, null, 42, {}].forEach(function(s) {
                assert.equal(imageBuild.isValidPublishSpec(s), false, 'should reject: ' + JSON.stringify(s));
            });
        });

        // `none` is the caller's sentinel (publish nothing); this gate answers
        // only "is this a well-formed port map", so it must NOT accept it.
        it('does not accept the `none` sentinel — that is the caller\'s branch', function() {
            assert.equal(imageBuild.isValidPublishSpec('none'), false);
        });
    });

    // -----------------------------------------------------------------------
    // (e) composeEnvLines
    // -----------------------------------------------------------------------
    describe('06 — composeEnvLines', function() {

        it('passes valid KEY=VALUE pairs through in caller order', function() {
            assert.deepEqual(
                imageBuild.composeEnvLines(['DB_HOST=db.internal', 'PORT=3100', '_UNDERSCORE=ok']),
                ['DB_HOST=db.internal', 'PORT=3100', '_UNDERSCORE=ok']
            );
        });

        // Only the FIRST `=` splits, so a base64 / token / query-string value
        // survives intact — the same split-on-first-= rule as the CLI parser.
        it('splits on the FIRST `=` only, so a value may contain `=`', function() {
            assert.deepEqual(imageBuild.composeEnvLines(['TOKEN=a=b,c==']), ['TOKEN=a=b,c==']);
        });

        it('accepts an empty value', function() {
            assert.deepEqual(imageBuild.composeEnvLines(['EMPTY=']), ['EMPTY=']);
        });

        // Values never touch a shell (they ride stdin into a file), so anything
        // except a newline is legal — no over-gating.
        it('accepts shell metacharacters in a VALUE (they never reach a shell)', function() {
            assert.deepEqual(
                imageBuild.composeEnvLines(['P=$(id); rm -rf / `x` | cat > out']),
                ['P=$(id); rm -rf / `x` | cat > out']
            );
        });

        it('an empty list composes an empty file (the no-env path, a podman no-op)', function() {
            assert.deepEqual(imageBuild.composeEnvLines([]), []);
        });

        it('rejects a malformed entry with a user-facing reason', function() {
            assert.throws(function() { imageBuild.composeEnvLines(['NOEQUALS']); }, /expected KEY=VALUE/);
            assert.throws(function() { imageBuild.composeEnvLines(['=novalue']); }, /expected KEY=VALUE/);
        });

        it('rejects keys outside the POSIX env-name grammar', function() {
            ['2BAD=x', 'BAD-KEY=x', 'BAD KEY=x', 'BAD.KEY=x', 'BAD;KEY=x', '$BAD=x'].forEach(function(pair) {
                assert.throws(function() { imageBuild.composeEnvLines([pair]); }, /invalid env key/, 'should reject: ' + pair);
            });
        });

        // The --env-file format is line-based: a newline in a value would be read
        // back as a new (bogus) entry, so it is refused rather than silently mangled.
        it('rejects a newline in a value — the line-based format cannot carry one', function() {
            assert.throws(function() { imageBuild.composeEnvLines(['K=a\nb']); }, /newline/);
            assert.throws(function() { imageBuild.composeEnvLines(['K=a\rb']); }, /newline/);
        });
    });

    // -----------------------------------------------------------------------
    // (f) handler pins
    // -----------------------------------------------------------------------
    describe('07 — handler pins', function() {

        it('consumes the lib through the registry (never a bare require)', function() {
            assert.match(runSrc, /var imageBuild = lib\.imageBuild;/);
            assert.doesNotMatch(runSrc, /require\(.*image-build/);
        });

        it('resolves the host through the shared ./_host preamble (image:build`s precedence)', function() {
            assert.match(runSrc, /require\('\.\/_host'\)/);
            assert.match(runSrc, /hostUtil\.resolveHost\(\)/);
            assert.doesNotMatch(runSrc, /var resolveHost = function/, 'no inline copy of the preamble');
            assert.match(runSrc, /host\.mode === 'error'/, 'an unresolvable host fails with the resolver reason');
        });

        // podman, not buildah: buildah cannot run a container. Every exec that
        // must run the container names podman explicitly.
        it('drives podman (not buildah) for the run + inspect, via the binary parameter', function() {
            assert.match(runSrc, /containerHostSpawn\(host, \['image', 'inspect', ref\], 'podman'\)/);
            assert.match(runSrc, /spawn\('podman', nativeArgs\)/);
            assert.match(runSrc, /podman '/, 'the ssh remote command invokes podman');
        });

        // The build-only probe is the ONE deliberate buildah call: it runs only
        // after podman already failed, so a capable host never pays for it.
        it('probes buildah ONLY in the failure path, to report a build-only host honestly', function() {
            assert.match(runSrc, /containerHostSpawn\(host, \['--version'\], 'buildah'\)/);
            var probeIdx = runSrc.indexOf('var runUnavailableReason');
            var bodyEnd  = runSrc.indexOf('var isRunIncapable', probeIdx);
            assert.ok(probeIdx > -1 && bodyEnd > probeIdx, 'the probe helper is where it is expected');
            assert.match(runSrc.substring(probeIdx, bodyEnd), /buildah .* present — build-only host/);
            assert.match(runSrc, /image:run needs podman \+ conmon/);
        });

        // The comment-stripped copy is what the negative pin reads: run.js's own
        // comment NAMES `--format '{{json ...}}'` to explain why it is avoided,
        // and a raw-source pin would trip on that prose rather than on code.
        it('the comment stripper leaves the code intact (an over-stripped source would pass every negative pin vacuously)', function() {
            assert.ok(runCode.indexOf("containerHostSpawn(host, ['image', 'inspect', ref], 'podman')") > -1,
                'real code survives the strip');
            assert.ok(runCode.indexOf('{{json') < 0 && runSrc.indexOf('{{json') > -1,
                'and the strip is what removes the prose mention — so the pin below is meaningful');
        });

        it('reads the FULL inspect document — the --format token would be split by the remote shell', function() {
            assert.match(runSrc, /\['image', 'inspect', ref\]/);
            assert.doesNotMatch(runCode, /\{\{json/, 'a `{{json ...}}` token carries a space and cannot cross the ssh path');
        });

        // SECURITY-CRITICAL: env values must never be visible in the host's
        // process list, so they may not appear in argv — they ride stdin into a
        // 0600 file instead.
        it('never puts an env value in argv: a placeholder is assembled, substituted per host', function() {
            assert.match(runSrc, /var ENV_FILE_TOKEN = '__GINA_ENV_FILE__';/);
            assert.match(runSrc, /args\.push\('--env-file', ENV_FILE_TOKEN\)/);
            assert.doesNotMatch(runSrc, /push\('--env'[^-]/, 'no `--env KEY=VALUE` argv form');
            assert.match(runSrc, /child\.stdin\.end\(body\)/, 'the lines ride stdin');
            assert.match(runSrc, /mode: 384/, 'the native temp file is 0600');
        });

        // The remote file must be removed even when podman fails — and `exec`
        // would replace the shell, so the trap would never fire.
        it('the remote env file is trap-removed, and podman is NOT exec`d (exec would skip the trap)', function() {
            assert.match(runSrc, /trap "rm -f/);
            // runCode, not runSrc: the JSDoc right above the builder discusses
            // exec-vs-trap in prose, which a raw pin would eventually trip on.
            assert.doesNotMatch(runCode, /exec podman/);
        });

        it('--env-var is collected by an argv walk (the params map keeps only the last occurrence)', function() {
            assert.match(runSrc, /=== 'env-var'/);
            assert.match(runSrc, /var collectEnvVars = function/);
        });

        it('--env-var is applied AFTER --env-file so an inline value wins on a duplicate key', function() {
            var fileIdx = runSrc.indexOf('envPairs = readEnvFile(self.envFile)');
            var varIdx  = runSrc.indexOf('envPairs.concat(collectEnvVars())');
            assert.ok(fileIdx > -1 && varIdx > -1, 'both sources are read');
            assert.ok(fileIdx < varIdx, 'the file lines must be composed first');
        });

        it('detached mode captures the container id and refuses to report a silent success without one', function() {
            assert.match(runSrc, /\/\^\[0-9a-f\]\{12,64\}\$\//);
            assert.match(runSrc, /no container id was captured/);
        });

        // stdout in text mode carries a VALUE (`ID=$(gina image:run ...)`), so
        // the progress line goes to stderr — unlike image:build, whose text
        // output is narrative.
        it('writes the id ALONE to stdout and the progress line to stderr', function() {
            assert.match(runSrc, /fs\.writeSync\(1, id \+ '\\n'\)/);
            assert.match(runSrc, /fs\.writeSync\(2, '\[image:run\] starting '/);
            assert.doesNotMatch(runSrc, /fs\.writeSync\(1, '\[image:run\]/, 'progress must not pollute the id on stdout');
        });

        it('writes every stdout payload with fs.writeSync — a process.exit cannot truncate it on a pipe', function() {
            assert.match(runSrc, /fs\.writeSync\(1, JSON\.stringify\(frame\) \+ '\\n'\)/);
            assert.match(runSrc, /fs\.writeSync\(1, JSON\.stringify\(\{/);
            assert.doesNotMatch(runSrc, /process\.stdout\.write/);
        });

        it('validates --format and defaults to text', function() {
            assert.match(runSrc, /\['text', 'json'\]\.indexOf\(self\.format\) < 0/);
            assert.match(runSrc, /var self = \{ format: 'text', stream: false, rm: false \}/);
        });

        it('--stream runs in the foreground (no -d) and emits the NDJSON frame set', function() {
            assert.match(runSrc, /if \(!self\.stream\) args\.push\('-d'\)/);
            assert.match(runSrc, /type  : 'start'/);
            assert.match(runSrc, /type: 'log', stream: which, line: line/);
            assert.match(runSrc, /type: 'done', exitCode: code/);
            assert.match(runSrc, /type: 'error'/);
        });

        // SECURITY-CRITICAL ordering invariant. run.js defines its helpers ABOVE
        // init(), so a whole-file indexOf would compare against helper DEFINITIONS
        // and prove nothing — the slice is bounded to init()'s own body, where the
        // real contract lives: init gates every user token and executes NOTHING;
        // all assembly + exec happen downstream of the doRun handoff.
        describe('the validate -> assemble -> exec ordering invariant', function() {

            var initStart = runSrc.indexOf('var init = function ()');
            var initEnd   = runSrc.indexOf('var doRun = function (', initStart);
            var initBody  = runSrc.substring(initStart, initEnd);

            it('the init() slice anchors resolve (the pins below are meaningless otherwise)', function() {
                assert.ok(initStart > -1, 'init() is where it is expected');
                assert.ok(initEnd > initStart, 'doRun() follows init(), bounding the slice');
                assert.ok(initBody.length > 200, 'the slice carries a real body');
            });

            it('init gates EVERY user-controlled token before handing off', function() {
                var doRunIdx = initBody.indexOf('return doRun(');
                assert.ok(doRunIdx > -1, 'init hands off to doRun');
                [
                    ['isValidImageRef(ref)',                  'the image ref'],
                    ['isValidContainerToken(self.name)',      'the container name'],
                    ['isValidPublishSpec(self.publish)',      'the publish spec'],
                    ['composeEnvLines(envPairs)',             'the env pairs']
                ].forEach(function(pair) {
                    var idx = initBody.indexOf(pair[0]);
                    assert.ok(idx > -1, 'init validates ' + pair[1]);
                    assert.ok(idx < doRunIdx, 'validation of ' + pair[1] + ' must precede the doRun handoff');
                });
            });

            it('init executes NOTHING — every spawn lives downstream of the gates', function() {
                assert.doesNotMatch(initBody, /spawnSync\(/, 'no synchronous exec inside init');
                assert.doesNotMatch(initBody, /\bspawn\(/,   'no child spawn inside init');
                assert.doesNotMatch(initBody, /containerHostSpawn\(/, 'not even spawn-arg assembly inside init');
            });
        });
    });

    // -----------------------------------------------------------------------
    // (g) CmdHelper exemption — image:run is project-agnostic
    // -----------------------------------------------------------------------
    describe('08 — CmdHelper project exemption', function() {

        it('helper.js exempts image:run from the project requirement, anchored', function() {
            assert.match(helperSrc, /!\/\^image\\:run\$\/\.test\(cmd\.task\)/);
        });

        // Pure-logic replica of the helper.js outer gate — it decides whether a
        // task must name a project at all.
        var needsProject = function(task) {
            return !/\:list$/.test(task)
                && !/^project\:status$/.test(task)
                && !/^image\:rm$/.test(task)
                && !/^image\:run$/.test(task);
        };

        it('image:run needs no project (it runs an image on the host by ref)', function() {
            assert.equal(needsProject('image:run'), false);
        });

        it('the exemption does NOT leak to project:rm or project:run-alikes', function() {
            assert.equal(needsProject('project:rm'), true);
            assert.equal(needsProject('bundle:start'), true);
        });

        it('image:build still requires a project, image:rm/list stay exempt', function() {
            assert.equal(needsProject('image:build'), true);
            assert.equal(needsProject('image:rm'), false);
            assert.equal(needsProject('image:list'), false);
        });

        // SUBTRACT — without the image:run clause the verb would demand a project
        // it has no concept of. The failure is cwd-dependent and its INSIDE-a-
        // project branch is the dangerous one: helper.js silently adopts the cwd
        // folder as the project rather than erroring (the #B69 class).
        it('SUBTRACT: without the exemption clause, image:run would demand a project', function() {
            var withoutClause = function(task) {
                return !/\:list$/.test(task)
                    && !/^project\:status$/.test(task)
                    && !/^image\:rm$/.test(task);
            };
            assert.equal(withoutClause('image:run'), true, 'the pre-fix gate forced a project on image:run');
            assert.equal(withoutClause('image:rm'), false, 'while image:rm was already exempt');
        });
    });

    // -----------------------------------------------------------------------
    // (h) help.txt surface
    // -----------------------------------------------------------------------
    describe('09 — help.txt', function() {

        it('documents the run action and every flag it adds', function() {
            assert.ok(helpTxt.indexOf('image:run') > -1);
            assert.match(helpTxt, /Options \(image:run\)/);
            ['--name', '--publish', '--env-var', '--env-file', '--rm'].forEach(function(flag) {
                assert.ok(helpTxt.indexOf(flag) > -1, 'help.txt documents ' + flag);
            });
        });

        it('states the podman requirement and the build-only-host shape', function() {
            assert.match(helpTxt, /buildah builds images but cannot run them/);
            assert.match(helpTxt, /build-only host/);
        });

        it('states the default publish is the image`s own EXPOSE', function() {
            assert.match(helpTxt, /the port the image EXPOSEs/);
            assert.match(helpTxt, /--publish=none publishes\s+nothing/);
        });

        it('states the env-never-in-argv guarantee and the stdout-is-the-id contract', function() {
            assert.match(helpTxt, /never reach argv or a shell/);
            assert.match(helpTxt, /ID=\$\(gina image:run <image>\)/);
        });
    });
});
