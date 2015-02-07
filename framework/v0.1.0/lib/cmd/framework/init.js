var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var e = new EventEmitter();
var ginaPath = getPath('gina');
var help = require(ginaPath + '/utils/helper');

var console = lib.logger;
var aliases = require( getPath('gina.lib') + '/cmd/aliases.json' );

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

    var run = function(opt) {
        opt.task = checkForAliases(opt.task);
        var filename ='/cmd/' + opt.task.topic + '/' + opt.task.action + '.js'
        var path = getPath('gina.lib') + filename;

        try {
            require(path)(opt)
        } catch(err) {
            console.crit('Geena has some troubles with command [ ', process.argv.toArray().join(' ') + ' ]\n' + err.stack)
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
        var source = getPath('gina') + '/resources/home/main.json';
        var target = self.opt.homedir + '/main.json';

        if ( !fs.existsSync(target) ) {
            try {
                var data = require(source);
                var dic = {
                    'release' : self.release,
                    'version' : getEnvVar('GINA_VERSION')
                };
                data = whisper(dic, data);

                lib.generator.createFileFromDataSync(data, target)
            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }
        } else {
            // update if needed : like the version number ...
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
     *
     **/
    self.checkIfSettings = function() {
        console.debug('checking settings...');
        var main = require( self.opt.homedir + '/main.json' )
            ,version = getEnvVar('GINA_VERSION')
            ,env = getEnvVar('GINA_ENV') || main['dev_env'][self.release]
            ,source = getPath('gina') + '/resources/home/settings.json'
            ,target = self.opt.homedir +'/'+ self.release +'/settings.json';

        if ( !fs.existsSync(target) ) {
            try {
                var data = require(source);
                data.version = version;
                data.env = env;
                data.tmpdir = _( getTmpDir() );
                data.rundir = _( getRunDir() );
                data.logdir = _( getLogDir() );
                //data.node_version = nodeVersion;

                var env = require(self.opt.homedir + '/main.json').dev_env;
                var dic = {
                    'version' : getEnvVar('GINA_VERSION'),
                    'dev_env' : env
                };
                data = whisper(dic, data);
                self.settings = data;

                lib.generator.createFileFromDataSync(
                    data,
                    target
                )
            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }

        } else {
            //Loading settings.
            try {
                self.settings = require(target);

            } catch (err) {
                console.error(err.stack);
                process.exit(1)
            }
        }
    }

    self.readSettings = function() {
        var name = '';
        for (var s in self.settings) {
            if ( !getEnvVar('GINA_' + s.toUpperCase()) ) {
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
        for (var c in process.gina) {
            define(c, process.gina[c])
        }
        delete  process.gina
    }

    return {
        onComplete : function(callback) {
            e.on('init#complete', function(err, run, opt) {
                callback(err, run, opt)
            });
            init(opt)
        }
    }
};

module.exports = Initialize