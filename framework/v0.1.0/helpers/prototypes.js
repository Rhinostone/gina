function PrototypesHelper(instance) {
    
    var local = instance || null;    
    
    // dateFormat proto
    if ( typeof(local) != 'undefined' && typeof(local.dateFormat) != 'undefined' ) {
        for (let method in local.dateFormat) {
            
            if ( typeof(Date[method]) != 'undefined' )
                continue;
            
            Object.defineProperty( Date.prototype, method, {
                writable:   false,
                enumerable: false,
                //If loaded several times, it can lead to an exception. That's why I put this.
                configurable: true,
                value: function() { 
                    
                    var newArgs = { 0: this }, i = 1;
                    for (var a in arguments) {
                        newArgs[i] = arguments[a];
                        ++i
                    }
                    newArgs.length = i;
                    // don't touch this, we need the name
                    const name = method;
                    
                    return local.dateFormat[name].apply(this, newArgs );
                }
            });
            
        }
    }

    if ( typeof(Array.clone) == 'undefined' ) {
        /**
         * clone array
         * @return {array} Return cloned array
         **/
        Object.defineProperty( Array.prototype, 'clone', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(){ return this.slice(0); }
        });
    }
    
    if ( typeof(JSON.clone) == 'undefined' ) {
        /**
         * JSON.clone
         * Clone JSON object
         * 
         * Changes made here must be reflected in: 
         *  - gina/utils/prototypes.js
         *  - gina/framework/version/helpers/prototypes.js
         *  - gina/framework/version/core/asset/js/plugin/src/gina/utils/polyfill.js
         * 
         * @param {object} source
         * @param {object} [target]
         * 
         * @return {object} cloned JSON object
         **/
        var clone = function(source, target) {
            if (source == null || typeof source != 'object') return source;
            if (source.constructor != Object && source.constructor != Array) return source;
            if (source.constructor == Date || source.constructor == RegExp || source.constructor == Function ||
                source.constructor == String || source.constructor == Number || source.constructor == Boolean)
                return new source.constructor(source);

            target = target || new source.constructor();
            var i       = 0
                , len   = Object.getOwnPropertyNames(source).length || 0
                , keys  = Object.keys(source)
            ;
            
            while (i<len) {
                target[keys[i]] = (typeof target[keys[i]] == 'undefined') ? clone(source[keys[i]], null) : target[keys[i]];
                i++;
            }
            i = null; len = null; keys = null;

            return target;
        };
        
        
        
        // WHY NOT USE SOMETHING ELSE ?
        // Could have been fine, but not working when you have references pointg to another object
        // return Object.assign({}, source);
        // var clone = function(source, target) {
        //     return Object.assign(target||{}, source);
        // };
        
        // Performences issue
        //return JSON.parse(JSON.stringify(source));
        // var clone = function(source) {
        //     return JSON.parse(JSON.stringify(source));
        // };
        
        JSON.clone = clone;
        
    }
    
    if ( typeof(JSON.escape) == 'undefined' ) {
        /**
         * JSON.escape
         * Escape special characters
         * 
         * Changes made here must be reflected in: 
         *  - gina/utils/prototypes.js
         *  - gina/framework/version/helpers/prototypes.js
         *  - gina/framework/version/core/asset/js/plugin/src/gina/utils/polyfill.js
         * 
         * @param {object} jsonStr
         * 
         * @return {object} escaped JSON string
         **/
         var escape = function(jsonStr){
            try {
                return jsonStr
                           .replace(/\n/g, "\\n")
                           .replace(/\r/g, "\\r")
                           .replace(/\t/g, "\\t")
                       ;
            } catch (err) {         
               throw err;
            }
        };
        
        JSON.escape = escape;
    }
        

    if ( typeof(Array.toString) == 'undefined' ) {
        Array.prototype.toString = function(){
            return this.join();
        };
    }

    if ( typeof(Array.inArray) == 'undefined' ) {
        Object.defineProperty( Array.prototype, 'inArray', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(o){ return this.indexOf(o)!=-1 }
        });
    }
        
    if ( typeof(Array.from) == 'undefined' ) { // if not under ES6

        Object.defineProperty( Array.prototype, 'from', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(a){
                var seen    = {}
                    , out   = []
                    , len   = a.length
                    , j     = 0;

                for(var i = 0; i < len; i++) {
                    var item = a[i];
                    if(seen[item] !== 1) {
                        seen[item] = 1;
                        out[j++] = item
                    }
                }

                return out
            }
        });
    }
    
    if ( typeof(Object.count) == 'undefined' ) {
        Object.defineProperty( Object.prototype, 'count', {
            writable:   true,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(){
                try {
                    var self = this;
                    if (this instanceof String) self = JSON.parse(this);
                    var i = 0;
                    for (var prop in this)
                        if (this.hasOwnProperty(prop)) ++i;

                    return i;
                } catch (err) {
                    return i
                }

            }
        });
    }        

    
        
    if ( typeof(global) != 'undefined' && typeof(global.__stack) == 'undefined' ) {
        /**
         * __stack Get current stack
         * @return {Object} stack Current stack
         **/
        Object.defineProperty(global, '__stack', {
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            get: function(){
                var orig = Error.prepareStackTrace;
                Error.prepareStackTrace = function(_, stack){
                    return stack;
                };
                var err = new Error;
                Error.captureStackTrace(err, arguments.callee);
                var stack = err.stack;
                Error.prepareStackTrace = orig;
                return stack;
            }
        });
    }
    
    
}

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = PrototypesHelper
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( function() { return PrototypesHelper })
}
    