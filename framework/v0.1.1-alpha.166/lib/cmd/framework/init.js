var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var e               = new EventEmitter();
const { execSync }  = require('child_process');
const { arch }      = require('os');
var util            = require('util');
var promisify       = util.promisify;

var console         = lib.logger;
var Domain          = lib.Domain;
var ginaPath        = getPath('gina').root;
var help            = require(ginaPath + '/utils/helper');
// var helpers         = require(getPath('gina').helpers, true);


var aliases = require( getPath('gina').lib + '/cmd/aliases.json' );

function Initialize(opt) {

    var self = {};
    var init = function(opt) {
        self.opt = opt;
        begin()
    }


    /**
     * Bebin Checking - Will run checking tasks in order of declaration
     * */
    // var begin = function() {
    //     var i = 0;
    //     var funcs = [];
    //     for (var t in self) {
    //         if( typeof(self[t]) == 'function') {
    //             var func = 'self.' + t + '()';
    //             console.debug('Running [ ' + func + ' ]');
    //             eval(func);// jshint ignore:line
    //             ++i
    //         }

    //         if ( i == self.functionCount() ) {
    //             e.emit('init#complete', false, run, self.opt);
    //             break
    //         }
    //     }
    // }

    var begin = async function(i) {
        i = (typeof(i) == 'undefined') ? 0 : i;
        //console.debug('i is ', i);
        var n = 0, funct = null, functName = null;
        for (let t in self) {
            if ( typeof(self[t]) == 'function') {
                if (n == i) {
                    //let func = 'self.' + t + '()';
                    let func = 'self.' + t;
                    console.debug('Running [ ' + func + '() ]');
                    funct       = func;
                    functName   = t;
                    break;
                }
                n++;
            }
        }

        // to handle sync vs async to allow execution in order of declaration
        if (funct) {
            eval('async function on'+functName+'(){ await promisify('+ funct + ')().catch(function(e){ console.error(e.toString()); process.exit(1);}).then(function(){ begin('+(i+1)+')});}; on'+functName+'();'); // jshint ignore:line
        } else if ( i == self.functionCount() ) {
            e.emit('init#complete', false, run, self.opt);
        }
    }


    var checkForAliases = function(task) {
        try {
            var aliasArr = aliases[task.topic].toArray();
            if (
                typeof(aliases) != 'undefined' &&
                typeof(aliases[task.topic]) &&
                task.action in aliasArr

            ) {
                task.action = aliasArr[task.action]
            }
        } catch (err) {}

        return task
    }

    var run = function(opt, cmd) {
        opt.task = checkForAliases(opt.task);
        var filename ='/cmd/' + opt.task.topic + '/' + opt.task.action + '.js'
        var path = getPath('gina').lib + filename;

        try {
            if ( GINA_ENV_IS_DEV || GINA_SCOPE_IS_LOCAL)
                delete require.cache[require.resolve(path)];
            require(path)(opt, cmd)
        } catch(err) {
            console.crit('Gina has some troubles with command [ ', process.argv.join(' ') + ' ]\n' + err.stack);
            if (opt.client) {
                opt.client.write('Gina has some troubles with command [ ', process.argv.join(' ') + ' ]\n' + err.stack);
            }
            process.exit(1);
        }
    }

    self.checkIfHome = function(done) {
        var path = self.opt.homedir;
        console.debug('Checking home... [ '+ path +' ]');

        if ( !getEnvVar('GINA_HOMEDIR') ) {
            setEnvVar('GINA_HOMEDIR', path)
        } else {
            path = self.opt.homedir = getEnvVar('GINA_HOMEDIR')
        }

        if ( !fs.existsSync(path) ) {
            try {
                fs.mkdirSync(path, 0775)
            } catch (err) {
                // console.error(err.stack);
                // process.exit(1)
                return done(err)
            }
        }

        done()
    }


    self.checkIfVersionDir = function(done) {

        var version = require(self.opt.pack).version;

        if ( !getEnvVar('GINA_VERSION') ) {
            setEnvVar('GINA_VERSION', version)
        } else {
            version = getEnvVar('GINA_VERSION')
        }

        if ( !getEnvVar('GINA_SHORT_VERSION') ) {
            var shortVersion = version.split('.');
            shortVersion.splice(2);
            shortVersion = shortVersion.join('.');
            setEnvVar('GINA_SHORT_VERSION', shortVersion);
        }


        var release = version.split('.').splice(0,2).join(".");
        setEnvVar('GINA_RELEASE', release, true);
        var releasePath = self.opt.homedir + '/' + release;
        self.release = self.opt.release = release;

        console.debug('Checking version path... [ '+ releasePath +' ]');

        if ( !fs.existsSync(releasePath) ) {
            try {
                fs.mkdirSync(releasePath, 0775)
            } catch (err) {
                // console.error(err.stack);
                // process.exit(1)
                return done(err)
            }
        }
        done()
    }

    self.checkIfMain = function(done) {
        console.debug('Checking main...');
        var source      = getPath('gina').root + '/resources/home/main.json';
        var target      = self.opt.homedir + '/main.json';
        var version     = 'v' + getEnvVar('GINA_VERSION');
        var prefix      = getEnvVar('GINA_PREFIX') || execSync('npm config get prefix').toString().replace(/\n$/g, '');
        var globalMode  = getEnvVar('GINA_GLOBAL_MODE');

        var data = require(source);
        var dic = {
            'release' : self.release,
            'version' : version,
            'prefix' : prefix,
            'global_mode': globalMode
        };
        data = whisper(dic, data);


        if ( !fs.existsSync(target) ) {
            try {
                lib.generator.createFileFromDataSync(data, target)
            } catch (err) {
                // console.error(err.stack);
                // process.exit(1)
                return done(err)
            }
        }
        // update if needed : like the version number ...
        var mainConfig  = require(target);
        mainConfig      = whisper(dic, mainConfig);

        // check if new definitions after update
        for (let k in data) {
            if ( typeof(mainConfig[k]) == 'undefined' ) {
                mainConfig[k] = ( typeof(data[k]) == 'object' ) ? JSON.clone(data[k]) : data[k];
            }
        }
        // arch
        mainConfig.archs = merge(mainConfig.archs, data.archs, true);
        // envs
        mainConfig.envs = merge(mainConfig.envs, data.envs, true);
        // scopes
        mainConfig.scopes = merge(mainConfig.scopes, data.scopes, true);

        // updating protocols, schemes, cultures, log_levels
        mainConfig.protocols    = merge(mainConfig.protocols, data.protocols, true);
        mainConfig.schemes      = merge(mainConfig.schemes, data.schemes, true);
        mainConfig.cultures     = merge(mainConfig.cultures||{}, data.cultures, true);
        mainConfig.log_levels   = merge(mainConfig.log_levels||{}, data.log_levels, true);


        // don't remove def_protocol
        var defProtocol     = (mainConfig['def_protocol']) ? mainConfig['def_protocol'][self.release] : data.def_protocol[self.release];
        var defScheme       = (mainConfig['def_scheme']) ? mainConfig['def_scheme'][self.release] : data.def_scheme[self.release];
        var defCulture      = (mainConfig['def_culture']) ? mainConfig['def_culture'][self.release] : data.def_culture[self.release];
        var defTimezone     = (mainConfig['def_timezone']) ? mainConfig['def_timezone'][self.release] : data.def_timezone[self.release];
        var defLogLevel     = (mainConfig['def_log_level']) ? mainConfig['def_log_level'][self.release] : data.def_log_level[self.release];
        var defPrefix       = (mainConfig['def_prefix']) ? mainConfig['def_prefix'][self.release] : data.def_prefix[self.release];
        var defGlobalMode   = (mainConfig['def_global_mode']) ? mainConfig['def_global_mode'][self.release] : data.def_global_mode[self.release];


        if ( mainConfig.protocols[self.release].indexOf(defProtocol) < 0 )
            mainConfig.protocols[self.release].push(defProtocol);

        if ( mainConfig.schemes[self.release].indexOf(defScheme) < 0 )
            mainConfig.schemes[self.release].push(defScheme);

        if ( mainConfig.cultures[self.release].indexOf(defCulture) < 0 )
            mainConfig.cultures[self.release].push(defCulture);


        // Update only when needed
        if (!mainConfig.def_culture)
            mainConfig.def_culture = data.def_culture;

        if (!mainConfig.def_timezone)
            mainConfig.def_timezone = data.def_timezone;

        if (!mainConfig.def_log_level)
            mainConfig.def_log_level = data.def_log_level;

        if (!mainConfig.def_prefix)
            mainConfig.def_prefix = data.def_prefix;

        if (!mainConfig.def_global_mode)
            mainConfig.def_global_mode = data.def_global_mode;

        mainConfig.protocols[self.release].sort();
        mainConfig.schemes[self.release].sort();
        mainConfig.cultures[self.release].sort();

        // commit
        lib.generator.createFileFromDataSync(mainConfig, target);

        process.env.TZ = defTimezone;
        process.env.LOG_LEVEL = defLogLevel;

        setEnvVar('GINA_CULTURES', mainConfig.cultures[self.release]);
        setEnvVar('GINA_CULTURE', defCulture);
        setEnvVar('GINA_TIMEZONE', defTimezone);
        // Attenion: remove this part in case of troubles
        setEnvVar('GINA_PREFIX', defPrefix);
        setEnvVar('GINA_GLOBAL_MODE', defGlobalMode);

        done()
    }

    /**
     * Check arch
     *
     * */
    self.checkArch = function(done) {

        var currentArch = process.arch;
        var currentPlatform = process.platform;
        // ignored for framework:set
        var mainConfig = require( self.opt.homedir + '/main.json' );
        var defaultMainConfig = requireJSON( getPath('gina').root + '/resources/home/main.json' );
        //has registered arch ?
        var arch        = getEnvVar('GINA_ARCH') || mainConfig['def_arch'][self.release] || null; // arch by default
        if ( typeof(mainConfig.archs) == 'undefined' ) {
            mainConfig.archs = {};
            mainConfig.archs[self.release] = defaultMainConfig.archs['{release}'];
            mainConfig['def_arch'] = {}
            mainConfig['def_arch'][self.release] = currentArch;
            isUpdateNeeded = true;
        }
        if ( mainConfig.archs[self.release].indexOf(arch) < 0 ) {
            console.error('Arch [ ' + arch + ' ] not registered. Gina is not support your architecture `'+ process.arch +'` at this moment.');
            process.exit(1);
        }
        var platform    = getEnvVar('GINA_PLATFORM') || mainConfig['def_platform'][self.release] || null; // arch by default
        if ( typeof(mainConfig.platforms) == 'undefined' ) {
            mainConfig.platforms = {};
            mainConfig.platforms[self.release] = defaultMainConfig.platforms['{release}'];
            mainConfig['def_platform'] = {}
            mainConfig['def_platform'][self.release] = currentPlatform;
            isUpdateNeeded = true;
        }
        if ( mainConfig.platforms[self.release].indexOf(platform) < 0 ) {
            console.error('Platform [ ' + platform + ' ] not registered. Gina is not support your platform `'+ process.platform +'` at this moment.');
            process.exit(1);
        }
        var isUpdateNeeded = false;
        if (arch != currentArch) {
            // updating arch
            arch = currentArch;
            if ( mainConfig.archs[self.release].indexOf(arch) < 0 ) {
                console.error('Arch [ ' + arch + ' ] not registered. Gina is not support your architecture `'+ process.arch +'` at this moment.');
                process.exit(1);
            }

            isUpdateNeeded = true;
            mainConfig['def_arch'][self.release] = arch;
        }
        if (platform != currentPlatform) {
            // updating platform
            platform = currentPlatform;
            if ( mainConfig.platforms[self.release].indexOf(platform) < 0 ) {
                console.error('Platform [ ' + arch + ' ] not registered. Gina is not support your platform `'+ process.platform +'` at this moment.');
                process.exit(1);
            }

            isUpdateNeeded = true;
            mainConfig['def_platform'][self.release] = platform;
        }


        // has arch & platform ?
        if (
            isUpdateNeeded
            ||
            typeof(mainConfig['def_arch']) == 'undefined'
            ||
            typeof(mainConfig['def_platform']) == 'undefined'
            ||
            typeof(mainConfig['def_arch']) != 'undefined'
            && typeof(mainConfig['def_arch'][self.release]) != 'undefined'
            && mainConfig.archs[self.release].indexOf(mainConfig['def_arch'][self.release]) < 0
            ||
            typeof(mainConfig['def_platform']) != 'undefined'
            && typeof(mainConfig['def_platform'][self.release]) != 'undefined'
            && mainConfig.platforms[self.release].indexOf(mainConfig['def_platform'][self.release]) < 0
        ) {
            var target = _(self.opt.homedir +'/main.json');
            lib.generator.createFileFromDataSync(
                mainConfig,
                target
            )
        }

        // TODO - Scanning project

        done()
    }

    /**
     * Checking ports
     *
     **/
    self.checkIfPorts = function(done) {
        console.debug('Checking ports...');
        var mainConfig  = require(self.opt.homedir + '/main.json');
        var target = _(self.opt.homedir +'/ports.json');

        if ( !fs.existsSync(target)) {

            var protocols   = mainConfig.protocols[self.release]
                , schemes   = mainConfig.schemes[self.release]
                , ports     = {};

            for (let p = 0, pLen = protocols.length; p < pLen; ++p) {
                ports[protocols[p]] = {};
                for (let s = 0, sLen = schemes.length; s < sLen; ++s) {
                    ports[protocols[p]][schemes[s]] = {}
                }
            }
            lib.generator.createFileFromDataSync(
                ports,
                target
            )
        }

        done()
    }

    /**
     * Checking ports.reverse
     *
     **/
    self.checkIfPortsReverse = function(done) {
        console.debug('Checking ports.reverse...');
        var target = _(self.opt.homedir +'/ports.reverse.json');

        if ( !fs.existsSync(target) ) {
            lib.generator.createFileFromDataSync(
                {},
                target
            )
        }

        done()
    }


    /**
     * Check env
     *
     * */
    self.checkEnv = function(done) {
        // ignored for framework:set
        //if (self.opt.task.Action != 'set' && self.opt.task.topic != 'framework') {
        var err     = null;
        var main    = require( self.opt.homedir + '/main.json' );
        //has registered env ?
        var env     = getEnvVar('GINA_ENV') || main['dev_env'][self.release]; // dev by default

        if ( main.envs[self.release].indexOf(env) < 0 ) {
            // console.error('Environment [ ' + env + ' ] not registered. See [ man gina-env ].');
            // process.exit(1)
            err = new Error('Environment [ ' + env + ' ] not registered. See [ man gina-env ].');
            return done(err)
        }

        // has dev env ?
        if (
            typeof(main['dev_env']) == 'undefined' ||
            typeof(main['dev_env']) != 'undefined' &&
            typeof(main['dev_env'][self.release]) != 'undefined' &&
            main.envs[self.release].indexOf(main['dev_env'][self.release]) < 0
        ) {
            err = new Error('the framework has no dev env linked to any' +
                            'environment to gina\'s.\nUse: $ gina env:link-dev <your_new_dev_env>');

            // process.exit(1)
            return done(err)
        }

        done()
    }

    /**
     * Check scope
     *
     * */
    self.checkScope = function(done) {
        // ignored for framework:set
        var err     = null;
        var main    = require( self.opt.homedir + '/main.json' );
        //has registered scope ?
        var scope   = getEnvVar('GINA_SCOPE') || main['local_scope'][self.release]; // scope by default
        if ( main.scopes[self.release].indexOf(scope) < 0 ) {
            // console.error('Scope [ ' + scope + ' ] not registered. See [ man gina-scope ].');
            // process.exit(1)
            err = new Error('Scope [ ' + scope + ' ] not registered. See [ man gina-scope ].');
            return done(err)
        }


        // has local scope ?
        if (
            typeof(main['local_scope']) == 'undefined' ||
            typeof(main['local_scope']) != 'undefined' &&
            typeof(main['local_scope'][self.release]) != 'undefined' &&
            main.scopes[self.release].indexOf(main['local_scope'][self.release]) < 0
        ) {
            // console.error('the framework has no local scope linked to any ' +
            //     'scope to gina\'s.\nUse: $ gina scope:link-local <your_new_local_scope>');

            // process.exit(1)
            err = new Error('the framework has no local scope linked to any ' +
                            'scope to gina\'s.\nUse: $ gina scope:link-local <your_new_local_scope>');

            return done(err)
        }

        done()
    }



    /**
     * Checking settings, defining constants
     * Also done during bin/cmd::init() ... so if you change here ...
     **/

    self.checkIfSettings = function(done) {
        console.debug('Checking framework settings...');
        var main            = require( _(self.opt.homedir + '/main.json', true) )
            , version       = getEnvVar('GINA_VERSION')
            , prefix        = getEnvVar('GINA_PREFIX') || main['def_prefix'][self.release]
            , globalMode    = getEnvVar('GINA_GLOBAL_MODE') || main['def_global_mode'][self.release]
            , arch          = getEnvVar('GINA_ARCH') || main['def_arch'][self.release]
            , platform      = getEnvVar('GINA_PLATFORM') || main['def_platform'][self.release]
            , env           = getEnvVar('GINA_ENV') || main['def_env'][self.release]
            , scope         = getEnvVar('GINA_SCOPE') || main['def_scope'][self.release]
            , settings      = requireJSON( _( getPath('gina').root + '/resources/home/settings.json', true ) )
            , userSettings  = {}
            , target        = _(self.opt.homedir +'/'+ self.release +'/settings.json', true)
        ;

        // case of port & debug_port updated
        var targetObj = new _(target);
        var localUserSettings = null;
        if ( targetObj.existsSync() ) {
            localUserSettings = requireJSON(target);
        } else {
            localUserSettings = JSON.clone(settings);
        }

        if ( !getEnvVar('GINA_PORT') && targetObj.existsSync() ) {
            if ( typeof(localUserSettings.port) != 'undefined' ) {
                setEnvVar('GINA_PORT', ~~localUserSettings.port);
            }
        }
        if ( !getEnvVar('GINA_DEBUG_PORT') && targetObj.existsSync() ) {
            if ( typeof(localUserSettings.debug_port) != 'undefined' ) {
                setEnvVar('GINA_DEBUG_PORT', ~~localUserSettings.debug_port);
            }
        }
        if ( !getEnvVar('GINA_MQ_PORT') && targetObj.existsSync() ) {
            if ( typeof(localUserSettings.mq_port) != 'undefined' ) {
                setEnvVar('GINA_MQ_PORT', ~~localUserSettings.mq_port);
            }
        }
        if ( !getEnvVar('GINA_HOST_V4') && targetObj.existsSync() ) {
            if ( typeof(localUserSettings.host_v4) != 'undefined' ) {
                setEnvVar('GINA_HOST_V4', localUserSettings.host_v4);
            }
        }
        if ( !getEnvVar('GINA_HOSTNAME') && targetObj.existsSync() ) {
            if ( typeof(localUserSettings.hostname) != 'undefined' ) {
                setEnvVar('GINA_HOSTNAME', localUserSettings.hostname);
            }
        }


        // updated on framework start : you never know which user is going to start gina (root ? sudo ? regular user)
        // user settings override is passed through argv while using `gina framework:set` : —-logdir=value  —-tmpdir=value —-rundir=value —-homedir=value

        var uid     = process.getuid()
            , gid   = process.getgid();

        try {

            /**
             * Before updateing here, if you have new settings,
             * make sure to complete : self.checkIfMain()
             */

            var dic = {
                'prefix' : prefix,
                'global_mode': globalMode,
                'version' : version,
                'arch' : arch,
                'platform': platform,
                'env' : env,
                'env_is_dev' : (main['dev_env'][self.release] == env) ? true : false,
                'dev_env' : main['dev_env'][self.release],
                'scope' : scope,
                'scope_is_local' : (main['local_scope'][self.release] == scope) ? true : false,
                'local_scope': main['local_scope'][self.release],
                'culture' : getEnvVar('GINA_CULTURE'),
                'timezone' : getEnvVar('GINA_TIMEZONE'),
                'node_version': process.version,
                'port' : getEnvVar('GINA_PORT') || 8124, // TODO - scan for the next available port
                'debug_port' : getEnvVar('GINA_DEBUG_PORT') || process.debugPort || 5757,
                'host_v4' : getEnvVar('GINA_HOST_V4') || '127.0.0.1',
                'mq_port' : getEnvVar('GINA_MQ_PORT') || 8125,
                'hostname' : getEnvVar('GINA_HOSTNAME') || 'localhost',
                'user' : process.env.USER,
                'uid' : uid,
                'gid' : gid,
                'dir': getPath('gina').root,
                'home_dir' : _( getUserHome(), true ),
                'run_dir' : _( getRunDir(), true ),
                'tmp_dir' : _( getTmpDir(), true ),
                'log_dir' : _( getLogDir(), true ),
                'log_level' : getEnvVar('GINA_LOG_LEVEL') || main['def_log_level'][self.release] || 'info'
            };

            settings = whisper(dic, settings);
            settings = merge(userSettings, settings);
            self.settings = settings;

            setEnvVar('GINA_PORT', settings['port']);
            setEnvVar('GINA_DEBUG_PORT', settings['debug_port']);
            // setEnvVar('GINA_MQ_PORT', settings['mq_port']);
            // setEnvVar('GINA_HOST_V4', settings['host_v4']);
            // setEnvVar('GINA_HOSTNAME', settings['hostname']);
            setEnvVar('GINA_ENV_IS_DEV', settings['env_is_dev']);
            setEnvVar('GINA_SCOPE_IS_LOCAL', settings['scope_is_local']);

            console.debug('Framework env is: ', env);

            lib.generator.createFileFromDataSync(
                settings,
                target
            )
        } catch (err) {
            // console.error(err.stack);
            // process.exit(1)
            return done(err)
        }

        done()
    }

    /**
     * Checking projects
     *
     **/
     self.checkIfProjects = function(done) {
        console.debug('Checking projects...');
        var main    = requireJSON( self.opt.homedir + '/main.json' );
        var target  = _(self.opt.homedir +'/projects.json', true);

        if ( !fs.existsSync(target) ) {
            lib.generator.createFileFromDataSync(
                {},
                target
            )
        }

        var projects = requireJSON(target);
        var newProjects = JSON.clone(projects);
        for (let name in projects) {
            let project = projects[name];
            for (let prop in main) {
                if ( typeof(project[prop]) != 'undefined' ) continue;
                //if ( !Array.isArray(main[prop][self.release]) ) continue;

                if ( !newProjects[name][prop] /**&& Array.isArray(main[prop][self.release])*/ ) {
                    newProjects[name][prop] = null;
                }

                try {
                    newProjects[name][prop] = JSON.clone(main[prop][self.release])
                } catch (err) {
                    return done(err)
                }
            }
        }

        //console.debug('----> ', JSON.stringify(newProjects, null, 2));
        lib.generator.createFileFromDataSync(
            newProjects,
            target
        );

        done()
    }

    self.checkDomainLibRequirements = function(done) {
        // check for `public_suffix_list.dat`
        var domainLibPath   = _( getEnvVar('GINA_FRAMEWORK_DIR') + '/lib/domain', true);
        var distPathObj     = new _(domainLibPath + '/dist', true);

        if ( !distPathObj.existsSync() ) {
            distPathObj.mkdirSync();
        }
        console.debug('Checking for PSL file');
        var datFilenameObj = new _(distPathObj.toString() + '/public_suffix_list.dat', true);
        if ( !datFilenameObj.existsSync() ) {
            try {
                new Domain({isCachingRrequired: true}, done);
            } catch (err) {
                // console.error(err.stack||err.message||err);
                // process.exit(1)
                return done(err)
            }
            // new Domain({isCachingRrequired: true}, done);
        }

        done()
    }

    self.checkIfCertificatesDir = function(done) {
        var certsDir = new _( getEnvVar('GINA_HOMEDIR') + '/certificates', true);
        var theRSARootCertsDir = new _(certsDir.toString() + '/RSARootCerts', true);
        var scopesDir = new _(certsDir.toString() + '/scopes', true);

        if ( !certsDir.existsSync() ) {
            certsDir.mkdirSync()
        }
        if ( !theRSARootCertsDir.existsSync() ) {
            theRSARootCertsDir.mkdirSync()
        }
        if ( !scopesDir.existsSync() ) {
            scopesDir.mkdirSync()
        }

        var mainConfig = require( _(self.opt.homedir + '/main.json', true) );
        var scopes = mainConfig.scopes[self.release];

        for (let i = 0, len = scopes.length; i < len; i++) {
            let scopeDir = new _( scopesDir.toString() +'/'+ scopes[i], true);
            if ( !scopeDir.existsSync() ) {
                scopeDir.mkdirSync()
            }
        }

        done()
    }


    self.readSettings = function(done) {
        for (let s in self.settings) {
            if (!/^\_/.test(s) && !getEnvVar('GINA_' + s.toUpperCase()) ) {
                setEnvVar('GINA_' + s.toUpperCase(), self.settings[s])
            }
        }

        done();
    }

    /**
     * Checking PIDs for cleanup
     *
     **/
    self.checkRunningPids = function(done) {
        console.debug('Checking PIDs for cleanup...');
        if ( /true/.test(getEnvVar('GINA_IS_WIN32')) ) {
            console.debug(' Skipping for windows...');
        }
        var err         = null;
        var runDirObj   = new _( getEnvVar('GINA_RUNDIR'), true );
        var runDir      = runDirObj.toString();

        if ( runDirObj.existsSync() ) {
            console.debug('Run dir: ', runDir );
            var files = fs.readdirSync(runDir);
            for (let f in files) {
                if ( /^\./.test(files[f]) ) {
                    continue;
                }
                let filenameObj = new _( runDir +'/'+ files[f], true );
                let filename = filenameObj.toString();
                let pid = fs.readFileSync(filename).toString();
                if (!pid) {
                    filenameObj.rmSync();
                    continue;
                }
                let isRunnung = true;
                try {
                    let found = execSync("ps -p "+ pid +" -o pid="); //.replace(/\n$/g, '') || null;
                    if (!found) {
                        isRunnung = false;
                    }
                } catch (err) {
                    isRunnung = false;
                }

                if (!isRunnung) {
                    filenameObj.rmSync();
                    continue;
                }


                console.debug('Process file location: '+ filename +' ['+ pid +'] ['+ isRunnung +']');
            } // EO for (let f in files) {
        } else {
            console.warn('Run directory `'+ runDir +'` not found !')
        }

        done()
    }

    self.end = function(done) {
        defineDefault(process.gina);
        done()
    }

    return {
        onComplete: function(callback) {
            e.once('init#complete', function(err, run, opt) {
                callback(err, run, opt)
            });
            init(opt)
        },
        onListen: function(callback) {
            e.once('init#listen', function(err, run, opt) {
                callback(err, run, opt)
            });
            e.emit('init#listen', false, run, opt)
        }
    }
}
module.exports = Initialize;