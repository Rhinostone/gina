function Merge() {

    var newTarget           = []
        //, keyComparison     = 'id' // use for collections merging [{ id: 'val1' }, { id: 'val2' }, {id: 'val3' }, ...]
    ;
    
    
    /**
     *
     * @param {object} target - Target object
     * @param {object} source - Source object
     * @param {boolean} [override] - Override when copying
     *
     * @return {object} [result]
     * */
    var browse = function (target, source) {
        

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
                                    //clone = src && Array.isArray(src) ? src : [];
                                    if ( src && Array.isArray(src) ) {
                                        clone = src || []
                                    } else if ( isObject(src) ) {
                                        clone = src || {};
                                        target[ name ] = clone;
                                        continue
                                    } else {
                                        clone = []
                                    }

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

                                        // this does not work ... target is returned before the end of process.nextTick !!!
                                        // process.nextTick(function onBrowse() {
                                        //     target[name] = browse(clone, copy, override)
                                        // });

                                        // nextTickCalled = true;
                                        // process.nextTick(function onBrowse() {
                                        //     nextTickCalled = false;
                                        //     //target[ name ] = browse(clone, copy, override);
                                        //     return browse(clone, copy, override);
                                        // });


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
        
        
        
        // return { 
        //     'setKeyComparison' : function(key) {
        //         mergeArray.key = key;
        //         return target;
        //     }
        // } || target
            
        return target;

    }
    
    


    // Will not merge functions items: this is normal
    // Merging arrays is OK, but merging collections is still experimental        
    var mergeArray = function(options, target, override) {
        newTarget = [];
                
        
        var newTargetIds = [], keyComparison = browse.getKeyComparison();

        if (override) {

            // if collection, comparison will be done uppon the `id` attribute by default unless you call .setKeyComparison('someField')
            if (
                typeof(options[0]) == 'object' && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object' && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget = JSON.parse(JSON.stringify(target));
                for (var nt = 0, ntLen = newTarget.length; nt < ntLen; ++nt) {
                    newTargetIds.push(newTarget[nt][keyComparison]);
                }
                
                var _options    = JSON.parse(JSON.stringify(options));
                
                var index = 0;

                for (var n = next || 0, nLen = target.length; n < nLen; ++n) {
                    
                    // if (newTargetIds.indexOf(target[n][keyComparison]) == -1) {
                    //     newTargetIds.push(target[n][keyComparison]);
                        
                    //     //newTarget.push(target[n]);
                    //     //++index;
                    // }
                    
                    label:
                    for (var a = a || 0, aLen = _options.length; a < aLen; ++a) {
                    
                        if (_options[a][keyComparison] === target[n][keyComparison] ) {

                            if (newTargetIds.indexOf(_options[a][keyComparison]) > -1) {
                                
                                newTarget[index] = _options[a];
                                ++index
                                
                            } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {

                                newTargetIds.push(_options[a][keyComparison]);                                
                                //newTarget.push(_options[a]);
                                newTarget[index] = _options[a];
                                ++index
                            }

                            break label;
                            
                        } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {                            
                            
                            newTargetIds.push(_options[a][keyComparison]);
                            newTarget.push(_options[a]);
                        }
                    } // EO For
                }

                newTargetIds = [];

                return newTarget

            } else { // normal case `arrays` or merging from a blank collection
                return options
            }
        }

        if ( options.length == 0 &&  target.length > 0 ) {
            newTarget = target;
            return newTarget
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
                typeof(options[0]) != 'undefined' 
                && typeof (options[0]) == 'object' 
                && options[0] != null 
                && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object' 
                && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget       = JSON.parse(JSON.stringify(target));
                var _options    = JSON.parse(JSON.stringify(options));
                var next        = null;
                

                for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                    newTargetIds.push(newTarget[a][keyComparison]);
                }
                for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                    
                    end:
                        for (var n = next || 0, nLen = _options.length; n < nLen; ++n) {
                            
                            if (
                                _options[n] != null && typeof(_options[n][keyComparison]) != 'undefined' && _options[n][keyComparison] !== newTarget[a][keyComparison]

                            ) {
                            
                                if ( newTargetIds.indexOf(_options[n][keyComparison]) == -1 ) {
                                    newTarget.push(_options[n]);
                                    newTargetIds.push(_options[n][keyComparison]);

                                    next = n+1; 

                                    if (aLen < nLen)
                                        ++aLen;

                                    break end; 
                                }
                                                               
                            } else if( _options[n] != null && typeof(_options[n][keyComparison]) != 'undefined' && _options[n][keyComparison] === newTarget[a][keyComparison] ) {

                                next = n+1;

                                //break end;

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
                        // if (newTarget.indexOf(options[a]) == -1)
                        //     newTarget.push(options[a]);
                        
                        if (
                            typeof (target[a]) != 'undefined'
                            && typeof (target[a][keyComparison]) != 'undefined'
                            && typeof (options[a]) != 'undefined'
                            && typeof (options[a][keyComparison]) != 'undefined'
                            && target[a][keyComparison] == options[a][keyComparison]
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
    mergeArray.prototype.setKeyComparison = function(keyComparison) {
        this.keyComparison = keyComparison
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

    browse.setKeyComparison = function(keyComparison) {
        
        mergeArray.keyComparison = keyComparison;
        
        return browse
    }
    
    browse.getKeyComparison = function() {
        
        var keyComparison = mergeArray.keyComparison || 'id';
        
        // reset for the next merge
        mergeArray.keyComparison = 'id';
        
        return keyComparison
    }
    
    return browse

}

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Merge()
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( function() { return Merge() })
}