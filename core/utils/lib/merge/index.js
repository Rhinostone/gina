function Merge() {
    var newTarget = [];
    /**
     *
     * @param {object} target - Target object
     * @param {object} source - Source object
     * @param {boolean} [override] - Override when copying
     *
     * @return {object} [result]
     * */
    var browse = function (target, source) {

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

            for (; i < length; i++) {
                // Only deal with non-null/undefined values
                if ( typeof(arguments[i]) != 'boolean' && ( options = arguments[i]) != null) {
                    if ( typeof(options) != 'object') {
                       target = options;
                       break;
                    }

                    // both target & options are arrays
                    if ( Array.isArray(options) && Array.isArray(target) ) {


                        target = mergeArray(options, target, override);

                        // for (var a = 0; a < options.length; ++a ) {
                        //     if ( target.indexOf(options[a]) > -1 && override) {
                        //         target.splice(target.indexOf(options[a]), 1, options[a])
                        //     } else {
                        //         if (newTarget.indexOf(options[a]) == -1)
                        //             newTarget.push(options[a]);
                        //     }
                        // }
                        //
                        //  if (newTarget.length > 0 && target.length > 0) {
                        //      target = newTarget
                        //  }
                    } else {
                        // Merge the base object
                        for (var name in options) {

                            src     = target[ name ];
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
                                            clone[ prop ] = copy[ prop ] // don't override existing
                                        }
                                    }



                                    // Never move original objects, clone them
                                    if (typeof(src) != "boolean" && !createMode ) {//if property is not boolean
                                        //target[ name ] = browse(clone, copy, override)
                                        process.nextTick(function onBrowse() {
                                            target[ name ] = browse(clone, copy, override)
                                        });

                                    } else if (createMode) {
                                        target[ name ] = clone;
                                    }

                                } else {

                                    for (var prop in copy) {
                                        if ( typeof(copy[ prop ]) != 'undefined' ) {
                                            clone[prop] = copy[prop]
                                        }
                                    }

                                    target[ name ] = clone
                                }

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

        }

        return target
    }

    var mergeArray = function(options, target, override) {
        if (override) {
            newTarget = options;
            return newTarget
        }
        for (var a = 0; a < options.length; ++a ) {
            if ( target.indexOf(options[a]) > -1 && override) {
                target.splice(target.indexOf(options[a]), 1, options[a])
            } else {
                if (newTarget.indexOf(options[a]) == -1)
                    newTarget.push(options[a]);
            }
        }

        if (newTarget.length > 0 && target.length > 0) {
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

    return browse
}

module.exports = Merge()