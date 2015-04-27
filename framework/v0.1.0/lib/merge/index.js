function Merge() {
    /**
     *
     * @param {boolean} [override] - Override when copying
     * @param {object} target - Target object
     * @param {object} source - Source object
     *
     * @return {object} [result]
     * */
    var init = browse = function () {
        var target = arguments[0] || (Array.isArray(arguments[1]) ? [] : {});
        var i = 1;
        var length = arguments.length;
        var override = false;
        var options, name, src, copy, copyIsArray, clone;

        // Handle an override copy situation
        if (typeof(target) === 'boolean') {
            override = target;
            target = arguments[1] ||  (Array.isArray(arguments[1]) ? [] : {});
            // skip the boolean and the target
            i = 2
        }

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
            for (; i < length; i++) {
                // Only deal with non-null/undefined values
                if (( options = arguments[i]) != null) {
                    if ( typeof(options) != 'object') {
                        target = options;
                        break;
                    }
                    // Merge the base object
                    for (var name in options) {
                        src = target[ name ];
                        copy = options[ name ];


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

                            if (copyIsArray) {
                                copyIsArray = false;
                                clone = src && Array.isArray(src) ? src : []
                            } else {
                                clone = src && isObject(src) ? src : {}
                            }

                            //[propose] Supposed to go deep... deep... deep...
                            if (!override) {
                                for (var prop in copy) {
                                    if (typeof(clone[ prop ]) != "undefined") {
                                        copy[ prop ] = clone[ prop ];
                                    }
                                }

                            } else {
                                for (var prop in copy) {
                                    if (typeof(clone[ prop ]) != "undefined") {
                                        clone[ prop ] = copy[ prop ]
                                    }
                                }
                            }

                            // Never move original objects, clone them
                            if (typeof(src) != "boolean") {//if property is not boolean
                                target[ name ] = browse(override, clone, copy)
                            }
                            // Don't bring in undefined values
                        } else if (copy !== undefined) {
                            //[propose]Don't override existing if prop defined or override @ false
                            if (
                                typeof(src) != "undefined"
                                && src != copy && !override
                            ) {
                                target[ name ] = src
                            } else {
                                target[ name ] = copy
                            }

                        }
                    }
                }
            }
        }


        // Return the modified object
        return target
    }

    /**
     * Check if object before merging.
     * */
    var isObject = function (obj) {
        if (
            !obj ||
            {}.toString.call(obj) !== '[object Object]' ||
            obj.nodeType ||
            obj.setInterval
        ) {
            return false
        }

        var hasOwn = {}.hasOwnProperty;
        var hasOwnConstructor = hasOwn.call(obj, 'constructor');
        var hasMethodPrototyped = hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');


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
}

module.exports = Merge()