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
        console.debug('checking main...');
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
            
            // updating protocols
            mainConfig.protocols = merge(mainConfig.protocols, data.protocols, true);
            // don't remove def_protocol
            var defProtocol = mainConfig['def_protocol'][self.release];
            if ( mainConfig.protocols[self.release].indexOf(defProtocol) < 0 )
                mainConfig.protocols[self.release].push(defProtocol);
            
            mainConfig.protocols[self.release].sort();
            
            
            // commit
            lib.generator.createFileFromDataSync(mainConfig, target)
        }
    }

    /**
     * Checking ports
     *
     **/
    self.checkIfPorts = function() {
        console.debug('checking ports...');
        var target = _(self.opt.homedir +'/ports.json');

        if ( !fs.existsSync(target) ) {
            lib.generator.createFileFromDataSync(
                { "http": {} },
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
            , env           = process.env.NODE_ENV = _( getEnvVar('GINA_ENV') || main['dev_env'][self.release], true)
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

    self.setLoggers = function() {
        //var terminal = lib.logger('terminal', require() );
    }


    self.checkFrameworkLocals = function() {

    }

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