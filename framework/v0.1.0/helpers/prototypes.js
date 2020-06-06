function PrototypesHelper(instance) {
    
    var local = instance || null;    
    
    // dateFormat proto
    if ( typeof(local) != 'undefined' && typeof(local.dateFormat) != 'undefined' ) {
        for (let method in local.dateFormat) {
            
            if ( typeof(Date[method]) != 'undefined' )
                continue;
            
            //console.log('----> ', method);
            
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
            value: function(){ return this.slice(0) }
        });
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
    