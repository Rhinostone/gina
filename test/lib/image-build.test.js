/**
 * lib/image-build + lib/cmd/image/build.js — the `image:build` OCI packaging
 * verb: Containerfile synthesis, deterministic EXPOSE-port computation,
 * build-context staging, container-host descriptor resolution, and the
 * NDJSON/one-shot output contract.
 *
 * Behavioural tests drive the REAL pure lib (required by path — it reads no
 * framework globals) against on-disk fixtures; the CLI handler (which needs
 * the CmdHelper daemon context) is covered by source-inspection pins, the
 * same style as connector-models.test.js. Coverage:
 *
 *   (a) wiring — lib registered in lib/index.js, `image:` in bin/cli
 *       allowedOffline, arguments.json whitelist, help.txt surface
 *   (b) port allocator replica — compared against the REAL `bin/gina-init`
 *       output (spawned with an isolated GINA_HOMEDIR), two configurations;
 *       this is the EXPOSE-determinism guarantee
 *   (c) resolveBuildPlan — bundle/env/scope inference + the full error matrix
 *   (d) renderContainerfile — base image from the engine floor, dev-vs-release
 *       branching, dependency-install branching, EXPOSE, entrypoint contract
 *   (e) secrets — ${secret:KEY} placeholders ride byte-verbatim; the resolved
 *       env value never reaches the staged context or the Containerfile; the
 *       lib and the handler never touch the secrets resolver (negative pins)
 *   (f) context staging — allowlist walk, exclusions at any depth, symlink
 *       skip, executable entrypoint, listContext === stageContext manifest
 *   (g) descriptor — ssh://[user@]host[:port] parse matrix + resolution
 *       precedence (env override > native buildah > settings fallback > error)
 *   (h) handler pins — lib.imageBuild consumption, fs.writeSync NDJSON frames
 *       (start/step/log/done/error), reason-on-stdout + exit(1) failures,
 *       tar-over-ssh remote command shape (buildah accepts only a directory
 *       context), BatchMode ssh, --iidfile/--format oci
 */

'use strict';

var fs   = require('fs');
var os   = require('os');
var path = require('path');
var { describe, it, before, after } = require('node:test');
var assert = require('node:assert/strict');
var { spawnSync } = require('child_process');

var FW          = require('../fw');
var GINA_ROOT   = path.resolve(__dirname, '..', '..');
var LIB_MAIN    = path.join(FW, 'lib/image-build/src/main.js');
var LIB_PKG     = path.join(FW, 'lib/image-build/package.json');
var HANDLER     = path.join(FW, 'lib/cmd/image/build.js');
var HELP_TXT    = path.join(FW, 'lib/cmd/image/help.txt');
var ARGS_FILE   = path.join(FW, 'lib/cmd/image/arguments.json');
var LIB_INDEX   = path.join(FW, 'lib/index.js');
var CLI_SOURCE  = path.join(GINA_ROOT, 'bin', 'cli');
var GINA_INIT   = path.join(GINA_ROOT, 'bin', 'gina-init');

var imageBuild = require(LIB_MAIN);

var libSrc     = fs.readFileSync(LIB_MAIN, 'utf8');
var handlerSrc = fs.readFileSync(HANDLER, 'utf8');
var helpTxt    = fs.readFileSync(HELP_TXT, 'utf8');
var argsArr    = JSON.parse(fs.readFileSync(ARGS_FILE, 'utf8'));
var libIndex   = fs.readFileSync(LIB_INDEX, 'utf8');
var cliSrc     = fs.readFileSync(CLI_SOURCE, 'utf8');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

var STAMP    = Date.now();
var TMP_BASE = path.join(os.tmpdir(), 'gina-image-build-test-' + STAMP);

// A projects.json entry shaped like lib/cmd/project/add.js:453-473 writes it.
function fixtureProjectEntry() {
    return {
        path             : path.join(TMP_BASE, 'proj'),
        framework        : 'v9.9.9',
        envs             : ['dev', 'prod'],
        def_env          : 'dev',
        dev_env          : 'dev',
        scopes           : ['local', 'production'],
        def_scope        : 'local',
        local_scope      : 'local',
        production_scope : 'production',
        protocols        : ['http/1.1', 'http/2.0'],
        def_protocol     : 'http/1.1',
        schemes          : ['http', 'https'],
        def_scheme       : 'http'
    };
}

function fixtureManifest() {
    return {
        name    : 'parent',
        version : '1.0.0',
        bundles : {
            child : { version: '1.0.0', tag: '1.0.0', src: 'src/child' }
        }
    };
}

function planInput(overrides) {
    var input = {
        projectName  : 'parent',
        projectEntry : fixtureProjectEntry(),
        manifest     : fixtureManifest(),
        nodeEngine   : '>= 22 <27'
    };
    for (var k in (overrides || {})) { input[k] = overrides[k]; }
    return input;
}

// Writes the on-disk fixture project used by the staging + secrets tests.
function writeFixtureProject(base) {
    var proj = path.join(base, 'proj');
    fs.mkdirSync(path.join(proj, 'src/child/config'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'node_modules/somepkg'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'src/child/node_modules'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'logs'), { recursive: true });

    fs.writeFileSync(path.join(proj, 'manifest.json'), JSON.stringify(fixtureManifest(), null, 2));
    fs.writeFileSync(path.join(proj, 'env.json'), '{}');
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'parent', version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(proj, 'src/child/index.js'), 'module.exports = {};\n');
    fs.writeFileSync(
        path.join(proj, 'src/child/config/settings.json'),
        '// bundle settings\n{\n    "apiKey": "${secret:API_KEY}",\n    "server": { "scheme": "http" }\n}\n'
    );
    fs.writeFileSync(path.join(proj, 'node_modules/somepkg/index.js'), '// must not ride into the context\n');
    fs.writeFileSync(path.join(proj, '.git/HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(proj, 'src/child/node_modules/x.js'), '// nested exclusion probe\n');
    fs.writeFileSync(path.join(proj, 'logs/app.log'), 'old log noise\n');
    try {
        fs.symlinkSync(os.tmpdir(), path.join(proj, 'src/child/link-out'));
    } catch (e) { /* symlink unsupported — the skip assertion degrades gracefully */ }
    return proj;
}

// Runs the REAL bin/gina-init against an isolated GINA_HOMEDIR and returns
// the port maps it wrote.
function runGinaInit(homedir, envOverrides) {
    fs.mkdirSync(homedir, { recursive: true });
    var env = Object.assign({}, process.env, { GINA_HOMEDIR: homedir }, envOverrides);
    delete env.GINA_INIT_CONFIG;
    var r = spawnSync(process.execPath, [GINA_INIT], { env: env, encoding: 'utf8', timeout: 30000 });
    return {
        status       : r.status,
        stdout       : r.stdout || '',
        stderr       : r.stderr || '',
        ports        : JSON.parse(fs.readFileSync(path.join(homedir, 'ports.json'), 'utf8')),
        portsReverse : JSON.parse(fs.readFileSync(path.join(homedir, 'ports.reverse.json'), 'utf8'))
    };
}

describe('35 - image:build — OCI packaging verb (lib/image-build + lib/cmd/image)', function() {

    before(function() {
        fs.mkdirSync(TMP_BASE, { recursive: true });
    });

    after(function() {
        try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    });

    // -- 01. wiring -----------------------------------------------------------

    describe('01 - wiring and registration', function() {

        it('lib/index.js registers imageBuild via _require (hot-reload-safe pure lib)', function() {
            assert.match(libIndex, /imageBuild\s*:\s*_require\('\.\/image-build'\),/);
        });

        it('bin/cli allowedOffline carries the image: group', function() {
            var block = cliSrc.substring(cliSrc.indexOf('allowedOffline = ['), cliSrc.indexOf('allowedOffline = [') + 700);
            assert.ok(block.indexOf("'image:',") > -1, "expected 'image:' in the allowedOffline array");
        });

        it('arguments.json whitelists exactly the image:build flag set', function() {
            assert.deepEqual(argsArr, [
                '--env', '--scope', '--emit', '--format', '--stream',
                '--tag', '--platform', '--start-port-from', '--gina-version'
            ]);
        });

        it('the lib mini-package resolves via "main": "src/main"', function() {
            var pkg = JSON.parse(fs.readFileSync(LIB_PKG, 'utf8'));
            assert.equal(pkg.main, 'src/main');
        });

        it('help.txt documents build, --emit, --format=json, --stream and the host precedence', function() {
            assert.ok(helpTxt.indexOf('image:build') > -1 || helpTxt.indexOf('build ') > -1);
            assert.ok(helpTxt.indexOf('--emit') > -1);
            assert.ok(helpTxt.indexOf('--format=json') > -1);
            assert.ok(helpTxt.indexOf('--stream') > -1);
            assert.ok(helpTxt.indexOf('GINA_CONTAINER_HOST') > -1);
            assert.ok(helpTxt.indexOf('container.host') > -1);
        });

        it('the handler consumes the lib through the registry (never a bare require)', function() {
            assert.match(handlerSrc, /var imageBuild = lib\.imageBuild;/);
            assert.doesNotMatch(handlerSrc, /require\(['"]lib\/image-build/);
        });
    });

    // -- 02. allocator replica vs the REAL bin/gina-init ----------------------

    describe('02 - computePorts is byte-equivalent to the bin/gina-init allocator', function() {

        it('default protocols/schemes, two bundles, two envs, custom port base', function() {
            var home = path.join(TMP_BASE, 'init-home-1');
            var real = runGinaInit(home, {
                GINA_PROJECT_NAME : 'parent',
                GINA_BUNDLES      : 'child,extra',
                GINA_ENVS         : 'dev,prod',
                GINA_DEF_ENV      : 'dev',
                GINA_PORT_START   : '4200'
            });
            assert.equal(real.status, 0, 'gina-init failed: ' + real.stdout + real.stderr);

            var replica = imageBuild.computePorts({
                projectName : 'parent',
                protocols   : ['http/1.1', 'http/2.0'],
                schemes     : ['http', 'https'],
                bundles     : ['child', 'extra'],
                envs        : ['dev', 'prod'],
                portStart   : 4200
            });
            assert.deepEqual(replica.ports, real.ports);
            assert.deepEqual(replica.portsReverse, real.portsReverse);
        });

        it('narrowed protocol/scheme lists and three envs', function() {
            var home = path.join(TMP_BASE, 'init-home-2');
            var real = runGinaInit(home, {
                GINA_PROJECT_NAME : 'parent',
                GINA_BUNDLES      : 'child',
                GINA_ENVS         : 'dev,staging,prod',
                GINA_DEF_ENV      : 'dev',
                GINA_PROTOCOLS    : 'http/1.1',
                GINA_DEF_PROTOCOL : 'http/1.1',
                GINA_SCHEMES      : 'http',
                GINA_DEF_SCHEME   : 'http',
                GINA_PORT_START   : '5000'
            });
            assert.equal(real.status, 0, 'gina-init failed: ' + real.stdout + real.stderr);

            var replica = imageBuild.computePorts({
                projectName : 'parent',
                protocols   : ['http/1.1'],
                schemes     : ['http'],
                bundles     : ['child'],
                envs        : ['dev', 'staging', 'prod'],
                portStart   : 5000
            });
            assert.deepEqual(replica.ports, real.ports);
            assert.deepEqual(replica.portsReverse, real.portsReverse);
        });

        it('h2c (http/2.0 + http) is never allocated — the skip mirrors gina-init', function() {
            var maps = imageBuild.computePorts({
                projectName : 'parent',
                protocols   : ['http/1.1', 'http/2.0'],
                schemes     : ['http', 'https'],
                bundles     : ['child'],
                envs        : ['dev', 'prod'],
                portStart   : 3100
            });
            assert.deepEqual(maps.ports['http/2.0'].http, {});
            assert.equal(typeof maps.portsReverse['child@parent'].dev['http/2.0'].http, 'undefined');
        });
    });

    // -- 03. resolveBuildPlan matrix -------------------------------------------

    describe('03 - resolveBuildPlan — inference and error matrix', function() {

        it('single-bundle project infers the bundle; prod inferred as the sole non-dev env', function() {
            var plan = imageBuild.resolveBuildPlan(planInput());
            assert.equal(plan.bundleName, 'child');
            assert.equal(plan.env, 'prod');
            assert.equal(plan.devEnv, 'dev');
            assert.equal(plan.scope, 'production');   // production_scope for a non-dev env
            assert.equal(plan.needsRelease, true);
            assert.equal(plan.exposedPort, 3101);     // http/1.1+http: dev=3100, prod=3101
            assert.equal(plan.ginaVersion, '9.9.9');
            assert.equal(plan.baseImage, 'node:22-slim');
            assert.equal(plan.tag, 'parent/child:prod');
            assert.equal(plan.bundleSrc, 'src/child');
        });

        it('dev env selects the default scope and needs no release tree', function() {
            var plan = imageBuild.resolveBuildPlan(planInput({ env: 'dev' }));
            assert.equal(plan.scope, 'local');
            assert.equal(plan.needsRelease, false);
            assert.equal(plan.exposedPort, 3100);
        });

        it('multi-bundle project without a bundle arg throws, listing the bundles', function() {
            var manifest = fixtureManifest();
            manifest.bundles.extra = { version: '1.0.0', src: 'src/extra' };
            assert.throws(function() {
                imageBuild.resolveBuildPlan(planInput({ manifest: manifest }));
            }, /several bundles \(child, extra\)/);
        });

        it('unknown bundle / env / scope / platform each throw with the valid set named', function() {
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ bundleName: 'ghost' })); }, /not found .* \(available: child\)/);
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ env: 'staging' })); }, /envs \(dev, prod\)/);
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ scope: 'beta' })); }, /scopes \(local, production\)/);
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ platform: 'windows/amd64' })); }, /--platform must be linux\/arm64 or linux\/amd64/);
        });

        it('three envs with no flag is ambiguous and says so', function() {
            var entry = fixtureProjectEntry();
            entry.envs = ['dev', 'staging', 'prod'];
            assert.throws(function() {
                imageBuild.resolveBuildPlan(planInput({ projectEntry: entry }));
            }, /cannot infer the target env .* pass --env/);
        });

        it('an h2c default protocol/scheme pair is rejected (never allocated)', function() {
            var entry = fixtureProjectEntry();
            entry.def_protocol = 'http/2.0';
            entry.def_scheme   = 'http';
            assert.throws(function() {
                imageBuild.resolveBuildPlan(planInput({ projectEntry: entry }));
            }, /HTTP\/2 cleartext is never allocated/);
        });

        it('gina version: prerelease pins pass, an unresolvable pin names --gina-version', function() {
            var plan = imageBuild.resolveBuildPlan(planInput({ ginaVersion: '0.5.11-alpha.2' }));
            assert.equal(plan.ginaVersion, '0.5.11-alpha.2');
            var entry = fixtureProjectEntry();
            delete entry.framework;
            assert.throws(function() {
                imageBuild.resolveBuildPlan(planInput({ projectEntry: entry }));
            }, /pass --gina-version/);
        });

        it('tag override is validated; a broken reference throws', function() {
            var plan = imageBuild.resolveBuildPlan(planInput({ tag: 'registry.example/team/app:1.2.3' }));
            assert.equal(plan.tag, 'registry.example/team/app:1.2.3');
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ tag: 'UPPER/bad' })); }, /invalid image reference/);
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ tag: 'a//b' })); }, /invalid image reference/);
        });

        it('--start-port-from is range-checked', function() {
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ portStart: '0' })); }, /between 1 and 65534/);
            assert.throws(function() { imageBuild.resolveBuildPlan(planInput({ portStart: 'abc' })); }, /between 1 and 65534/);
            var plan = imageBuild.resolveBuildPlan(planInput({ portStart: '9700' }));
            assert.equal(plan.exposedPort, 9701);
        });
    });

    // -- 04. Containerfile synthesis --------------------------------------------

    describe('04 - renderContainerfile — the synthesized OCI artifact', function() {

        it('non-dev env: base from the engine floor, framework pin, release build, EXPOSE, entrypoint contract', function() {
            var plan = imageBuild.resolveBuildPlan(planInput());
            var cf   = imageBuild.renderContainerfile(plan);
            assert.ok(cf.indexOf('FROM node:22-slim') > -1);
            assert.ok(cf.indexOf('RUN npm install -g gina@9.9.9 --unsafe-perm && chown -R node:node $HOME /app') > -1,
                'the framework postinstall seeds $HOME/.gina root-owned and WORKDIR creates /app root-owned — both must be handed back before USER node');
            assert.ok(cf.indexOf('GINA_DEF_ENV=prod') > -1);
            assert.ok(cf.indexOf('GINA_DEV_ENV=dev') > -1, 'GINA_DEV_ENV must stay the real dev env so NODE_ENV_IS_DEV is false in-container');
            assert.ok(cf.indexOf('RUN gina-init && gina bundle:build child @parent --env=prod --scope=production') > -1);
            assert.ok(cf.indexOf('EXPOSE 3101') > -1);
            assert.ok(cf.indexOf('ENTRYPOINT ["/app/gina-entrypoint.sh"]') > -1);
            assert.ok(cf.indexOf('CMD ["child", "@parent"]') > -1);
            assert.ok(cf.indexOf('USER node') > -1);
            assert.ok(cf.indexOf('RUN mkdir -p node_modules && ln -sfn /usr/local/lib/node_modules/gina node_modules/gina') > -1,
                'the bundle entry requires gina via node_modules — the global install must be linked (after any npm install, which prunes stray symlinks)');
        });

        it('dev env: boots from src — no in-image release build', function() {
            var plan = imageBuild.resolveBuildPlan(planInput({ env: 'dev' }));
            var cf   = imageBuild.renderContainerfile(plan);
            assert.ok(cf.indexOf('bundle:build') < 0, 'a dev-env image must not run bundle:build');
            assert.ok(cf.indexOf('EXPOSE 3100') > -1);
        });

        it('dependency install branches on lockfile presence, and is omitted without dependencies', function() {
            var none = imageBuild.renderContainerfile(imageBuild.resolveBuildPlan(planInput()));
            assert.ok(none.indexOf('npm ci') < 0 && none.indexOf('--omit=dev') < 0);
            var ci = imageBuild.renderContainerfile(imageBuild.resolveBuildPlan(planInput({ hasDependencies: true, hasLockfile: true })));
            assert.ok(ci.indexOf('RUN npm ci --omit=dev') > -1);
            var inst = imageBuild.renderContainerfile(imageBuild.resolveBuildPlan(planInput({ hasDependencies: true, hasLockfile: false })));
            assert.ok(inst.indexOf('RUN npm install --omit=dev') > -1);
        });

        it('the engine floor drives the base image', function() {
            assert.equal(imageBuild.parseNodeFloor('>= 22 <27'), 22);
            assert.equal(imageBuild.parseNodeFloor('>=24'), 24);
            assert.equal(imageBuild.parseNodeFloor(undefined), 22);
            var plan = imageBuild.resolveBuildPlan(planInput({ nodeEngine: '>= 24 <27' }));
            assert.equal(plan.baseImage, 'node:24-slim');
        });
    });

    // -- 05. secrets never baked ---------------------------------------------------

    describe('05 - ${secret:KEY} references are never resolved or baked', function() {

        it('a resolved env value never reaches the staged context or the Containerfile', function() {
            var proj = writeFixtureProject(path.join(TMP_BASE, 'secrets'));
            var entry = fixtureProjectEntry(); entry.path = proj;
            var plan = imageBuild.resolveBuildPlan(planInput({ projectEntry: entry }));

            var prev = process.env.API_KEY;
            process.env.API_KEY = 'sekret-value-123';
            try {
                var staging = path.join(TMP_BASE, 'secrets-staging');
                imageBuild.stageContext(plan, proj, staging);

                var srcBytes    = fs.readFileSync(path.join(proj, 'src/child/config/settings.json'));
                var stagedBytes = fs.readFileSync(path.join(staging, 'src/child/config/settings.json'));
                assert.ok(srcBytes.equals(stagedBytes), 'config must be copied byte-verbatim');
                assert.ok(stagedBytes.toString().indexOf('${secret:API_KEY}') > -1, 'the placeholder must survive as a literal reference');
                assert.ok(stagedBytes.toString().indexOf('sekret-value-123') < 0, 'the resolved value must never appear in the staged context');

                var cf = fs.readFileSync(path.join(staging, 'Containerfile'), 'utf8');
                assert.ok(cf.indexOf('sekret-value-123') < 0, 'the resolved value must never appear in the Containerfile');
                assert.doesNotMatch(cf, /ENV\s+API_KEY/, 'no ENV line may bake the secret key');
            } finally {
                if (typeof prev === 'undefined') { delete process.env.API_KEY; } else { process.env.API_KEY = prev; }
            }
        });

        it('negative pins — neither the lib nor the handler touches the secrets resolver', function() {
            assert.doesNotMatch(libSrc, /lib\.secrets/);
            assert.doesNotMatch(libSrc, /secrets\.resolve/);
            assert.doesNotMatch(handlerSrc, /lib\.secrets/);
            assert.doesNotMatch(handlerSrc, /secrets\.resolve/);
        });

        it('purity pins — the lib reads no process.env and spawns nothing', function() {
            assert.doesNotMatch(libSrc, /process\.env/);
            assert.doesNotMatch(libSrc, /child_process/);
        });
    });

    // -- 06. context staging ---------------------------------------------------------

    describe('06 - build-context staging and listing', function() {

        var proj, plan, staging, staged;

        before(function() {
            proj = writeFixtureProject(path.join(TMP_BASE, 'staging'));
            var entry = fixtureProjectEntry(); entry.path = proj;
            plan    = imageBuild.resolveBuildPlan(planInput({ projectEntry: entry }));
            staging = path.join(TMP_BASE, 'staging-out');
            staged  = imageBuild.stageContext(plan, proj, staging);
        });

        it('stages the allowlist: portable root files + the bundle source + synthesized files', function() {
            assert.ok(staged.files.indexOf('manifest.json') > -1);
            assert.ok(staged.files.indexOf('env.json') > -1);
            assert.ok(staged.files.indexOf('package.json') > -1);
            assert.ok(staged.files.indexOf('src/child/index.js') > -1);
            assert.ok(staged.files.indexOf('src/child/config/settings.json') > -1);
            assert.ok(staged.files.indexOf('Containerfile') > -1);
            assert.ok(staged.files.indexOf('gina-entrypoint.sh') > -1);
        });

        it('excludes node_modules, VCS state, logs and symlinks at any depth', function() {
            var joined = staged.files.join('\n');
            assert.ok(joined.indexOf('node_modules') < 0, 'node_modules must never ride into the context');
            assert.ok(joined.indexOf('.git') < 0);
            assert.ok(joined.indexOf('logs/') < 0);
            assert.ok(joined.indexOf('link-out') < 0, 'symlinks are skipped — a context must be self-contained');
            assert.ok(!fs.existsSync(path.join(staging, 'node_modules')));
        });

        it('the entrypoint is staged executable', function() {
            var mode = fs.statSync(path.join(staging, 'gina-entrypoint.sh')).mode;
            assert.equal(mode & 493, 493, 'gina-entrypoint.sh must be 0755'); // 493 === 0755
        });

        it('listContext (--emit view) matches the staged manifest without staging anything', function() {
            var listed = imageBuild.listContext(plan, proj);
            assert.deepEqual(listed, staged.files);
        });
    });

    // -- 07. container-host descriptor -------------------------------------------------

    describe('07 - descriptor parse + resolution precedence', function() {

        it('parses ssh://[user@]host[:port] with defaults', function() {
            assert.deepEqual(
                imageBuild.parseSshDescriptor('ssh://build@10.0.0.5:2222'),
                { user: 'build', host: '10.0.0.5', port: 2222, sshTarget: 'build@10.0.0.5' }
            );
            assert.deepEqual(
                imageBuild.parseSshDescriptor('ssh://lin'),
                { user: null, host: 'lin', port: null, sshTarget: 'lin' },
                'a bare ssh://host carries NO port — the user ssh config decides (host aliases define their own Port/ProxyCommand)'
            );
            assert.equal(imageBuild.parseSshDescriptor('ssh://lin/').host, 'lin');
        });

        it('rejects malformed descriptors and out-of-range ports', function() {
            assert.throws(function() { imageBuild.parseSshDescriptor('lin'); }, /expected ssh:/);
            assert.throws(function() { imageBuild.parseSshDescriptor('http://lin'); }, /expected ssh:/);
            assert.throws(function() { imageBuild.parseSshDescriptor('ssh://a b'); }, /expected ssh:/);
            assert.throws(function() { imageBuild.parseSshDescriptor('ssh://lin:99999'); }, /invalid container-host port/);
        });

        it('precedence: env override wins even over native buildah', function() {
            var r = imageBuild.resolveContainerHost({ envValue: 'ssh://u@h', platform: 'linux', hasBuildah: true });
            assert.equal(r.mode, 'ssh');
            assert.equal(r.source, 'env');
        });

        it('native when Linux has buildah on PATH and no override is set', function() {
            var r = imageBuild.resolveContainerHost({ platform: 'linux', hasBuildah: true });
            assert.equal(r.mode, 'native');
        });

        it('settings fallback engages when the machine cannot build natively', function() {
            var r = imageBuild.resolveContainerHost({ platform: 'darwin', hasBuildah: false, settingsValue: 'ssh://build@lin:2222' });
            assert.equal(r.mode, 'ssh');
            assert.equal(r.source, 'settings');
            assert.equal(r.parsed.port, 2222);
        });

        it('nothing available → an actionable error naming both surfaces', function() {
            var r = imageBuild.resolveContainerHost({ platform: 'darwin', hasBuildah: false });
            assert.equal(r.mode, 'error');
            assert.ok(r.reason.indexOf('GINA_CONTAINER_HOST') > -1);
            assert.ok(r.reason.indexOf('settings.json') > -1);
        });

        it('a PRESENT but malformed descriptor throws instead of falling through', function() {
            assert.throws(function() {
                imageBuild.resolveContainerHost({ envValue: 'lin', platform: 'darwin', hasBuildah: false });
            }, /expected ssh:/);
        });
    });

    // -- 08. handler source pins -----------------------------------------------------

    describe('08 - lib/cmd/image/build.js — output contract pins', function() {

        it('NDJSON frames are written with synchronous fs.writeSync (pipe-flush discipline)', function() {
            assert.ok(handlerSrc.indexOf("fs.writeSync(1, JSON.stringify(frame) + '\\n')") > -1);
        });

        it('the frame vocabulary is start / step / log / done / error', function() {
            assert.match(handlerSrc, /type\s*:\s*'start'/);
            assert.match(handlerSrc, /type\s*:\s*'step'/);
            assert.match(handlerSrc, /type\s*:\s*'log'/);
            assert.ok(handlerSrc.indexOf("oneShot.type = 'done'") > -1);
            assert.match(handlerSrc, /type\s*:\s*'error'/);
        });

        it('failures put the reason on stdout and exit 1 (error frame in stream mode)', function() {
            var failIdx = handlerSrc.indexOf('var fail = function (reason)');
            assert.ok(failIdx > -1);
            var block = handlerSrc.substring(failIdx, failIdx + 400);
            assert.ok(block.indexOf("emitFrame({ type: 'error', error: { message: reason } })") > -1);
            assert.ok(block.indexOf('console.error(reason)') > -1);
            assert.ok(block.indexOf('process.exit(1)') > -1);
        });

        it('the remote path streams a tar into a remote temp dir (buildah takes only a directory context)', function() {
            assert.ok(handlerSrc.indexOf('tar -xf - -C "$D"') > -1);
            assert.ok(handlerSrc.indexOf('--iidfile') > -1);
            assert.ok(handlerSrc.indexOf('--format oci') > -1);
            assert.ok(handlerSrc.indexOf('__GINA_IID__') > -1);
            assert.ok(handlerSrc.indexOf("spawn('tar', ['-cf', '-', '-C', stagingDir, '.'])") > -1);
        });

        it('the env override is read via getEnvVar (the bootstrap sweeps GINA_* off process.env)', function() {
            assert.ok(handlerSrc.indexOf("getEnvVar('GINA_CONTAINER_HOST')") > -1,
                'the CLI bootstrap moves GINA_* OS env vars onto process.gina and deletes them from process.env — a bare process.env read never sees the override');
        });

        it('ssh runs non-interactive with a connect deadline; -p only for an explicit descriptor port', function() {
            assert.ok(handlerSrc.indexOf("'BatchMode=yes'") > -1);
            assert.ok(handlerSrc.indexOf("'ConnectTimeout=10'") > -1);
            assert.ok(handlerSrc.indexOf('if (host.parsed.port)') > -1,
                'forcing -p 22 on a port-less descriptor overrides the user ssh config (host aliases with their own Port/ProxyCommand)');
        });

        it('native execution spawns buildah with the staged Containerfile and context dir', function() {
            assert.ok(handlerSrc.indexOf("spawn('buildah', args)") > -1);
            assert.match(handlerSrc, /'build',\s*'--format',\s*'oci',\s*'-f'/);
        });

        it('the missing-emulation failure is mapped to an actionable reason', function() {
            assert.ok(handlerSrc.indexOf('exec format error') > -1);
            assert.ok(handlerSrc.indexOf('qemu') > -1);
        });

        it('a done result carries the one-shot shape via buildOneShot', function() {
            assert.ok(handlerSrc.indexOf('imageBuild.buildOneShot(plan') > -1);
            var oneShot = imageBuild.buildOneShot(
                imageBuild.resolveBuildPlan(planInput()),
                { imageId: 'sha256:abc', durationMs: 1234, host: 'native' }
            );
            assert.deepEqual(Object.keys(oneShot).sort(), ['bundle', 'durationMs', 'exposedPort', 'host', 'image', 'imageId', 'project', 'tag']);
        });
    });
});
