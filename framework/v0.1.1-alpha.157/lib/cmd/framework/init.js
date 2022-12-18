var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var e               = new EventEmitter();
const { execSync }  = require('child_process');

var console         = lib.logger;
var ginaPath        = getPath('gina').root;
var help            = require(ginaPath + '/utils/helper');


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
    var begin = function() {
        var i = 0;
        var funcs = [];
        for (var t in self) {
            if( typeof(self[t]) == 'function') {
                var func = 'self.' + t + '()';
                console.debug('Running [ ' + func + ' ]');
                eval(func);// jshint ignore:line
                ++i
            }

            if ( i == self.functionCount() ) {
                e.emit('init#complete', false, run, self.opt);
                break
            }
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
            process.exit(-1);
        }
    }

    self.checkIfHome = function() {
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
                console.error(err.stack);
                process.exit(1)
            }
        }
    }


    self.checkIfVersionDir = function() {

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
                console.error(err.stack);
                process.exit(1)
            }
        }
    }

    self.checkIfMain = function() {
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
                console.error(err.stack);
                process.exit(1)
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
    }

    /**
     * Checking ports
     *
     **/
    self.checkIfPorts = function() {
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
    }

    /**
     * Checking ports.reverse
     *
     **/
    self.checkIfPortsReverse = function() {
        console.debug('Checking ports.reverse...');
        var target = _(self.opt.homedir +'/ports.reverse.json');

        if ( !fs.existsSync(target) ) {
            lib.generator.createFileFromDataSync(
                {},
                target
            )
        }
    }


    /**
     * Check env
     *
     * */
    self.checkEnv = function() {
        // ignored for framework:set
        //if (self.opt.task.Action != 'set' && self.opt.task.topic != 'framework') {
        var main = require( self.opt.homedir + '/main.json' );
        //has registered env ?
        var env     = getEnvVar('GINA_ENV') || main['dev_env'][self.release]; // dev by default

        if ( main.envs[self.release].indexOf(env) < 0 ) {
            console.error('Environment [ ' + env + ' ] not registered. See [ man gina-env ].');
            process.exit(1)
        }

        // has dev env ?
        if (
            typeof(main['dev_env']) == 'undefined' ||
            typeof(main['dev_env']) != 'undefined' &&
            typeof(main['dev_env'][self.release]) != 'undefined' &&
            main.envs[self.release].indexOf(main['dev_env'][self.release]) < 0
        ) {
            console.error('the framework has no dev env linked to any' +
                'environment to gina\'s.\nUse: $ gina env:link-dev <your_new_dev_env>');

            process.exit(1)
        }
    }

    /**
     * Check scope
     *
     * */
    self.checkScope = function() {
        // ignored for framework:set
        var main = require( self.opt.homedir + '/main.json' );
        //has registered scope ?
        var scope   = getEnvVar('GINA_SCOPE') || main['local_scope'][self.release]; // scope by default
        if ( main.scopes[self.release].indexOf(scope) < 0 ) {
            console.error('Scope [ ' + scope + ' ] not registered. See [ man gina-scope ].');
            process.exit(1)
        }


        // has local scope ?
        if (
            typeof(main['local_scope']) == 'undefined' ||
            typeof(main['local_scope']) != 'undefined' &&
            typeof(main['local_scope'][self.release]) != 'undefined' &&
            main.scopes[self.release].indexOf(main['local_scope'][self.release]) < 0
        ) {
            console.error('the framework has no local scope linked to any ' +
                'scope to gina\'s.\nUse: $ gina scope:link-local <your_new_local_scope>');

            process.exit(1)
        }
    }


    /**
     * Checking settings, defining constants
     * Also done during bin/cmd init() ... so if you change here ...
     **/

    self.checkIfSettings = function() {
        console.debug('Checking framework settings...');
        var main            = require( _(self.opt.homedir + '/main.json', true) )
            , version       = getEnvVar('GINA_VERSION')
            , prefix        = getEnvVar('GINA_PREFIX') || main['def_prefix'][self.release]
            , globalMode    = getEnvVar('GINA_GLOBAL_MODE') || main['def_global_mode'][self.release]
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
            console.error(err.stack);
            process.exit(1)
        }
    }

    /**
     * Checking projects
     *
     **/
     self.checkIfProjects = function() {
        console.debug('Checking projects...');
        var main = requireJSON( self.opt.homedir + '/main.json' );
        var target = _(self.opt.homedir +'/projects.json', true);

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
                newProjects[name][prop] = JSON.clone(main[prop][self.release])
            }
        }

        //console.debug('----> ', JSON.stringify(newProjects, null, 2));
        lib.generator.createFileFromDataSync(
            newProjects,
            target
        )

    }




    self.checkIfCertificatesDir = function() {
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
    }

    // self.setLoggers = function() {
    //     //var terminal = lib.logger('terminal', require() );
    // }


    // self.checkFrameworkLocals = function() {

    // }

    self.readSettings = function() {
        for (let s in self.settings) {
            if (!/^\_/.test(s) && !getEnvVar('GINA_' + s.toUpperCase()) ) {
                setEnvVar('GINA_' + s.toUpperCase(), self.settings[s])
            }
        }
    }

    self.end = function() {
        defineDefault(process.gina)
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