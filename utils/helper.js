var fs = require('fs');
var os = require('os');

var lib         = null;
var console     = null;
merge           = null;

function MainHelper(opt) {
    var self = {
        protectedVars : [],
        config : {}
    };

    //Logger = function(){ return require( __dirname+ '/logger')};

    var init = function(opt) {
        //Load prototypes.
        require('./prototypes');

        //Load librairies.
        lib         = require('../script/lib');
        console     = lib.logger;
        merge       = lib.merge;
    }

    /**
     * Check if object before extending.
     * */
    // var isObject = function(obj) {
    //     if (
    //         !obj ||
    //         {}.toString.call(obj) !== '[object Object]' ||
    //         obj.nodeType ||
    //         obj.setInterval
    //     ) {
    //         return false
    //     }

    //     var hasOwn              = {}.hasOwnProperty;
    //     var hasOwnConstructor   = hasOwn.call( obj, 'constructor');
    //     var hasMethodPrototyped = hasOwn.call( obj.constructor.prototype, 'isPrototypeOf');


    //     if (
    //         obj.constructor &&
    //         !hasOwnConstructor &&
    //         !hasMethodPrototyped
    //     ) {
    //         return false
    //     }

    //     //Own properties are enumerated firstly, so to speed up,
    //     //if last one is own, then all properties are own.
    //     var key;
    //     return key === undefined || hasOwn.call( obj, key )
    // }




    isWin32 = function() {
        return ( os.platform() == 'win32' ) ? true : false;
    }


    /**
     *
     * @param {boolean} deep - Deep copy
     * @param {boolean} [override] - Override when copying
     * @param {object} target - Target object
     * @param {object} source - Source object
     *
     * @return {object} [result]
     * */
    // extend = function() {
    //     var target = arguments[ 0 ] || {};
    //     var i      = 1;
    //     var length = arguments.length;
    //     var deep   = false;
    //     var override = false;
    //     var options, name, src, copy, copy_is_array, clone;

    //     // Handle a deep copy situation
    //     if ( typeof target === 'boolean' ) {
    //         deep   = target;
    //         target = arguments[ 1 ] || {};
    //         // skip the boolean and the target
    //         i = 2
    //     }
    //     // Handle an override copy situation
    //     if ( typeof target === 'boolean' ) {
    //         override   = target;
    //         target = arguments[ 2 ] || {};
    //         // skip the boolean and the target
    //         i = 3
    //     }


    //     // Handle case when target is a string or something (possible in deep copy)
    //     if ( typeof target !== 'object' && typeof target !== 'function' ) {
    //         target = {};
    //     }

    //     for ( ; i < length; i++ ) {
    //         // Only deal with non-null/undefined values
    //         if (( options = arguments[ i ]) != null ) {
    //             // Extend the base object
    //             for (var name in options ) {
    //                 src  = target[ name ];
    //                 copy = options[ name ];

    //                 // Prevent never-ending loop
    //                 if ( target === copy ) {
    //                     continue
    //                 }

    //                 // Recurse if we're merging plain objects or arrays
    //                 if (
    //                     deep &&
    //                     copy &&
    //                     (
    //                         isObject( copy ) ||
    //                         ( copy_is_array = Array.isArray( copy ) )
    //                     )
    //                 ) {

    //                     if ( copy_is_array ) {
    //                         copy_is_array = false;
    //                         clone = src && Array.isArray( src ) ? src : []
    //                     } else {
    //                         clone = src && isObject( src) ? src : {}
    //                     }

    //                     //[propose] Supposed to go deep... deep... deep...
    //                     if (!override) {
    //                         for (var prop in copy) {
    //                             if( typeof(clone[ prop ]) != "undefined" ){
    //                                 copy[ prop ] = clone[ prop ];
    //                             }
    //                         }
    //                     }

    //                     // Never move original objects, clone them
    //                     if (typeof(src) != "boolean") {//if property is not boolean
    //                         target[ name ] = extend( deep, override, clone, copy )
    //                     }
    //                     // Don't bring in undefined values
    //                 } else if ( copy !== undefined ) {
    //                     //[propose]Don't override existing if prop defined or override @ false
    //                     if (
    //                         typeof(src) != "undefined" &&
    //                         src != copy &&
    //                         !override
    //                     ) {
    //                         target[ name ] = src
    //                     } else {
    //                         target[ name ] = copy
    //                     }

    //                 }
    //             }
    //         }
    //     }
    //     // Return the modified object
    //     return target
    // }

    // isEmpty = function(obj) {
    //     return Object.keys(obj).length === 0;
    // }

    filterArgs = function() {

        var setget  = ( typeof(process.argv[2]) != 'undefined'
                            && /(\:set$|\:get$|[-v]|\:version$|[--version])/.test(process.argv[2]))
                            ? true : false
            , evar  = ''
            , err   = null
        ;

        if ( typeof(process.env['gina']) == 'undefined') {
            process['gina'] = {}
        }

        var newArgv = {};
        for (var a in process.argv) {            
            if ( /\-\-/.test(process.argv[a]) && process.argv[a].indexOf('=') > -1 ) {
                evar = ( (process.argv[a].replace(/--/, ''))
                    .replace(/-/, '_') )
                    .split(/=/);

                evar[0] = evar[0].toUpperCase();
                if (
                    evar[0].substr(0, 5) !== 'GINA_' &&
                    evar[0].substr(0, 7) !== 'VENDOR_' &&
                    evar[0].substr(0, 5) !== 'USER_'
                    ) {
                    evar[0] = 'GINA_' + evar[0]
                }
                //Boolean values.
                if (evar[1] === "true") {
                    evar[1] = true
                }
                if (evar[1] === "false") {
                    evar[1] = false
                }
                //Avoid protected.
                if (self.protectedVars.indexOf(evar[0]) == -1 ) {
                    process.gina[evar[0]] = evar[1];
                } else {
                    //throw new Error('gina won\'t override protected env var [ ' +evar[0]+ ' ] or constant.')
                    err = new Error('gina won\'t override protected env var [ ' +evar[0]+ ' ] or constant.');
                    console.error(err.stack||err.message);
                    return;
                }

            } else {
                newArgv[a] = process.argv[a]
            }
        }

        //Cleaning argv.
        if (!setget)
            process.argv = newArgv;

        //Cleaning the rest.
        for (var e in process.env) {
            if (
                e.substr(0, 5) === 'GINA_' || // 6?
                e.substr(0, 7) === 'VENDOR_' ||
                e.substr(0, 5) === 'USER_'
                ) {
                process['gina'][e] = process.env[e];
                delete process.env[e]
            }
        }

        setContext('envVars', process['gina']);
    }

    getEnvVar = function(key) {
        if (
            typeof(process['gina']) != 'undefined' &&
            typeof(process['gina'][key]) != 'undefined' &&
            process['gina'][key] != ''
            ) {
            return process['gina'][key]
        }
        return undefined
    }

    getEnvVars = function() {
        return process.gina
    }

    /**
     * Get log path - %SystemRoot%\system32\winevt\logs or /
     *
     * @return {string} logPath
     * */
    getLogDir = function() {
        var log = function() {
            if ( isWin32() ) {
                return process.env.LOG ||
                    process.env.LOGS ||
                    (process.env.SystemRoot || process.env.windir) + '\\System32\\Winevt\\Logs'
            } else {
                return process.env.LOGDIR ||
                    process.env.LOG ||
                    process.env.LOGS ||
                    '/var/log'
            }
        };

        return ( typeof(log) == 'function') ?  log() : log
    }

    getProtected = function() {
        return self.protectedVars
    }

    /**
     * Get run\lock path
     * @return {string} rundir
     * */
    getRunDir = function() {
        if ( isWin32() ) {
            console.debug('check /gina/utils/helper.js around on getRunDir()')
        } else {
            // Means /var/run or /var/lock by default.
            var runDir = '/usr/local/var/run';
            return ( fs.existsSync(runDir) ) ? runDir : '/usr/local/var/lock'//by default.
        }
    }

    getTmpDir = function() {
        // support for node 0.10.x & 0.11.x
        var tmp = os.tmpdir || function() {
            if ( isWin32() ) {
                return process.env.TEMP ||
                    process.env.TMP ||
                    (process.env.SystemRoot || process.env.windir) + '\\temp'
            } else {
                return process.env.TMPDIR ||
                    process.env.TMP ||
                    process.env.TEMP ||
                    '/tmp'
            }
        };

        return ( typeof(tmp) == 'function') ?  tmp() : tmp
    }

    getUserHome = function() {
        return process.env[(isWin32()) ? 'USERPROFILE' : 'HOME']
    }

    getVendorsConfig = function(vendor) {
        var msg = 'Helper could not load ['+ vendor +'] config.';
        if ( typeof(vendor) != 'undefined' ) {
            try {
                return self.config[vendor]
            } catch (err) {
                //throw new Error(msg);
                console.error(err.stack||err.message);
                return;
            }
        } else {
            return self.config
        }
    }

    setVendorsConfig = function(dir) {
        if ( !fs.existsSync(dir) ) {
            console.debug('Directory [' + dir + '] is missing !')
        } else {
            var files = fs.readdirSync(dir), filename = "";
            var file = '', a = [];
            for (var f = 0; f < files.length; ++f) {
                filename = dir + '/' + files[f];
                file = ( a = files[f].split('.'), a.splice(0, a.length-1)).join('.');
                self.config[file] = require(filename)
            }
        }
    }

    setEnvVar = function(key, val, isProtected) {        
        key = key.toUpperCase();
        var err                     = null
            // related task `framework:set` & framework/v.xxx/lib/cmd/framework/init.js 
            , specialCases          = ['GINA_DEBUG_PORT', 'GINA_CULTURE', 'GINA_TIMEZONE']
            , isOverrrideAllowed    = (specialCases.indexOf(key) > -1) ? true : false
        ;
        
        if (
            key.substr(0, 5) !== 'GINA_' &&
            key.substr(0, 7) !== 'VENDOR_' &&
            key.substr(0, 5) !== 'USER_'
            ) {
            key = 'USER_' + key
        }
        if (
            typeof(process['gina']) != 'undefined' &&
            typeof(process['gina'][key]) != 'undefined' &&
            process['gina'][key] !== '' &&
            // exceptions
            !isOverrrideAllowed
        ) {
            err = new Error('Env variable [ '+ key + ' ] is already set');
            console.warn(err.message);
            return
        } else {
            //Write env var.
            if ( typeof(process['gina']) == 'undefined') {
                process['gina'] = {}
            }
            process['gina'][key] = val;
            if ( typeof(isProtected) != 'undefined' && isProtected == true) {                
                self.protectedVars.push(key)
            }            
        }        
    }

    defineDefault = function(obj) {
        for (var c in obj) {
            define(c, obj[c])
        }
        delete  obj
    }

    init(opt)

};

module.exports = MainHelper()