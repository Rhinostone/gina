/**
 * clone array
 *
 * @returns {array} Return cloned array
 * @supress {misplacedTypeAnnotation}
 **/
Object.defineProperty( Array.prototype, 'clone', {
    writable:   false,
    enumerable: false,
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    value: function(){ return this.slice(0); }
});


if ( typeof(JSON.clone) == 'undefined' ) {
    JSON.clone = require(__dirname + '/prototypes.json_clone');
}

if ( typeof(JSON.escape) == 'undefined' ) {
    /**
     * JSON.escape
     * Escape special characters
     *
     * Changes made here must be reflected in:
     *  - gina/utils/prototypes.js
     *  - gina/framework/version/helpers/prototypes.js
     *  - gina/framework/version/core/asset/plugin/src/vendor/gina/js/utils/polyfill.js
     *
     * @param {object} jsonStr
     *
     * @returns {object} escaped JSON string
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

Array.prototype.toString = function(){
    return this.join();
};


Object.defineProperty( Array.prototype, 'inArray', {
    writable:   false,
    enumerable: false,
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    value: function(o){ return this.indexOf(o)!=-1 }
});

/**
 * Object.prototype.count — the number of the receiver's own enumerable properties:
 * the keys of an object, the indices of an array.
 *
 * Each key is tested with the built-in `Object.prototype.hasOwnProperty`, reached
 * through `.call` (#B837). `this.hasOwnProperty(prop)` was an ordinary property
 * lookup: an own key of that name that is not a function (a request field named
 * `hasOwnProperty`) made the call throw on the first key, as did an object with no
 * prototype (`Object.create(null)`, `querystring.parse()`), and the catch returned
 * the count so far, 0.
 *
 * Changes made here must be reflected in:
 *  - gina/framework/version/helpers/prototypes.js (the copy the browser bundle carries)
 *
 * @returns {number} The number of own enumerable properties.
 * @example
 * ({ a: 1, b: 2 }).count();                                    // → 2
 * Object.prototype.count.call({ hasOwnProperty: 'x', a: 1 }); // → 2
 */
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
            // #B837 — the built-in own-key test, which no own key of the receiver can shadow
            // was: for (var prop in this) if (this.hasOwnProperty(prop)) ++i;
            for (var prop in this)
                if (Object.prototype.hasOwnProperty.call(this, prop)) ++i;

            return i;
        } catch (err) {
            return i
        }
    }
});

/**
 * Object.prototype.functionCount — the number of the receiver's own enumerable
 * properties whose value is a function.
 *
 * Each key is tested with the built-in `Object.prototype.hasOwnProperty`, reached
 * through `.call` (#B837): `this.hasOwnProperty(prop)` threw on an object with an own
 * `hasOwnProperty` key that is not a function and on an object with no prototype.
 *
 * @returns {number} The number of own enumerable function-valued properties.
 * @example
 * ({ a: function () {}, b: 1 }).functionCount();   // → 1
 */
Object.defineProperty( Object.prototype, 'functionCount', {
    writable:   true,
    enumerable: false,
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    value: function(){
        var self = this;
        if (this instanceof String) self = JSON.parse(this);
        var i = 0;
        // #B837 — the built-in own-key test, which no own key of the receiver can shadow
        // was: for (var prop in this) if (this.hasOwnProperty(prop) && typeof(this[prop]) == 'function') ++i;
        for (var prop in this)
            if (Object.prototype.hasOwnProperty.call(this, prop) && typeof(this[prop]) == 'function') ++i;

        return i;
    }
});

/**
 * __stack Get current stack
 * @returns {Object} stack Current stack
 *
 * @suppress {es5Strict}
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
        /** @suppress {es5Strict} */
        Error.captureStackTrace(err, arguments.callee);
        var stack = err.stack;
        Error.prepareStackTrace = orig;
        return stack;
    }
});



/**
 * __line Get current line number
 * @returns {Number} stack Current line number
 * */
Object.defineProperty(global, '__line', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        return __stack[1].getLineNumber();
    }
});


/**
 * __function Get current function name
 * @returns {String} function Current function name
 * */
Object.defineProperty(global, '__function', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        return __stack[1].getFunctionName();
    }
});

/**
 * __module Get current module name
 * @returns {String} module Current module name
 * */
Object.defineProperty(global, '__module', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        return __stack[1].getFunctionName().split('.')[0];
    }
});

/**
 * __filename Get current file path
 * @returns {String} stack Current file path
 * */
Object.defineProperty(global, '__filename', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        return __stack[1].getFileName();
    }
});

/**
 * __file Get current file name
 * @returns {Integer} stack Current file name
 * */
Object.defineProperty(global, '__file', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        var filename = __stack[1].getFileName();
        if (filename) {
            return filename.split(/[\\/]/)[filename.length-1];
        }
        return filename
    }
});

/**
 * __column Get current column number
 * @returns {Integer} stack Current column number
 * */
Object.defineProperty(global, '__column', {
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    get: function() {
        return  __stack[1].getColumnNumber();
    }
});



// remove this ... in conflict with lodash
//Object.defineProperty( Object.prototype, 'toArray', {
//    writable:   true,
//    enumerable: false,
//    //If loaded several times, it can lead to an exception. That's why I put this.
//    configurable: true,
//    value: function(force) {
//        var arr = [],i = 0;
//        for (var prop in this) {
//            if ( this.hasOwnProperty(prop) ) {
//                if (force) {
//                    arr[i] = this[prop]
//                } else {
//                    arr[prop] = this[prop]
//                }
//                ++i
//            }
//        }
//        return arr
//    }
//});
// remove this ... in conflict with lodash
///**
// * String.toArray() Convert string path to array
// * @param {String} delimiter Delimiter caracter for implode
// * @returns {Array} array Imploded Array
// * */
//String.prototype.toArray = function(delimiter) {
//    if (typeof(delimiter) != "undefined") {
//        var str = this.toString(), reg = new RegExp(delimiter, "g");
//        //Removing delimiter at the begining & at the end.
//        if (str.substring(str.length-1) == delimiter)
//            str = str.substring(0, str.length-1);
//        if (str.substring(0,1) == delimiter) str = str.substring(1);
//
//        return str.split(reg);
//    }
//};
