var console = lib.logger;

function Set(opt){

    var mainConfPath        = _(GINA_HOMEDIR + '/main.json', true)
        , mainConf          = require(mainConfPath)
        , mainSettingsPath  = _(GINA_HOMEDIR +'/'+ GINA_SHORT_VERSION + '/settings.json', true)
        , mainSettingsConf  = require(mainSettingsPath)
        , pack              = require(_(GINA_DIR +'/package.json', true ))
    ;

    var init = function(opt){

        var a = [], k = null, v = null;
        for (let i=3; i<process.argv.length; ++i) {
            a = process.argv[i].split(/=/);
            k = a[0];
            v = a[1];
            console.debug('Preprocessing `framework:set '+ process.argv[i] +'`');
            set(k,v);
        }
        end()
    };



    var set = function(k, v) {
        var err = null;
        if ( /^-—/.test(k) ) {
            k = k.replace(/-—/, '--');
        }
        switch(k) {
            case '--prefix':
                setPrefix(v);
            break;

            case '--global_mode':
            case '--global-mode':
                setGlobalMode(v);
            break;

            case '--log_level':
            case '--log-level':
                setLogLevel(v);
            break;

            case '--env':
                setEnv(v);
            break;

            case '--scope':
                setScope(v)
            break;

            case '--culture':
                setCulture(v);
            break;

            case '--port':
                setPort(v);
            break;

            case '--debug_port':
            case '--debug-port':
                setDebugPort(v);
            break;

            case '--timezone':
                setTimezone(v);
            break;

            default:
                return end(new Error('Setting environment variable `'+ k +'` is not supported'), 'error', true);
                // err = new Error('Setting environment variable `'+ k +'` is not supported');
                // console.error(err.message);

        }
    }

    var setPrefix = function(prefix) {
        var err = null;
        if ( !prefix || typeof(prefix) == 'undefined' || prefix == '' ) {
            err = new Error('Prefix cannot be left empty or undefined');
            console.error(err.message);
            return
        }
        // save to ~/.gina/main.json
        if ( typeof(mainConf['def_prefix']) == 'undefined' ) {
            mainConf['def_prefix'] = {}
        }
        mainConf['def_prefix'][GINA_SHORT_VERSION] = prefix;
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['prefix'] = prefix;
        mainSettingsConf['prefix'] = prefix;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
        // update package.json
        pack.config.prefix = prefix;
        lib.generator.createFileFromDataSync(pack, _(GINA_DIR +'/package.json', true ));
    }

    var setGlobalMode = function(globalMode) {
        var err = null;
        if ( !globalMode || typeof(globalMode) == 'undefined' || globalMode == '' ) {
            err = new Error('Global Mode cannot be left empty or undefined');
            console.error(err.message);
            return
        }
        globalMode = /^true$/i.test(globalMode) ? true : false;
        // save to ~/.gina/main.json
        if ( typeof(mainConf['def_global_mode']) == 'undefined' ) {
            mainConf['def_global_mode'] = {}
        }
        mainConf['def_global_mode'][GINA_SHORT_VERSION] = globalMode;
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['global_mode'] = globalMode;
        mainSettingsConf['global_mode'] = globalMode;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
        // update package.json
        pack.config.globalMode = globalMode;
        lib.generator.createFileFromDataSync(pack, _(GINA_DIR +'/package.json', true ));
    }

    var setLogLevel = function(level) {
        var supported   = mainConf['log_levels'][GINA_SHORT_VERSION]
            , err       = null
        ;
        if (supported.indexOf(level) < 0) {
            err = new Error('Log level `'+ level +'` is not supported at the moment');
            console.error(err.message);
            return;
        }
        // save to ~/.gina/main.json
        mainConf['def_log_level'][GINA_SHORT_VERSION] = level;
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['log_level'] = level;
        mainSettingsConf['log_level'] = level;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
    }

    var setEnv = function(env) {
        var supported   = mainConf['envs'][GINA_SHORT_VERSION]
            , err       = null
        ;
        if (supported.indexOf(env) < 0) {
            err = new Error('Environment `'+ env +'` is not supported at the moment');
            console.error(err.message);
            return;
        }
        mainConf['def_env'][GINA_SHORT_VERSION] = env;
        // save to ~/.gina/main.json
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
    }

    var setScope = function(scope) {
        var supported   = mainConf['scopes'][GINA_SHORT_VERSION]
            , err       = null
        ;
        if (supported.indexOf(scope) < 0) {
            err = new Error('Scope `'+ scope +'` is not supported at the moment');
            console.error(err.message);
            return;
        }
        mainConf['def_scope'][GINA_SHORT_VERSION] = scope;
        // save to ~/.gina/main.json
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
    }

    var setCulture = function(culture) {
        var supported   = mainConf['cultures'][GINA_SHORT_VERSION]
            , err       = null
        ;
        if (supported.indexOf(culture) < 0) {
            err = new Error('Culture `'+ culture +'` is not supported at the moment');
            console.error(err.message);
            return;
        }
        // save to ~/.gina/main.json
        mainConf['def_culture'][GINA_SHORT_VERSION] = culture;
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['culture'] = culture;
        mainSettingsConf['culture'] = culture;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
    }

    var setPort = function(port) {
        console.debug('Setting `port` to #'+ port);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['port'] = ~~port;
        mainSettingsConf['port'] = ~~port;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
    }

    var setDebugPort = function(port) {
        console.debug('Setting `debug port` to #'+ port);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['debug_port'] = ~~port;
        mainSettingsConf['debug_port'] = ~~port;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
    }

    var setTimezone = function(timezone) {
        // save to ~/.gina/main.json
        mainConf['def_timezone'][GINA_SHORT_VERSION] = timezone;
        lib.generator.createFileFromDataSync(mainConf, mainConfPath);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['timezone'] = timezone;
        mainSettingsConf['timezone'] = timezone;
        lib.generator.createFileFromDataSync(mainSettingsConf, mainSettingsPath);
    }

    var end = function (err, type, messageOnly) {
        if ( typeof(err) != 'undefined') {
            var out = ( typeof(messageOnly) != 'undefined' && /^true$/i.test(messageOnly) ) ? err.message : (err.stack||err.message);
            if ( typeof(type) != 'undefined' ) {
                console[type](out)
            } else {
                console.error(out);
            }
        }

        process.exit( err ? 1:0 )
    }

    init(opt)
};

module.exports = Set