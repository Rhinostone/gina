var fs = require('fs');
var os = require('os');



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

    }

    /**
     * Check if object before extending.
     * */
    var isObject = function(obj) {
        if (
            !obj ||
            {}.toString.call(obj) !== '[object Object]' ||
            obj.nodeType ||
            obj.setInterval
        ) {
            return false
        }

        var hasOwn              = {}.hasOwnProperty;
        var hasOwnConstructor   = hasOwn.call( obj, 'constructor');
        var hasMethodPrototyped = hasOwn.call( obj.constructor.prototype, 'isPrototypeOf');


        if (
            obj.constructor &&
            !hasOwnConstructor &&
            !hasMethodPrototyped
        ) {
            return false
        }

        //Own properties are enumerated firstly, so to speed up,
        //if last one is own, then all properties are own.
        var key;
        return key === undefined || hasOwn.call( obj, key )
    }




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
    extend = function() {
        var target = arguments[ 0 ] || {};
        var i      = 1;
        var length = arguments.length;
        var deep   = false;
        var override = false;
        var options, name, src, copy, copy_is_array, clone;

        // Handle a deep copy situation
        if ( typeof target === 'boolean' ) {
            deep   = target;
            target = arguments[ 1 ] || {};
            // skip the boolean and the target
            i = 2
        }
        // Handle an override copy situation
        if ( typeof target === 'boolean' ) {
            override   = target;
            target = arguments[ 2 ] || {};
            // skip the boolean and the target
            i = 3
        }


        // Handle case when target is a string or something (possible in deep copy)
        if ( typeof target !== 'object' && typeof target !== 'function' ) {
            target = {};
        }

        for ( ; i < length; i++ ) {
            // Only deal with non-null/undefined values
            if (( options = arguments[ i ]) != null ) {
                // Extend the base object
                for (var name in options ) {
                    src  = target[ name ];
                    copy = options[ name ];

                    // Prevent never-ending loop
                    if ( target === copy ) {
                        continue
                    }

                    // Recurse if we're merging plain objects or arrays
                    if (
                        deep &&
                        copy &&
                        (
                            isObject( copy ) ||
                            ( copy_is_array = Array.isArray( copy ) )
                        )
                    ) {

                        if ( copy_is_array ) {
                            copy_is_array = false;
                            clone = src && Array.isArray( src ) ? src : []
                        } else {
                            clone = src && isObject( src) ? src : {}
                        }

                        //[propose] Supposed to go deep... deep... deep...
                        if (!override) {
                            for (var prop in copy) {
                                if( typeof(clone[ prop ]) != "undefined" ){
                                    copy[ prop ] = clone[ prop ];
                                }
                            }
                        }

                        // Never move original objects, clone them
                        if (typeof(src) != "boolean") {//if property is not boolean
                            target[ name ] = extend( deep, override, clone, copy )
                        }
                        // Don't bring in undefined values
                    } else if ( copy !== undefined ) {
                        //[propose]Don't override existing if prop defined or override @ false
                        if (
                            typeof(src) != "undefined" &&
                            src != copy &&
                            !override
                        ) {
                            target[ name ] = src
                        } else {
                            target[ name ] = copy
                        }

                    }
                }
            }
        }
        // Return the modified object
        return target
    }

    isEmpty = function(obj) {
        return Object.keys(obj).length === 0;
    }

    merge = function() {
        
        var newTarget = []/**, nextTickCalled = false*/;
        
        /**
         *
         * @param {boolean} [override] - Override when copying
         * @param {object} target - Target object
         * @param {object} source - Source object
         *
         * @return {object} [result]
         * */
        var init = browse = function (target, source) {
            
            if ( typeof(target) == 'undefined' ) {
                target = ( typeof(source) != 'undefined' && Array.isArray(source)) ? [] : {}
            }
    
            var override = false;
            if (( typeof(arguments[arguments.length-1]) == 'boolean' )) {
                override = arguments[arguments.length-1]
            }
    
            var i = 1;
            var length = arguments.length;
    
            var options, name, src, copy, copyIsArray, clone;
    
    
    
            // Handle case when target is a string or something (possible in deep copy)
            if (typeof(target) !== 'object' && typeof(target) !== 'function') {
                if (override) {
                    if (typeof(arguments[2]) == 'undefined') {
                        target = arguments[1]
                    } else {
                        target = arguments[2]
                    }
                } else {
                    if (typeof(arguments[0]) == 'undefined') {
                        target = arguments[1]
                    } else {
                        target = arguments[0]
                    }
                }
    
            } else {
    
                for (; i < length; ++i) {
                    // Only deal with non-null/undefined values
                    if ( typeof(arguments[i]) != 'boolean' && ( options = arguments[i]) != null) {
                        if ( typeof(options) != 'object') {
                           target = options;
                           break;
                        }
    
                        // both target & options are arrays
                        if ( Array.isArray(options) && Array.isArray(target) ) {
    
    
                            target = mergeArray(options, target, override);
    
                        } else {
                            // Merge the base object
                            for (var name in options) {
                                if (!target) {
                                    target = { name: null }
                                }
    
                                src     = target[ name ] ;
                                copy    = options[ name ];
    
    
                                // Prevent never-ending loop
                                if (target === copy) {
                                    continue
                                }
    
                                // Recurse if we're merging plain objects or arrays
                                if (
                                    copy
                                    && (
                                        isObject(copy) ||
                                        ( copyIsArray = Array.isArray(copy) )
                                    )
                                ) {
    
                                    var createMode = false;
                                    if (copyIsArray) {
                                        copyIsArray = false;
                                        clone = src && Array.isArray(src) ? src : [];
    
                                        newTarget = clone;
                                        clone = mergeArray(copy, clone, override);
                                        target[ name ] = clone;
                                        continue
    
                                    } else {
    
                                        clone = src && isObject(src) ? src : null;
    
                                        if (!clone) {
                                            createMode = true;
                                            clone = {};
                                            // copy props
                                            for (var prop in copy) {
                                                clone[prop] = copy[prop]
                                            }
                                        }
                                    }
    
    
    
                                    //[propose] Supposed to go deep... deep... deep...
                                    if ( !override ) {
                                        // add those in copy not in clone (target)
    
                                        for (var prop in copy) {
                                            if (typeof(clone[ prop ]) == 'undefined') {
                                                if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                    clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                                } else {
                                                    clone[ prop ] = copy[ prop ] // don't override existing
                                                }
                                            } else if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                            }
                                        }
    
    
    
    
                                        // Never move original objects, clone them
                                        if (typeof(src) != 'boolean' && !createMode ) {//if property is not boolean
    
                                            // Attention: might lead to a `Maximum call stack size exceeded` Error message
                                            target[ name ] = browse(clone, copy, override);
    
                                        } else if (createMode) {
                                            target[ name ] = clone;
                                        }
    
                                    } else {
    
                                        for (var prop in copy) {
                                            if ( typeof(copy[ prop ]) != 'undefined' ) {
                                                //clone[prop] = copy[prop]
                                                if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                    clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                                } else {
                                                    clone[ prop ] = copy[ prop ] // don't override existing
                                                }
                                            } else if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                            }
                                        }
    
                                        target[ name ] = clone
                                    }
    
                                } else if (copy !== undefined) {
                                    //[propose]Don't override existing if prop defined or override @ false
                                    if (
                                        typeof(src) != 'undefined'
                                        && src != null
                                        && src !== copy && !override
                                    ) {
                                        target[ name ] = src
                                    } else {
                                        target[ name ] = copy;
                                    }
    
                                }
                            }
                        }
                    }
    
                }
    
            }
            
            newTarget = [];
            // Return the modified object
            return target
        }
        
        // Will not merge functions items: this is normal
        // Merging arrays is OK, but merging collections is still experimental
        var mergeArray = function(options, target, override) {
            newTarget = [];
            var newTargetIds = [];

            if (override) {

                // if collection, comparison will be done uppon the `id` attribute
                if (
                    typeof(options[0]) == 'object' && typeof(options[0].id) != 'undefined'
                    && typeof(target[0]) == 'object' && typeof(target[0].id) != 'undefined'
                ) {

                    newTarget = [];
                    
                    var _options    = JSON.parse(JSON.stringify(options));
                    
                    var index = 0;

                    for (var n = next || 0, nLen = target.length; n < nLen; ++n) {
                                            
                        label:
                        for (var a = a || 0, aLen = _options.length; a < aLen; ++a) {
                        
                            if (_options[a].id === target[n].id ) {

                                if (newTargetIds.indexOf(_options[a].id) > -1) {
                                    
                                    newTarget[index] = _options[a];
                                    ++index
                                    
                                } else if (newTargetIds.indexOf(_options[a].id) == -1) {

                                    newTargetIds.push(_options[a].id);                                
                                    newTarget.push(_options[a]);
                                }

                                break label;
                                
                            } else if (newTargetIds.indexOf(_options[a].id) == -1) {
                                    
                                newTargetIds.push(_options[a].id);
                                newTarget.push(_options[a]);
                            }
                        }
                    }

                    newTargetIds = [];

                    return newTarget

                } else { // normal case `arrays` or merging from a blank collection
                    return options
                }
            }

            if ( options.length == 0 &&  target.length > 0) {
                newTarget = target;
            }

            if ( target.length == 0 && options.length > 0) {
                for (var a = 0; a < options.length; ++a ) {
                    target.push(options[a]);
                }
            }

            if (newTarget.length == 0 && target.length > 0) {            
                // ok, but don't merge objects
                for (var a = 0; a < target.length; ++a ) {
                    if ( typeof(target[a]) != 'object' && newTarget.indexOf(target[a]) == -1) {
                        newTarget.push(target[a]);
                    }
                }
            }
            
            if ( target.length > 0 ) {
                
                // if collection, comparison will be done uppon the `id` attribute
                if (
                    typeof (options[0]) != 'undefined' 
                    && typeof (options[0]) == 'object' 
                    && options[0] != null 
                    && typeof(options[0].id) != 'undefined'
                    && typeof(target[0]) == 'object' 
                    && typeof(target[0].id) != 'undefined'
                ) {

                    newTarget       = JSON.parse(JSON.stringify(target));
                    var _options    = JSON.parse(JSON.stringify(options));
                    var next        = null;
                    

                    for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                        newTargetIds.push(newTarget[a].id);
                    }
                    for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                        
                        end:
                            for (var n = next || 0, nLen = _options.length; n < nLen; ++n) {
                                
                                if (
                                    _options[n] != null && typeof(_options[n].id) != 'undefined' && _options[n].id !== newTarget[a].id

                                ) {
                                
                                    if ( newTargetIds.indexOf(_options[n].id) == -1 ) {
                                        newTarget.push(_options[n]);
                                        newTargetIds.push(_options[n].id);

                                        next = n+1; 

                                        if (aLen < nLen)
                                            ++aLen;

                                        break end; 
                                    }
                                                                
                                } else if( _options[n] != null && typeof(_options[n].id) != 'undefined' && _options[n].id === newTarget[a].id ) {

                                    next = n+1;

                                } else {
                                    break end;
                                }
                            }
                    }

                    return newTarget


                } else { // normal case `arrays`
                    for (var a = 0; a < options.length; ++a ) {
                        if ( target.indexOf(options[a]) > -1 && override) {
                            target.splice(target.indexOf(options[a]), 1, options[a])
                        } else if ( typeof(newTarget[a]) == 'undefined' && typeof(options[a]) == 'object' ) {
                            // merge using index   
                            newTarget = target;

                            if (typeof (newTarget[a]) == 'undefined')
                                newTarget[a] = {};
                                                        
                                
                            for (var k in options[a]) {
                                if (!newTarget[a].hasOwnProperty(k)) {
                                    newTarget[a][k] = options[a][k]
                                }
                            }   
                            
                        } else {
                            if (
                                typeof (target[a]) != 'undefined'
                                && typeof (target[a].id) != 'undefined'
                                && typeof (options[a]) != 'undefined'
                                && typeof (options[a].id) != 'undefined'
                                && target[a].id == options[a].id
                            ) {
                                if (override)
                                    newTarget[a] = options[a]
                                else
                                    newTarget[a] = target[a]
                            } else if (newTarget.indexOf(options[a]) == -1) {
                                newTarget.push(options[a]);
                            }
                        }
                    }
                }


            }

            if ( newTarget.length > 0 && target.length > 0 || newTarget.length == 0 && target.length == 0  ) {
                return newTarget
            }
        }

        /**
         * Check if object before merging.
         * */
        var isObject = function (obj) {
            if (
                !obj
                || {}.toString.call(obj) !== '[object Object]'
                || obj.nodeType
                || obj.setInterval
            ) {
                return false
            }
    
            var hasOwn              = {}.hasOwnProperty;
            var hasOwnConstructor   = hasOwn.call(obj, 'constructor');
            // added test for node > v6
            var hasMethodPrototyped = ( typeof(obj.constructor) != 'undefined' ) ? hasOwn.call(obj.constructor.prototype, 'isPrototypeOf') : false;
    
    
            if (
                obj.constructor && !hasOwnConstructor && !hasMethodPrototyped
            ) {
                return false
            }
    
            //Own properties are enumerated firstly, so to speed up,
            //if last one is own, then all properties are own.
            var key;
            return key === undefined || hasOwn.call(obj, key)
        }

        return init
    }()

    filterArgs = function() {

        var setget = ( typeof(process.argv[2]) != 'undefined'
                            && /(\:set$|\:get$|[-v]|\:version$|[--version])/.test(process.argv[2]))
                            ? true : false
            , evar = '';

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
                    throw new Error('gina won\'t override protected env var [ ' +evar[0]+ ' ] or constant.')
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
                throw new Error(msg)
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
            process['gina'][key] !== ''
            ) {
            throw new Error('wont\'t override env var [ '+ key + ' ]')
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