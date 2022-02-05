var console = lib.logger;

function Set(opt){
    
    var mainConfPath        = _(GINA_HOMEDIR + '/main.json')
        , mainConf          = require(mainConfPath)
        , mainSettingsPath  = _(GINA_HOMEDIR +'/'+ GINA_SHORT_VERSION + '/settings.json')
        , mainSettingsConf  = require(mainSettingsPath)
    ;

    var init = function(opt){
        //if ( typeof(GINA_LOG_LEVEL) != '')
        var a = [], k, v;
        for (var i=3; i<process.argv.length; ++i) {
            a = process.argv[i].split(/=/);
            k = a[0];
            v = a[1];
            console.debug('Preprocessing `framework:set '+ process.argv[i] +'`');
            set(k,v);
        }
    };



    var set = function(k, v) {
        var err = null;
        switch(k) {
            case '--log-level':
                setLogLevel(v);
            break;
            
            case '--env':
                setEnv(v);
            break;
            
            case '--culture':
                setCulture(v);
            break;
            
            case '--debug_port':
            case '--debug-port':
                setDebugPort(v);
            break;            
            
            case '--timezone':
                setTimezone(v);
            break;
            
            default:
                err = new Error('Setting environment variable `'+ k +'` is not supported');
                console.error(err.message);
                
        }
    }

    var setLogLevel = function(level) {

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
    
    var setDebugPort = function(port) {
        console.debug('Setting `debug port` to #'+ port);
        // save to ~/.gina/{GINA_VERSION_SHORT}/settings.json
        process['gina']['debug_port'] = port;
        mainSettingsConf['debug_port'] = port;
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

    init(opt)
};

module.exports = Set