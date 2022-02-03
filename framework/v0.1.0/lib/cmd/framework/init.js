var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var e               = new EventEmitter();
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
                eval(func);
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
            if ( GINA_ENV_IS_DEV )
                delete require.cache[require.resolve(path)];
            require(path)(opt, cmd)
        } catch(err) {
            console.crit('Gina has some troubles with command [ ', process.argv.join(' ') + ' ]\n' + err.stack)
        }
    }

    self.checkIfHome = function() {
        var path = self.opt.homedir;
        console.debug('Checking home... [ '+ path +' ]');

        if ( !getEnvVar('GINA_HOMEDIR') ) {
            setEnvVar('GINA_HOMEDIR', path)
        } else {
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
        var source  = getPath('gina').root + '/resources/home/main.json';
        var target  = self.opt.homedir + '/main.json';
        var version = 'v' + getEnvVar('GINA_VERSION');

        var data = require(source);
        var dic = {
            'release' : self.release,
            'version' : version
        };
        data = whisper(dic, data);
        
                
        if ( !fs.existsSync(target) ) {
            try {                
                lib.generator.createFileFromDataSync(data, target)
            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }
        } else {
            // update if needed : like the version number ...
            var mainConfig  = require(target);
            mainConfig      = whisper(dic, mainConfig);
            
            // envs
            mainConfig.envs = merge(mainConfig.envs, data.envs, true);
            
            // updating protocols, schemes & cultures
            mainConfig.protocols = merge(mainConfig.protocols, data.protocols, true);
            mainConfig.schemes = merge(mainConfig.schemes, data.schemes, true);
            mainConfig.cultures = merge(mainConfig.cultures||{}, data.cultures, true);
            
            
            // don't remove def_protocol
            var defProtocol = mainConfig['def_protocol'][self.release];
            var defScheme   = mainConfig['def_scheme'][self.release];
            var defCulture  = mainConfig['def_culture'][self.release];
            var defTimezone  = mainConfig['def_timezone'][self.release];
            
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
                
            mainConfig.protocols[self.release].sort();
            mainConfig.schemes[self.release].sort();
            mainConfig.cultures[self.release].sort();
            
            // commit
            lib.generator.createFileFromDataSync(mainConfig, target);
            
            setEnvVar('GINA_CULTURES', mainConfig.cultures[self.release]);
            setEnvVar('GINA_CULTURE', defCulture);
            setEnvVar('GINA_TIMEZONE', defTimezone);
            process.env.TZ = defTimezone;
        }
    }

    /**
     * Checking ports
     *
     **/
    self.checkIfPorts = function() {
        console.debug('checking ports...');        
        var mainConfig  = require(self.opt.homedir + '/main.json');
        var target = _(self.opt.homedir +'/ports.json');

        if ( !fs.existsSync(target) ) {
            
            var protocols   = mainConfig.protocols[self.release]
                , schemes   = mainConfig.schemes[self.release]
                , ports     = {};
            
            for (var p = 0, pLen = protocols.length; p < pLen; ++p) {
                ports[protocols[p]] = {};
                for (var s = 0, sLen = schemes.length; s < sLen; ++s) {
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
        console.debug('checking ports.reverse...');
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
            var isRegistered = false;
            var isDev = false;
            var main = require( self.opt.homedir + '/main.json' );
            //has registered env ?
            var env = getEnvVar('GINA_ENV') || main['dev_env'][self.release]; // dev by default

            if ( main.envs[self.release].indexOf(env) < 0 ) {
                console.error('environment [ ' + env + ' ] not registered.' +
                    ' See [ man gina-env ].');
                process.exit(1)
            }

            // has dev env ?
            if (
                typeof(main['dev_env']) == 'undefined' ||
                typeof(main['dev_env']) != 'undefined' &&
                typeof(main['dev_env'][self.release]) != 'undefined' &&
                main.envs[self.release].indexOf(main['dev_env'][self.release]) < 0
                ) {
                console.warn('the framework has no dev link ' +
                    'environment to gina\'s.\nUse: $ gina env:link-dev <your_env>')
            } else if (
                typeof(main['dev_env']) != 'undefined' &&
                typeof(main['dev_env'][self.release]) != 'undefined' &&
                main.envs[self.release].indexOf(main['dev_env'][self.release]) > -1
                ) {
                isDev = true
            }

            setEnvVar('GINA_ENV_IS_DEV', isDev);
            
        //}
    }

    /**
     * Checking projects
     *
     **/
    self.checkIfProjects = function() {
        console.debug('checking projects...');
        var target = _(self.opt.homedir +'/projects.json');

        if ( !fs.existsSync(target) ) {
            lib.generator.createFileFromDataSync(
                {},
                target
            )
        }
    }


    /**
     * Checking settings, defining constants
     * Also done during bin/cmd init() ... so if you change here ...
     **/

    self.checkIfSettings = function() {
        console.debug('checking settings...');
        var main            = require( _(self.opt.homedir + '/main.json', true) )
            , version       = _( getEnvVar('GINA_VERSION'), true)
            , env           = _( getEnvVar('GINA_ENV') || main['dev_env'][self.release], true)
            , settings      = require( _( getPath('gina').root + '/resources/home/settings.json', true ) )
            , userSettings  = {}
            , target        = _(self.opt.homedir +'/'+ self.release +'/settings.json', true)
        ;

        // updated on framework start : you never know which user is going to start gina (root ? sudo ? regular user)
        // TODO - user settings override is passed through argv : —-logdir=value  —-tmpdir=value —-rundir=value —-homedir=value

        var uid     = process.getuid()
            , gid   = process.getgid();

        try {

            var dic = {
                'version' : _( getEnvVar('GINA_VERSION'), true),
                'culture' : _( getEnvVar('GINA_CULTURE'), true),
                'timezone' : _( getEnvVar('GINA_TIMEZONE'), true),
                'dev_env' : env,
                'node_version': process.version,
                'debug_port' : process.debugPort,
                'user' : process.env.USER,
                'uid' : uid,
                'gid' : gid,
                'dir': getPath('gina').root,
                'home_dir' : _( getUserHome(), true ),
                'run_dir' : _( getRunDir(), true ),
                'tmp_dir' : _( getTmpDir(), true ),
                'log_dir' : _( getLogDir(), true )
            };

            settings = whisper(dic, settings);
            settings = merge(userSettings, settings);
            self.settings = settings;

            lib.generator.createFileFromDataSync(
                settings,
                target
            )
        } catch (err) {
            console.error(err.stack);
            process.exit(1)
        }
    }

    self.readSettings = function() {
        var name = '';
        for (var s in self.settings) {
            if (!/^\_/.test(s) && !getEnvVar('GINA_' + s.toUpperCase()) ) {
                setEnvVar('GINA_' + s.toUpperCase(), self.settings[s])
            }
        }
    }

    // self.setLoggers = function() {
    //     //var terminal = lib.logger('terminal', require() );
    // }


    // self.checkFrameworkLocals = function() {

    // }

    self.end = function() {
        //getDefined() to list it all
        //for (var c in process.gina) {
        //    define(c, process.gina[c])
        //}
        //delete  process.gina
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
};

module.exports = Initialize