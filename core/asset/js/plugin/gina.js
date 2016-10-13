/**
 * @revision 2016-07-02 10:05PM
 * In order to use Source Map, put this on top of the compiled script:
 * # sourceMappingURL=gina.min.js.map
 * */
var gina = ( function onInit() {

    /**
     * Imports & definitions
     * */

    var jQuery = (window['jQuery']) ? window['jQuery'] : null;

    if (!window.process ) {
        (function(window, nextTick, process, prefixes, i, p, fnc) {
            p = window[process] || (window[process] = {});
            while (!fnc && i < prefixes.length) {
                fnc = window[prefixes[i++] + 'equestAnimationFrame'];
            }
            p[nextTick] = p[nextTick] || (fnc && fnc.bind(window)) || window.setImmediate || window.setTimeout;
        })(window, 'nextTick', 'process', 'r webkitR mozR msR oR'.split(' '), 0);
    }

    if (!window.getComputedStyle) {
        /**
         * Returns the roster widget element.
         * @this {Window}
         * @return {ComputedStyle}
         */

        window.getComputedStyle = function(el, pseudo) {
            this.el = el;
            this.getPropertyValue = function(prop) {
                var re = /(\-([a-z]){1})/g;
                if (prop == 'float') {
                    prop = 'styleFloat'
                }
                if (re.test(prop)) {
                    prop = prop.replace(re, function () {
                        return arguments[2].toUpperCase()
                    })
                }
                return el.currentStyle[prop] ? el.currentStyle[prop] : null
            }
            return this
        }
    }

    //     uuid.js
    //
    //     Copyright (c) 2010-2012 Robert Kieffer
    //     MIT License - http://opensource.org/licenses/mit-license.php

    /*global window, require, define */
    (function(_window) {
        'use strict';

        // Unique ID creation requires a high quality random # generator.  We feature
        // detect to determine the best RNG source, normalizing to a function that
        // returns 128-bits of randomness, since that's what's usually required
        var _rng, _mathRNG, _nodeRNG, _whatwgRNG, _previousRoot;

        function setupBrowser() {
            // Allow for MSIE11 msCrypto
            var _crypto = _window.crypto || _window.msCrypto;

            if (!_rng && _crypto && _crypto.getRandomValues) {
                // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
                //
                // Moderately fast, high quality
                try {
                    var _rnds8 = new Uint8Array(16);
                    _whatwgRNG = _rng = function whatwgRNG() {
                        _crypto.getRandomValues(_rnds8);
                        return _rnds8;
                    };
                    _rng();
                } catch(e) {}
            }

            if (!_rng) {
                // Math.random()-based (RNG)
                //
                // If all else fails, use Math.random().  It's fast, but is of unspecified
                // quality.
                var  _rnds = new Array(16);
                _mathRNG = _rng = function() {
                    for (var i = 0, r; i < 16; i++) {
                        if ((i & 0x03) === 0) { r = Math.random() * 0x100000000; }
                        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
                    }

                    return _rnds;
                };
                if ('undefined' !== typeof console && console.warn) {
                    console.warn("[SECURITY] node-uuid: crypto not usable, falling back to insecure Math.random()");
                }
            }
        }

        function setupNode() {
            // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
            //
            // Moderately fast, high quality
            if ('function' === typeof require) {
                try {
                    var _rb = require('crypto').randomBytes;
                    _nodeRNG = _rng = _rb && function() {return _rb(16);};
                    _rng();
                } catch(e) {}
            }
        }

        if (_window) {
            setupBrowser();
        } else {
            setupNode();
        }

        // Buffer class to use
        var BufferClass = ('function' === typeof Buffer) ? Buffer : Array;

        // Maps for number <-> hex string conversion
        var _byteToHex = [];
        var _hexToByte = {};
        for (var i = 0; i < 256; i++) {
            _byteToHex[i] = (i + 0x100).toString(16).substr(1);
            _hexToByte[_byteToHex[i]] = i;
        }

        // **`parse()` - Parse a UUID into it's component bytes**
        function parse(s, buf, offset) {
            var i = (buf && offset) || 0, ii = 0;

            buf = buf || [];
            s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
                if (ii < 16) { // Don't overflow!
                    buf[i + ii++] = _hexToByte[oct];
                }
            });

            // Zero out remaining bytes if string was short
            while (ii < 16) {
                buf[i + ii++] = 0;
            }

            return buf;
        }

        // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
        function unparse(buf, offset) {
            var i = offset || 0, bth = _byteToHex;
            return  bth[buf[i++]] + bth[buf[i++]] +
                bth[buf[i++]] + bth[buf[i++]] + '-' +
                bth[buf[i++]] + bth[buf[i++]] + '-' +
                bth[buf[i++]] + bth[buf[i++]] + '-' +
                bth[buf[i++]] + bth[buf[i++]] + '-' +
                bth[buf[i++]] + bth[buf[i++]] +
                bth[buf[i++]] + bth[buf[i++]] +
                bth[buf[i++]] + bth[buf[i++]];
        }

        // **`v1()` - Generate time-based UUID**
        //
        // Inspired by https://github.com/LiosK/UUID.js
        // and http://docs.python.org/library/uuid.html

        // random #'s we need to init node and clockseq
        var _seedBytes = _rng();

        // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
        var _nodeId = [
            _seedBytes[0] | 0x01,
            _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
        ];

        // Per 4.2.2, randomize (14 bit) clockseq
        var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

        // Previous uuid creation time
        var _lastMSecs = 0, _lastNSecs = 0;

        // See https://github.com/broofa/node-uuid for API details
        function v1(options, buf, offset) {
            var i = buf && offset || 0;
            var b = buf || [];

            options = options || {};

            var clockseq = (options.clockseq != null) ? options.clockseq : _clockseq;

            // UUID timestamps are 100 nano-second units since the Gregorian epoch,
            // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
            // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
            // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
            var msecs = (options.msecs != null) ? options.msecs : new Date().getTime();

            // Per 4.2.1.2, use count of uuid's generated during the current clock
            // cycle to simulate higher resolution clock
            var nsecs = (options.nsecs != null) ? options.nsecs : _lastNSecs + 1;

            // Time since last uuid creation (in msecs)
            var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

            // Per 4.2.1.2, Bump clockseq on clock regression
            if (dt < 0 && options.clockseq == null) {
                clockseq = clockseq + 1 & 0x3fff;
            }

            // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
            // time interval
            if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
                nsecs = 0;
            }

            // Per 4.2.1.2 Throw error if too many uuids are requested
            if (nsecs >= 10000) {
                throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
            }

            _lastMSecs = msecs;
            _lastNSecs = nsecs;
            _clockseq = clockseq;

            // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
            msecs += 12219292800000;

            // `time_low`
            var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
            b[i++] = tl >>> 24 & 0xff;
            b[i++] = tl >>> 16 & 0xff;
            b[i++] = tl >>> 8 & 0xff;
            b[i++] = tl & 0xff;

            // `time_mid`
            var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
            b[i++] = tmh >>> 8 & 0xff;
            b[i++] = tmh & 0xff;

            // `time_high_and_version`
            b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
            b[i++] = tmh >>> 16 & 0xff;

            // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
            b[i++] = clockseq >>> 8 | 0x80;

            // `clock_seq_low`
            b[i++] = clockseq & 0xff;

            // `node`
            var node = options.node || _nodeId;
            for (var n = 0; n < 6; n++) {
                b[i + n] = node[n];
            }

            return buf ? buf : unparse(b);
        }

        // **`v4()` - Generate random UUID**

        // See https://github.com/broofa/node-uuid for API details
        function v4(options, buf, offset) {
            // Deprecated - 'format' argument, as supported in v1.2
            var i = buf && offset || 0;

            if (typeof(options) === 'string') {
                buf = (options === 'binary') ? new BufferClass(16) : null;
                options = null;
            }
            options = options || {};

            var rnds = options.random || (options.rng || _rng)();

            // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
            rnds[6] = (rnds[6] & 0x0f) | 0x40;
            rnds[8] = (rnds[8] & 0x3f) | 0x80;

            // Copy bytes to buffer, if provided
            if (buf) {
                for (var ii = 0; ii < 16; ii++) {
                    buf[i + ii] = rnds[ii];
                }
            }

            return buf || unparse(rnds);
        }

        // Export public API
        var uuid = v4;
        uuid.v1 = v1;
        uuid.v4 = v4;
        uuid.parse = parse;
        uuid.unparse = unparse;
        uuid.BufferClass = BufferClass;
        uuid._rng = _rng;
        uuid._mathRNG = _mathRNG;
        uuid._nodeRNG = _nodeRNG;
        uuid._whatwgRNG = _whatwgRNG;

        if (('undefined' !== typeof module) && module.exports) {
            // Publish as node.js module
            module.exports = uuid;
        } else if (typeof define === 'function' && define.amd) {
            // Publish as AMD module
            define('uuid', function() { return uuid;});

        } else {
            // Publish as global (in browsers)
            _previousRoot = _window.uuid;

            // **`noConflict()` - (browser only) to reset global 'uuid' var**
            uuid.noConflict = function() {
                _window.uuid = _previousRoot;
                return uuid;
            };

            _window.uuid = uuid;
        }
    })('undefined' !== typeof window ? window : null);

    // EO uuid

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

            if ( typeof(target) == 'undefined' /**|| Array.isArray(target) && !target.length */) {
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
                                        typeof(src) != "undefined"
                                        && src !== copy && !override
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

            newTarget = [];
            return target
        }

        // Will not merge functions items: this is normal
        var mergeArray = function(options, target, override) {
            if (override) {
                newTarget = options;
                return newTarget
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
                    if ( typeof(target[a]) != 'object' && newTarget.indexOf(target[a]) == -1)
                        newTarget.push(target[a]);
                }
            }

            if ( target.length > 0 ) {

                for (var a = 0; a < options.length; ++a ) {
                    if ( target.indexOf(options[a]) > -1 && override) {
                        target.splice(target.indexOf(options[a]), 1, options[a])
                    } else {
                        if (newTarget.indexOf(options[a]) == -1)
                            newTarget.push(options[a]);
                    }
                }
            }

            if (newTarget.length > 0 && target.length > 0 ) {
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

    // function Merge() {
    //     var newTarget = [];
    //     /**
    //      *
    //      * @param {object} target - Target object
    //      * @param {object} source - Source object
    //      * @param {boolean} [override] - Override when copying
    //      *
    //      * @return {object} [result]
    //      * */
    //     var browse = function (target, source) {
    //
    //         var override = false;
    //         if (( typeof(arguments[arguments.length-1]) == 'boolean' )) {
    //             override = arguments[arguments.length-1]
    //         }
    //
    //         var i = 1;
    //         var length = arguments.length;
    //
    //         var options, name, src, copy, copyIsArray, clone;
    //
    //
    //         // Handle case when target is a string or something (possible in deep copy)
    //         if (typeof(target) !== 'object' && typeof(target) !== 'function') {
    //             if (override) {
    //                 if (typeof(arguments[2]) == 'undefined') {
    //                     target = arguments[1]
    //                 } else {
    //                     target = arguments[2]
    //                 }
    //             } else {
    //                 if (typeof(arguments[0]) == 'undefined') {
    //                     target = arguments[1]
    //                 } else {
    //                     target = arguments[0]
    //                 }
    //             }
    //
    //         } else {
    //
    //             for (; i < length; i++) {
    //                 // Only deal with non-null/undefined values
    //                 if ( typeof(arguments[i]) != 'boolean' && ( options = arguments[i]) != null) {
    //                     if ( typeof(options) != 'object') {
    //                         target = options;
    //                         break;
    //                     }
    //                     // both target & options are arrays
    //                     if ( Array.isArray(options) && Array.isArray(target) ) {
    //
    //                         for (var a = 0; a < options.length; ++a ) {
    //                             if ( target.indexOf(options[a]) > -1 && override) {
    //                                 target.splice(target.indexOf(options[a]), 1, options[a])
    //                             } else if (target.indexOf(options[a]) == -1) {
    //                                 // required to keep keys in the dependancy order
    //                                 // !!! don't change this !!!
    //                                 if (newTarget.indexOf(options[a]) == -1)
    //                                     newTarget.push(options[a]);
    //                             }
    //                         }
    //
    //                         if (newTarget.length > 0 && target.length > 0) {
    //                             target = newTarget
    //                         }
    //                     } else {
    //                         // Merge the base object
    //                         for (var name in options) {
    //
    //                             src     = target[ name ];
    //                             copy    = options[ name ];
    //
    //
    //                             // Prevent never-ending loop
    //                             if (target === copy) {
    //                                 continue
    //                             }
    //
    //                             // Recurse if we're merging plain objects or arrays
    //                             if (
    //                                 copy
    //                                 && (
    //                                     isObject(copy) ||
    //                                     ( copyIsArray = Array.isArray(copy) )
    //                                 )
    //                             ) {
    //
    //                                 var createMode = false;
    //                                 if (copyIsArray) {
    //                                     copyIsArray = false;
    //                                     clone = src && Array.isArray(src) ? src : []
    //                                 } else {
    //
    //                                     clone = src && isObject(src) ? src : null;
    //
    //                                     if (!clone) {
    //                                         createMode = true;
    //                                         clone = {};
    //                                         // copy props
    //                                         for (var prop in copy) {
    //                                             clone[prop] = copy[prop]
    //                                         }
    //                                     }
    //                                 }
    //
    //
    //
    //                                 //[propose] Supposed to go deep... deep... deep...
    //                                 if (!override) {
    //                                     // add those in copy not in clone (target)
    //                                     for (var prop in copy) {
    //                                         if (typeof(clone[ prop ]) == 'undefined') {
    //                                             clone[ prop ] = copy[ prop ] // don't override existing
    //                                         }
    //                                     }
    //
    //
    //
    //
    //                                     // Never move original objects, clone them
    //                                     if (typeof(src) != "boolean" && !createMode) {//if property is not boolean
    //                                         //target[ name ] = browse(clone, copy, override)
    //                                         process.nextTick(function onBrowse() {
    //                                             target[ name ] = browse(clone, copy, override)
    //                                         });
    //
    //                                     } else if (createMode) {
    //                                         target[ name ] = clone
    //                                     }
    //
    //                                 } else {
    //
    //                                     for (var prop in copy) {
    //                                         if ( typeof(copy[ prop ]) != 'undefined' ) {
    //                                             clone[prop] = copy[prop]
    //                                         }
    //                                     }
    //
    //                                     target[ name ] = clone
    //                                 }
    //
    //                                 // // Never move original objects, clone them
    //                                 // if (typeof(src) != "boolean") {//if property is not boolean
    //                                 //     target[ name ] = browse(clone, copy, override)
    //                                 // }
    //
    //                             } else if (copy !== undefined) {
    //                                 //[propose]Don't override existing if prop defined or override @ false
    //                                 if (
    //                                     typeof(src) != "undefined"
    //                                     && src !== copy && !override
    //                                 ) {
    //                                     target[ name ] = src
    //                                 } else {
    //                                     target[ name ] = copy
    //                                 }
    //
    //                             }
    //                         }
    //                     }
    //                 }
    //
    //             }
    //
    //             //return target
    //         }
    //
    //         return target
    //
    //     }
    //
    //     /**
    //      * Check if object before merging.
    //      * */
    //     var isObject = function (obj) {
    //         if (
    //             !obj
    //             || {}.toString.call(obj) !== '[object Object]'
    //             || obj.nodeType
    //             || obj.setInterval
    //         ) {
    //             return false
    //         }
    //
    //         var hasOwn = {}.hasOwnProperty;
    //         var hasOwnConstructor = hasOwn.call(obj, 'constructor');
    //         var hasMethodPrototyped = hasOwn.call(obj.constructor.prototype, 'isPrototypeOf');
    //
    //
    //         if (
    //             obj.constructor && !hasOwnConstructor && !hasMethodPrototyped
    //         ) {
    //             return false
    //         }
    //
    //         //Own properties are enumerated firstly, so to speed up,
    //         //if last one is own, then all properties are own.
    //         var key;
    //         return key === undefined || hasOwn.call(obj, key)
    //     }
    //
    //     return browse
    // } // EO Merge()


    function DateFormatHelper() {

        var self = {};

        self['masks'] = {
            'default':      "ddd mmm dd yyyy HH:MM:ss",
            'shortDate':      "m/d/yy",
            'mediumDate':     "mmm d, yyyy",
            'longDate':       "mmmm d, yyyy",
            'fullDate':       "dddd, mmmm d, yyyy",
            'shortTime':      "h:MM TT",
            'mediumTime':     "h:MM:ss TT",
            'longTime':       "h:MM:ss TT Z",
            'isoDate':        "yyyy-mm-dd",
            'isoTime':        "HH:MM:ss",
            'isoDateTime':    "yyyy-mm-dd'T'HH:MM:ss",
            'isoUtcDateTime': "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
        };

        self['i18n'] = {
            'dayNames': [
                "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
                "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
            ],
            'monthNames': [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
            ]
        };

        var format = function(date, mask, utc) {
            var dF = self;

            var	token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
                timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
                timezoneClip = /[^-+\dA-Z]/g,
                pad = function (val, len) {
                    val = String(val);
                    len = len || 2;
                    while (val.length < len) val = "0" + val;
                    return val;
                };

            // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
            if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
                mask = date;
                date = undefined;
            }

            // Passing date through Date applies Date.parse, if necessary
            date = date ? new Date(date) : new Date;
            if (isNaN(date)) throw SyntaxError("invalid date");

            mask = String(dF.masks[mask] || mask || dF.masks["default"]);

            // Allow setting the utc argument via the mask
            if (mask.slice(0, 4) == "UTC:") {
                mask = mask.slice(4);
                utc = true;
            }

            var	_ = utc ? "getUTC" : "get",
                d = date[_ + "Date"](),
                D = date[_ + "Day"](),
                m = date[_ + "Month"](),
                y = date[_ + "FullYear"](),
                H = date[_ + "Hours"](),
                M = date[_ + "Minutes"](),
                s = date[_ + "Seconds"](),
                L = date[_ + "Milliseconds"](),
                o = utc ? 0 : date.getTimezoneOffset(),
                flags = {
                    'd':    d,
                    'dd':   pad(d),
                    'ddd':  dF.i18n.dayNames[D],
                    'dddd': dF.i18n.dayNames[D + 7],
                    'm':    m + 1,
                    'mm':   pad(m + 1),
                    'mmm':  dF.i18n.monthNames[m],
                    'mmmm': dF.i18n.monthNames[m + 12],
                    'yy':   String(y).slice(2),
                    'yyyy': y,
                    'h':    H % 12 || 12,
                    'hh':   pad(H % 12 || 12),
                    'H':    H,
                    'HH':   pad(H),
                    'M':    M,
                    'MM':   pad(M),
                    's':    s,
                    'ss':   pad(s),
                    'l':    pad(L, 3),
                    'L':    pad(L > 99 ? Math.round(L / 10) : L),
                    't':    H < 12 ? "a"  : "p",
                    'tt':   H < 12 ? "am" : "pm",
                    'T':    H < 12 ? "A"  : "P",
                    'TT':   H < 12 ? "AM" : "PM",
                    'Z':    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
                    'o':    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
                    'S':    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
                };



            return mask.replace(token, function ($0) {
                return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
            });
        }


        /**
         *  Count days from the current date to another
         *
         *  TODO - add a closure to `ignoreWeekend()` based on Utils::Validator
         *  TODO - add a closure to `ignoreFromList(array)` based on Utils::Validator
         *
         *  @param {object} dateTo
         *  @return {number} count
         * */
        var countDaysTo = function(date, dateTo) {

            if ( dateTo instanceof Date ) {
                // The number of milliseconds in one day
                var oneDay = 1000 * 60 * 60 * 24

                // Convert both dates to milliseconds
                var date1Ms = date.getTime()
                var date2Ms = dateTo.getTime()

                // Calculate the difference in milliseconds
                var count = Math.abs(date1Ms - date2Ms)

                // Convert back to days and return
                return Math.round(count/oneDay);
            } else {
                throw new Error('dateTo is not instance of Date() !')
            }
        }

        /**
         *  Will give an array of dates between the current date to a targeted date
         *
         *  TODO - add a closure to `ignoreWeekend()` based on Utils::Validator
         *  TODO - add a closure to `ignoreFromList(array)` based on Utils::Validator
         *
         *  @param {object} dateTo
         *  @param {string} [ mask ]
         *
         *  @return {array} dates
         * */
        var getDaysTo = function(date, dateTo, mask) {

            if ( dateTo instanceof Date) {
                var count       = countDaysTo(date, dateTo)
                    , month     = date.getMonth()
                    , year      = date.getFullYear()
                    , day       = date.getDate() + 1
                    , dateObj   = new Date(year, month, day)
                    , days      = []
                    , i         = 0;

                for (; i < count; ++i) {
                    if ( typeof(mask) != 'undefined' ) {
                        days.push(new Date(dateObj).format(mask));
                    } else {
                        days.push(new Date(dateObj));
                    }

                    dateObj.setDate(dateObj.getDate() + 1);
                }

                return days || [];
            } else {
                throw new Error('dateTo is not instance of Date() !')
            }
        }

        var getDaysInMonth = function(date) {
            var month   = date.getMonth();
            var year    = date.getFullYear();
            var dateObj = new Date(year, month, 1);
            var days = [];
            while (dateObj.getMonth() === month) {
                days.push(new Date(dateObj));
                dateObj.setDate(dateObj.getDate() + 1);
            }
            return days;
        }

        /**
         * Add or subtract hours
         *  Adding 2 hours
         *      => myDate.addHours(2)
         *  Subtracting 10 hours
         *      => myDate.addHours(-10)
         * */
        var addHours = function(date, h) {
            var copiedDate = new Date(date.getTime());
            copiedDate.setHours(copiedDate.getHours()+h);
            return copiedDate;
        }

        return {
            'format'          : format,
            'countDaysTo'     : countDaysTo,
            'getDaysTo'       : getDaysTo,
            'getDaysInMonth'  : getDaysInMonth,
            'addHours'        : addHours
        }

    }// EO DateFormatHelper

    /**
     * FormValidator
     *
     * @param {object} data
     * @param {object} [ $fields ]
     * @param {object} [ $form ]
     * */
    function FormValidator(data, $fields) {

        var local = {
            'errors': {},
            'keys': {
                '%l': 'label', // %l => label: needs `data-label` attribute (frontend only)
                '%n': 'name', // %n => field name
                '%s': 'size' // %s => length
            },
            'errorLabels': {},
            'data': {} // output to send
        };

        local.errorLabels = {
            'is': 'Condition not satisfied',
            'isEmail': 'A valid email is required',
            'isRequired': 'Cannot be left empty',
            'isBoolean': 'Must be a valid boolean',
            'isNumber': 'Must be a number',
            'isNumberLength': 'Must contain %s characters',
            'isNumberMinLength': 'Should be at least %s characters',
            'isNumberMaxLength': 'Should not be more than %s characters',
            'isInteger': 'Must be an integer',
            'isIntegerLength': 'Must have %s characters',
            'isIntegerMinLength': 'Should be at least %s characters',
            'isIntegerMaxLength': 'Should not be more than %s characters',
            'toInteger': 'Could not be converted to integer',
            'isFloat': 'Must be a proper float',
            'isFloatException': 'Float exception found: %n',
            'toFloat': 'Could not be converted to float',
            'toFloatNAN': 'Value must be a valid number',
            'isDate': 'Must be a valid Date',
            'isString': 'Must be a string',
            'isStringLength': 'Must have %s characters',
            'isStringMinLength': 'Should be at least %s characters',
            'isStringMaxLength': 'Should not be more than %s characters'
        };

        if (!data) {
            throw new Error('missing data param')
        } else {
            // cloning
            var self  = JSON.parse( JSON.stringify(data) );
            local.data = JSON.parse( JSON.stringify(data) )
        }


        var val = null, label = null;
        for (var el in self) {

            if ( typeof(self[el]) == 'object' ) {
                try {
                    val = JSON.parse( JSON.stringify( self[el] ))
                } catch (err) {
                    val = self[el]
                }
            } else {
                val = self[el]
            }

            label = '';
            if ( typeof($fields) != 'undefined' ) { // frontend only
                label = $fields[el].getAttribute('data-label') || '';
            }

            // keys are stringyfied because of the compiler !!!
            self[el] = {
                'target': $fields[el],
                'name': el,
                'value': val,
                'valid': false,
                // is name by default, but you should use setLabe(name) to change it if you need to
                'label': label,
                // check as field to exclude while sending datas to the model
                'exclude': false
            };

            /**
             *
             * is(regex)       -> validate if value matches regex
             *
             *  When entered in a JSON rule, you must double the backslashes
             *
             *  e.g.:
             *       "/\\D+/"       -> like [^0-9]
             *       "/^[0-9]+$/"   -> only numbers
             *
             * @param {object|string} regex - RegExp object or condition to eval
             *
             * */
            self[el]['is'] = function(regex, errorLabel) {
                var valid   = false;
                var errors  = {};

                if ( regex instanceof RegExp ) {
                    valid = regex.test(this.value) ? true : false;
                } else {
                    try {
                        // TODO - motif /gi to pass to the second argument
                        valid = new RegExp(regex.replace(/\//g, '')).test(this.value)
                    } catch (err) {
                        throw new Error(err.stack||err.message)
                    }
                }

                if (!valid) {
                    errors['is'] = replace(this.error || errorLabel || local.errorLabels['is'], this)
                }

                this.valid = valid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            self[el]['isEmail'] = function() {


                this.value      = local['data'][this.name] = this.value.toLowerCase();
                
                var rgx         = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
                var isValid     = rgx.test(this['value']) ? true : false;
                var errors      = self[this['name']]['errors'] || {};

                if ( !errors['isRequired'] && this.value == '' ) {
                    isValid = true;
                }

                if (!isValid) {
                    errors['isEmail'] = replace(this['error'] || local.errorLabels['isEmail'], this)
                }

                this.valid = isValid;

                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this['name']]
            }

            /**
             * Check if boolean and convert to `true/false` booloean if value is a string or a number
             * */
            self[el]['isBoolean'] = function() {
                var val = null, errors = {};
                switch(this.value) {
                    case 'true':
                    case true:
                    case 1:
                        val = this.value = local.data[this.name] = true;
                        break;
                    case 'false':
                    case false:
                    case 0:
                        val = this.value = local.data[this.name] = false;
                        break;
                }
                var valid = (val !== null) ? true : false;

                if (!valid) {
                    errors['isBoolean'] = replace(this.error || local.errorLabels['isBoolean'], this)
                }

                this.valid = valid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            /**
             * Check if value is an a Number. No transformation is done here.
             * */
            self[el]['isNumber'] = function(minLength, maxLength) {
                var val             = this.value
                    , isValid       = false
                    , isMinLength   = true
                    , isMaxLength   = true
                    , errors        = {}
                    ;
                // if val is a string replaces comas by points
                if (typeof(val) == 'string' && /,/g.test(val)) {
                    val = this.value = val.replace(/,/g, '.').replace(/\s+/g, '');
                }
                // test if val is a number
                if ( +val === +val ) {
                    isValid = true;
                    if ( !errors['isRequired'] && val != '' ) {
                        // if so also test max and min length if defined
                        if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                            isMinLength = false;
                            this['size'] = minLength;
                        }
                        if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                            isMaxLength = false;
                            this['size'] = maxLength;
                        }
                    }
                }

                // if val is invalid return error message
                if ( !isValid || !isMinLength || !isMaxLength ) {

                    if ( !isValid )
                        errors['isNumber'] = replace(this.error || local.errorLabels['isNumber'], this);
                    if ( !isMinLength || !isMaxLength ) {
                        if ( !isMinLength )
                            errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMinLength'], this);
                        if ( !isMaxLength )
                            errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMaxLength'], this);
                        if ( minLength === maxLength )
                            errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberLength'], this);
                    }

                    isValid = false;
                }

                this.valid = isValid;
                val = this.value = local.data[this.name] = Number(val);
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            self[el]['toInteger'] = function() {
                var val = this.value, errors = {};

                if (!val) {
                    return self[this.name]
                } else {
                    try {
                        val = this.value = local.data[this.name] = ~~(val.match(/[0-9]+/g).join(''));
                    } catch (err) {

                        errors['toInteger'] = replace(this.error || local.errorLabels['toInteger'], this);
                        this.valid = false;
                        if ( errors.count() > 0 )
                            this['errors'] = errors;
                    }

                }

                return self[this.name]
            }

            self[el]['isInteger'] = function(minLength, maxLength) {
                var val             = this.value
                    , isValid       = false
                    , isMinLength   = true
                    , isMaxLength   = true
                    , errors        = {}
                    ;

                // test if val is a number
                if ( +val === +val && val % 1 === 0 ) {
                    isValid = true;
                    if ( !errors['isRequired'] && val != '' ) {
                        // if so also test max and min length if defined
                        if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                            isMinLength = false;
                            this['size'] = minLength;
                        }
                        if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                            isMaxLength = false;
                            this['size'] = maxLength;
                        }
                    }
                }
                // if val is invalid return error message
                if ( !isValid || !isMinLength || !isMaxLength ) {

                    if ( !isValid )
                        errors['isInteger'] = replace(this.error || local.errorLabels['isInteger'], this);
                    if ( !isMinLength || !isMaxLength ) {
                        if ( !isMinLength )
                            errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMinLength'], this);
                        if ( !isMaxLength )
                            errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMaxLength'], this);
                        if ( minLength === maxLength )
                            errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerLength'], this);
                    }
                    isValid = false;
                }

                this.valid = isValid;
                val = this.value = local.data[this.name] = Number(val);

                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }


            self[el]['toFloat'] = function(decimals) {
                if ( typeof(this.value) == 'string' ) {
                    this.value = this.value.replace(/\s+/g, '');
                }

                var val = this.value, errors = {}, isValid = true;

                if (decimals) {
                    this['decimals'] = parseInt(decimals)
                } else if ( typeof(this['decimals']) == 'undefined' ) {
                    this['decimals'] = 2
                }

                if (!val) {
                    return self[this.name]
                } else {
                    if ( this['isNumber']().valid ) {
                        try {
                            val = this.value = local.data[this.name] = new Number(parseFloat(val.match(/[0-9.,]+/g).join('').replace(/,/, '.')));// Number <> number
                            this.target.setAttribute('value', val);
                        } catch(err) {
                            isValid = false;
                            errors['toFloat'] = replace(this.error || local.errorLabels['toFloat'], this);
                            this.valid = false;
                            if ( errors.count() > 0 )
                                this['errors'] = errors;
                        }
                    } else {
                        isValid = false;
                        errors['toFloat'] = replace(this.error || local.errorLabels['toFloatNAN'], this)
                    }
                }

                if (this['decimals'] && val && !errors['toFloat']) {
                    this.value = local.data[this.name] = this.value.toFixed(this['decimals']);
                }

                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            /**
             * Check if value is float. No transformation is done here.
             * Can be used in combo preceded by *.toFloat(2) to transform data if needed:
             *  1 => 1.0
             *  or
             *  3 500,5 => 3500.50
             *
             *
             * @param {number} [ decimals ]
             *
             * TODO - decimals transformation
             * */
            self[el]['isFloat'] = function(decimals) {

                if ( typeof(this.value) == 'string' ) {
                    this.value = this.value.replace(/\s+/g, '');
                }

                var val = this.value, isValid = false, errors = {};


                if ( typeof(val) == 'string' && /\./.test(val) && Number(val) ) {
                    isValid = true
                }

                // if string replaces comas by points
                if (typeof(val) == 'string' && /,/g.test(val)) {
                    val =  this.value = local.data[this.name] = Number(val.replace(/,/g, '.'))
                }
                // test if val can be a number and if it is a float
                if ( val && val % 1 !== 0 || val == 0) {
                    this.value = local.data[this.name] = Number(val);
                    isValid = true
                } else {
                    isValid = false
                }

                if ( !errors['isRequired'] && this.value == '' ) {
                    isValid = true
                }

                if (!isValid) {
                    errors['isFloat'] = replace(this.error || local.errorLabels['isFloat'], this)
                }

                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            self[el]['isRequired'] = function(isApplicable) {

                if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                    this.valid = true;

                    return self[this.name]
                }



                var isValid = ( typeof(this.value) != 'undefined' && this.value != null && this.value != '') ? true : false;
                var errors  = {};


                if (!isValid) {
                    errors['isRequired'] = replace(this.error || local.errorLabels['isRequired'], this)
                }

                this.valid = isValid;
                if (errors.count() > 0)
                    this['errors'] = errors;

                return self[this.name]
            }
            /**
             *
             * isString()       -> validate if value is string
             * isString(10)     -> validate if value is at least 10 chars length
             * isString(0, 45)  -> no minimum length, but validate if value is maximum 45 chars length
             *
             * @param {number|undefined} [ minLength ]
             * @param {number} [ maxLength ]
             * */
            self[el]['isString'] = function(minLength, maxLength) {

                var val             = this.value
                    , isValid       = false
                    , isMinLength   = true
                    , isMaxLength   = true
                    , errors        = {}
                    ;


                // test if val is a string
                if ( typeof(val) == 'string' ) {
                    isValid = true;

                    if ( !errors['isRequired'] && val != '' ) {
                        // if so also test max and min length if defined
                        if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                            isMinLength = false;
                            this['size'] = minLength;
                        }
                        if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                            isMaxLength = false;
                            this['size'] = maxLength;
                        }
                    }

                }

                // if val is invalid return error message
                if (!isValid || !isMinLength || !isMaxLength ) {

                    if (!isValid && errors['isRequired'] && val == '') {
                        isValid = false;
                        errors['isString'] = replace(this['error'] || local.errorLabels['isString'], this);
                    } else if (!isValid && !errors['isRequired']) {
                        isValid = true;
                    }

                    if ( !isMinLength || !isMaxLength) {
                        isValid = false;

                        if ( !isMinLength )
                            errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMinLength'], this);
                        if ( !isMaxLength )
                            errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMaxLength'], this);
                        if (minLength === maxLength)
                            errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringLength'], this);
                    }

                }

                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;


                return self[this.name]
            }

            /**
             * Check if date
             *
             * @param {string} [mask] - by default "yyyy-mm-dd"
             *
             * @return {date} date - extended by gina::utils::dateFormat; an adaptation of Steven Levithan's code
             * */
            self[el]['isDate'] = function(mask) {
                var val         = this.value
                    , isValid   = false
                    , errors    = {}
                    ;
                if (!val) return self[this.name];

                var m = mask.match(/[^\/\- ]+/g);
                val = val.match(/[^\/\- ]+/g);
                var dic = {}, d, len;
                for (d=0, len=m.length; d<len; ++d) {
                    dic[m[d]] = val[d]
                }
                var newMask = 'yyyy-mm-dd';
                for (var v in dic) {
                    newMask = newMask.replace(new RegExp(v, "g"), dic[v])
                }

                var date = this.value = local.data[this.name] = new Date(newMask);

                if ( date instanceof Date ) {
                    isValid = true;
                } else {
                    if ( !errors['isRequired'] && this.value == '' ) {
                        isValid = true
                    } else {
                        errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this);
                    }

                    this.valid = isValid;
                    if ( errors.count() > 0 )
                        this['errors'] = errors;

                    return self[this.name]
                }

                this.valid = isValid;

                return date
            }

            /**
             * Formating date using DateFormatHelper
             * Check out documentation in the helper source: `utils/helpers/dateFormat.js`
             * e.g.:
             *      d.start
             *        .isDate('dd/mm/yyyy')
             *        .format('isoDateTime');
             *
             *
             * */
            self[el]['format'] = function(mask, utc) {
                var val = this.value;
                if (!val) return self[this.name];

                return val.format(mask, utc)
            };

            /**
             * Set flash
             *
             * @param {str} flash
             * */
            self[el]['setFlash'] = function(regex, flash) {
                if ( typeof(flash) != 'undefined' && flash != '') {
                    this.error = flash
                }
                return self[this.name]
            }

            /**
             * Set label
             *
             * @param {str} label
             * */
            self[el]['setLabel'] = function(label) {
                if ( typeof(label) != 'undefined' && label != '') {
                    this.label = label
                }
                return self[this.name]
            }

            /**
             * Exclude when converting back to datas
             *
             * @return {object} data
             * */
            self[el]['exclude'] = function(isApplicable) {

                if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                    local.data[this.name] = this.value;

                    return self[this.name]
                }

                //clonning
                for (var d in local.data) {
                    if (d === this.name) { //cleaning
                        delete local.data[d]
                    }
                }
                //console.log('deleting ', this.name, local.data);
                //delete local.data[this.name];

                return self[this.name]
            }

        } // EO for (var el in self)

        /**
         * Check if errors found during validation
         *
         * @return {boolean}
         * */
        self['isValid'] = function() {

            var i = self['getErrors']().count();
            var valid = true;

            if (i > 0) {
                valid = false;
                //console.log('('+i+')ERROR'+( (i>1) ? 's': '')+' :\n'+ self['getErrors']() );
            }

            return valid
        }

        self['getErrors'] = function() {
            var errors = {};

            for (var field in self) {
                if ( typeof(self[field]) != 'function' && typeof(self[field]['errors']) != 'undefined' ) {
                    errors[field] = self[field]['errors']
                }
            }

            return errors
        }

        self['toData'] = function() {
            return local.data
        }

        var replace = function(target, fieldObj) {
            var keys = target.match(/%[a-z]+/gi);
            if (keys) {
                for (var k = 0, len = keys.length; k < len; ++k) {
                    target = target.replace(new RegExp(keys[k], 'g'), fieldObj[local.keys[keys[k]]])
                }
            }

            return target
        }

        self['setErrorLabels'] = function (errorLabels) {
            if ( typeof(errorLabels) != 'undefined') {
                local.errorLabels = merge(errorLabels, local.errorLabels)
            }
        }

        return self
    }


    var merge       = new Merge();
    var helpers     = {
        'dateFormat'  : new DateFormatHelper()
    };

    /**
     * Events handling
     * */

    function cancelEvent(event) {
        if (typeof(event) != 'undefined' && event != null) {
            if (event.stopPropagation) {
                event.stopPropagation()
            }
            event.cancelBubble = true;
            if (event.preventDefault) {
                event.preventDefault()
            }
            event.returnValue = false
        }
    }

    function triggerEvent (target, element, name, args) {
        if (typeof(element) != 'undefined' && element != null) {
            var evt = null, isDefaultPrevented = false, isAttachedToDOM = false;

            // done separately because it can be listen at the same time by the user & by gina
            if ( jQuery ) { //thru jQuery if detected

                // Check if listener is in use: e.g $('#selector').on('eventName', cb)
                var $events = null; // attached events list
                // Before jQuery 1.7
                if (jQuery['fn']['jquery'].substr(0,3) <= '1.7') {
                    $events = jQuery(element)['data']('events')
                } else {// From 1.8 +
                    $events = jQuery['_data'](jQuery(element)[0], "events")
                }

                isAttachedToDOM = ( typeof($events) != 'undefined' && typeof($events[name]) != 'undefined' ) ? true : false;

                if (isAttachedToDOM) { // only trigger if attached
                    evt = jQuery.Event( name );
                    jQuery(element)['trigger'](evt, args);
                    isDefaultPrevented = evt['isDefaultPrevented']();
                }
            }

            if (window.CustomEvent || document.createEvent) {

                if (window.CustomEvent) { // new method from ie9
                    evt = new CustomEvent(name, {
                        'detail'    : args,
                        'bubbles'   : true,
                        'cancelable': true,
                        'target'    : element
                    })
                } else { // before ie9

                    evt = document.createEvent('HTMLEvents');
                    // OR
                    // evt = document.createEvent('Event');

                    evt['detail'] = args;
                    evt['target'] = element;
                    evt.initEvent(name, true, true);

                    evt['eventName'] = name;

                }

                if ( !isDefaultPrevented ) {
                    //console.log('dispatching ['+name+'] to ', element.id, isAttachedToDOM, evt.detail);
                    element.dispatchEvent(evt)
                }

            } else if (document.createEventObject) { // non standard
                evt = document.createEventObject();
                evt.srcElement.id = element.id;
                evt.detail = args;
                evt.target = element;
                element.fireEvent('on' + name, evt)
            }

        } else {
            target.customEvent.fire(name, args)
        }
    }

    function addListener(target, element, name, callback) {

        if ( typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) == -1) {
            target.event[name][target.event[name].length] = element
        }

        if (typeof(element) != 'undefined' && element != null) {
            if (element.addEventListener) {
                element.addEventListener(name, callback, false)
            } else if (element.attachEvent) {
                element.attachEvent('on' + name, callback)
            }
        } else {
            target.customEvent.addListener(name, callback)
        }
    }

    function removeListener(target, element, name, callback) {
        if (typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) != -1) {
            target.event[name].splice(target.event[name].indexOf(element), 1)
        }

        if (typeof(element) != 'undefined' && element != null) {
            if (element.removeEventListener) {
                element.removeEventListener(name, callback, false)
            } else if (element.attachEvent) {
                element.detachEvent('on' + name, callback)
            }
        } else {
            target.customEvent.removeListener(name, callback)
        }
    }

    /**
     * Operations on selectors
     * */

    function insertAfter(referenceNode, newNode) {
        //console.log('inserting after ',referenceNode, newNode, referenceNode.nextSibling);
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling)

    }

    function getElementsByAttribute(attribute) {
        var matching = [], m = 0;
        var els = document.getElementsByTagName('*');

        for (var i = 0, n = els.length; i < n; ++i) {
            if (els[i].getAttribute(attribute) !== null) {
                // Element exists with attribute. Add to array.
                matching[m] = els[i];
                ++m
            }
        }

        return matching
    }


    var instance    = { 'isFrameworkLoaded': false, 'hasPopinHandler': false };

    /**
     * gina event handler
     * */
    var events  = ['ready', 'validatorReady', 'popinReady'];
    var $gina   = document;

    var makeId = function(){
        return new Date().getTime() + Math.floor((Math.random() * 100) + 1)
    };

    if (!$gina['id']) {
        var id = 'gina.'+ makeId();
        $gina['id'] = id;
    }

    var construct = function() {

        if ( typeof(this.initialized) != 'undefined') {
            return false
        }

        var _instance = {
            'options': {
                'env': 'dev'
            },
            'event': {
                'isTouchSupported' : 'ontouchstart' in window,
                'click' : [],
                'mouseover' : [],
                'mouseout' : []
            },
            'on': on
        };


        instance = merge(_instance, instance);
        //console.log('instance ', instance);



        instance.event['startEvent']   = instance.event['isTouchSupported'] ? 'touchstart' : 'mousedown';
        instance.event['endEvent']     = instance.event['isTouchSupported'] ? 'touchend' : 'mouseup';

        this.initialized = true;

        triggerEvent(instance, $gina, 'ready');
        return instance
    }

    var on = function(event, cb) {

        if ( events.indexOf(event) < 0 ) {
            cb(new Error('Event `'+ event +'` not handled by gina EventHandler'))
        } else {
            addListener(instance, $gina, event, function(event) {
                cancelEvent(event);
                if (event['detail'])
                    var data = event['detail'];

                cb(false, data)
            })
        }
    };

    // defining Date.format()

    Object.defineProperty( Date.prototype, 'format', {
        writable:   false,
        enumerable: false,
        //If loaded several times, it can lead to an exception. That's why I put this.
        configurable: true,
        value: function(mask, utc){ return helpers.dateFormat.format(this, mask, utc) }
    });



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

    instance['Controller'] = function(options) {
        var self        = {
            eventData: {},
            events: {}
        };

        var events      = ['error', 'progress', 'success'];
        var registeredControllers = [];

        if ( typeof(document['ControllerEvents']) == 'undefined' ) document['ControllerEvents'] = {};

        var $controller = document['ControllerEvents'];
        var controllerInstance = {};

        /**
         * XML Request
         * */
        var xhr = null;
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': false,
            'headers'       : {
                // to upload, use `multipart/form-data` for `enctype`
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

            }
        };

        var on = function(event, cb) {

            if ( events.indexOf(event) < 0 ) {
                cb(new Error('Event `'+ event +'` not handled by ginaValidatorEventHandler'))
            } else {

                var $target = this;
                var id      = $target.getAttribute('id');

                event += '.' + id;

                var procced = function () {
                    //register event
                    self.events[event] = $target.id;
                    self.currentTarget = $target;

                    // bind
                    addListener(instance, $controller, event, function(e) {
                        cancelEvent(e);

                        var data = null;
                        if (e['detail']) {
                            data = e['detail'];
                        } else if ( typeof(self.eventData.submit) != 'undefined' ) {
                            data = self.eventData.submit
                        } else if ( typeof(self.eventData.error) != 'undefined' ) {
                            data = self.eventData.error
                        } else if ( typeof(self.eventData.success) != 'undefined' ) {
                            data = self.eventData.success;
                        }

                        // do it once
                        if ( typeof(self.events[e.type]) != 'undefined' && cb) {
                            //console.log('calling back from .on("'+e.type+'", cb) ', e);
                            delete self.events[e.type];
                            cb(e, data);
                        }
                    })
                }

                if ( typeof(self.events[event]) != 'undefined' && self.events[event] == id ) {
                    // unbind existing
                    removeListener(instance, $validator, event, procced)
                } else {
                    procced()
                }
            }

            return this
        };

        var query = function (option, obj, cb) {
            
        }

        var destroy = function(controllerId) {

        }

        var setOptions = function (options) {
            var options = merge(options, xhrOptions);
            xhrOptions = options;
        }

        /**
         * send request
         *
         *
         * @param {object} data
         * @param {object} [ options ]
         * */
        var send = function(data, options) {

            var $controller = this.target;
            var id          = $controller.getAttribute('id');

            // forward callback to HTML attribute
            listenToXhrEvents($form);

            if (options) {
                var options = merge(options, xhrOptions);
            } else {
                var options = xhrOptions;
            }

            var url         = $form.getAttribute('action') || options.url;
            var method      = $form.getAttribute('method') || options.method;
            method          = method.toUpperCase();
            options.method  = method;
            options.url     = url;

            // to upload, use `multipart/form-data` for `enctype`
            var enctype = $form.getAttribute('enctype');

            //console.log('options ['+$form.id+'] -> ', options);

            if ( options.withCredentials ) {
                if ('withCredentials' in xhr) {
                    // XHR for Chrome/Firefox/Opera/Safari.
                    if (options.isSynchrone) {
                        xhr.open(options.method, options.url, options.isSynchrone)
                    } else {
                        xhr.open(options.method, options.url)
                    }
                } else if ( typeof XDomainRequest != 'undefined' ) {
                    // XDomainRequest for IE.
                    xhr = new XDomainRequest();
                    xhr.open(options.method, options.url);
                } else {
                    // CORS not supported.
                    xhr = null;
                    var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                    triggerEvent(instance, $form, 'error.' + id, result)
                }
            } else {
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            // setting up headers
            for (var hearder in options.headers) {
                if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                    options.headers[hearder] = enctype
                }

                xhr.setRequestHeader(hearder, options.headers[hearder]);
            }

            if (xhr) {
                // catching ready state cb
                xhr.onreadystatechange = function (event) {

                    if (xhr.readyState == 4) {
                        // 200, 201, 201' etc ...
                        if( /^2/.test(xhr.status) ) {

                            try {
                                var result = xhr.responseText;
                                if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result = JSON.parse(xhr.responseText)
                                }

                                self.eventData.success = result;
                                //console.log('sending response ...');
                                //console.log('making response ' + JSON.stringify(result, null, 4));

                                triggerEvent(instance, $form, 'success.' + id, result)

                            } catch (err) {
                                var result = {
                                    'status':  422,
                                    'error' : err.description
                                };

                                self.eventData.error = result;

                                triggerEvent(instance, $form, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            self.eventData.error = result;

                            triggerEvent(instance, $form, 'error.' + id, result)
                        }
                    }
                };

                // catching request progress
                xhr.onprogress = function(event) {
                    // console.log(
                    //    'progress position '+ event.position,
                    //    '\nprogress total size '+ event.totalSize
                    // );

                    var percentComplete = (event.position / event.totalSize)*100;
                    var result = {
                        'status': 100,
                        'progress': percentComplete
                    };

                    self.eventData.onprogress = result;

                    triggerEvent(instance, $form, 'progress.' + id, result)
                };

                // catching timeout
                xhr.ontimeout = function (event) {
                    var result = {
                        'status': 408,
                        'error': 'Request Timeout'
                    };

                    self.eventData.ontimeout = result;

                    triggerEvent(instance, $form, 'error.' + id, result)
                };


                // sending
                if (data) {
                    if ( typeof(data) == 'object' ) {
                        try {
                            data = JSON.stringify(data)
                            //data = encodeURIComponent(JSON.stringify(data))
                        } catch (err) {
                            triggerEvent(instance, $form, 'error.' + id, err)
                        }
                    }
                    //console.log('sending -> ', data);
                    xhr.send(data)
                } else {
                    xhr.send()
                }


            }
        }

        var listenToXhrEvents = function($controller) {

            $controller['on'] = controllerProto['on'];

            //data-on-submit-success
            var htmlSuccesEventCallback =  $controller.getAttribute('data-on-submit-success') || null;
            if (htmlSuccesEventCallback != null) {

                if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                    eval(htmlSuccesEventCallback)
                } else {
                    $controller.on('success',  window[htmlSuccesEventCallback])
                }
            }

            //data-on-submit-error
            var htmlErrorEventCallback =  $controller.getAttribute('data-on-submit-error') || null;
            if (htmlErrorEventCallback != null) {
                if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                    eval(htmlErrorEventCallback)
                } else {
                    $controller.on('error', window[htmlErrorEventCallback])
                }
            }
        }




        var proto = {
            'on'                : on,
            'setOptions'        : setOptions
        };

        var controllerProto = {
            'destroy'   : destroy,
            'on'        : on,
            'query'     : query
        };

        var init = function (options) {
            //console.log('gina data ', userDataInspector);
            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }

            self.options    = merge(options, self.options);

            if ( typeof(self.options['name']) != 'string' || self.options['name'] == '' ) {
                throw new Error('`options.name` can not be left `empty` or `undefined`')
            }

            if ( registeredControllers.indexOf(self.options['name']) > -1 ) {
                throw new Error('`popin '+self.options['name']+'` already exists !')
            }


            controllerInstance['controller'] = self.options['name'];
            controllerInstance = merge(controllerInstance, proto);




            // setting up AJAX
            if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                xhr = new XMLHttpRequest();
            } else if (window.ActiveXObject) { // IE
                try {
                    xhr = new ActiveXObject("Msxml2.XMLHTTP");
                } catch (e) {
                    try {
                        xhr = new ActiveXObject("Microsoft.XMLHTTP");
                    }
                    catch (e) {}
                }
            }
        };


        init(options);

        return controllerInstance

    }

    instance['Validator'] = function(rules) {
        //console.log('rules -> ', rules);
        var self = {
            rules   : {},
            $forms  : {},
            eventData: {},
            events: {},
            currentTarget: null
        };

        /**
         * validator event handler
         * */
        var events      = ['error', 'progress', 'submit', 'success', 'change'];
        var $validator  = document;

        /**
         * XML Request
         * */
        var xhr = null;
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': false,
            'headers'       : {
                // to upload, use `multipart/form-data` for `enctype`
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

            }
        };

        var on = function(event, cb) {

            if ( events.indexOf(event) < 0 ) {
                cb(new Error('Event `'+ event +'` not handled by ginaValidatorEventHandler'))
            } else {

                var $target = this;
                var id      = $target.getAttribute('id');

                event += '.' + id;

                var procced = function () {
                    //register event
                    self.events[event] = $target.id;
                    self.currentTarget = $target;

                    // bind
                    addListener(instance, $validator, event, function(e) {
                        cancelEvent(e);

                        var data = null;
                        if (e['detail']) {
                            data = e['detail'];
                        } else if ( typeof(self.eventData.submit) != 'undefined' ) {
                            data = self.eventData.submit
                        } else if ( typeof(self.eventData.error) != 'undefined' ) {
                            data = self.eventData.error
                        } else if ( typeof(self.eventData.success) != 'undefined' ) {
                            data = self.eventData.success;
                        }

                        // do it once
                        if ( typeof(self.events[e.type]) != 'undefined' && cb) {
                            //console.log('calling back from .on("'+e.type+'", cb) ', e);
                            delete self.events[e.type];
                            cb(e, data);
                        }
                    })
                }

                if ( typeof(self.events[event]) != 'undefined' && self.events[event] == id ) {
                    // unbind existing
                    removeListener(instance, $validator, event, procced)
                } else {
                    procced()
                }
            }

            return this
        };


        var getFormById = function(formId) {

            if ( !this['$forms'] )
                throw new Error('`$forms` collection not found');

            if ( typeof(formId) == 'undefined') {
                throw new Error('[ FormValidator::getFormById(formId) ] `formId` is missing')
            }

            formId = formId.replace(/\#/, '');

            if ( typeof(this['$forms'][formId]) != 'undefined' )
                return this['$forms'][formId];

            return null
        }

        var destroy = function(formId) {
            var $form = null;


            if ( !self['$forms'] )
                throw new Error('`$forms` collection not found');
            

            if ( typeof(formId) == 'undefined') {
                if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                    var formId  = this.id
                } else {
                    throw new Error('[ FormValidator::destroy(formId) ] `formId` is missing')
                }
            }

            if ( typeof(formId) == 'string') {
                formId = formId.replace(/\#/, '')
            } else if ( typeof(formId) == 'object' ) { // weird exception
                var $target = formId.form;
                var _id = $target.getAttribute('id') || 'form.'+makeId();

                $target.setAttribute('id', _id);// just in case
                self.$forms[_id] = merge({}, formProto);

                self.$forms[_id]['target'] = $target;
                self.$forms[_id]['target']['id'] = _id;
                self.$forms[_id]['id'] = _id;
                if (self.$forms[formId['id']])
                    delete self.$forms[formId['id']];


                formId = _id;
            } else {
                throw new Error('[ FormValidator::destroy(formId) ] `formId` should be a `string`');
            }

            if ( typeof(self['$forms'][formId]) == 'undefined' || self['$forms'][formId]['id'] != formId ) {

                var $el = document.getElementById(formId);

                self.$forms[formId]             = merge({}, formProto);
                self.$forms[formId]['id']       = formId;
                self.$forms[formId]['target']   = $el;

                $form = self.$forms[formId];

            } else {
                $form = self['$forms'][formId] || null;
            }


            if ($form) {
                // remove existing listeners

                // form events
                removeListener(instance, $validator, 'success.' + formId);
                removeListener(instance, $form, 'validate.' + formId);
                removeListener(instance, $validator, 'error.' + formId);
                delete self.events['validate.' + formId];
                delete self.events['success.' + formId];
                delete self.events['error.' + formId];

                // submit
                var $submit = null, evt = null, $buttons = [], $buttonsTMP = [];

                $buttonsTMP = $form.target.getElementsByTagName('button');
                if ( $buttonsTMP.length > 0 ) {
                    for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                        $buttons.push($buttonsTMP[b])
                    }
                }

                $buttonsTMP = $form.target.getElementsByTagName('a');
                if ( $buttonsTMP.length > 0 ) {
                    for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                        $buttons.push($buttonsTMP[b])
                    }
                }

                for (var b=0, len=$buttons.length; b<len; ++b) {
                    if ($buttons[b].type == 'submit' || $buttons[b].attributes.getNamedItem('data-submit') ) {
                        $submit = $buttons[b];
                        //console.log( $submit['id'] );
                        if ( typeof(self.events[$submit['id']]) != 'undefined' ) {
                            console.log('removing ', self.events[$submit['id']]);
                            removeListener(instance, $submit, self.events[$submit['id']]);
                            delete self.events[$submit['id']];
                        }
                    }
                }

                delete self['$forms'][formId];

            } else {
                throw new Error('[ FormValidator::destroy(formId) ] `'+formId+'` not found')
            }

        }

        /**
         * validateFormById
         *
         * @param {string} formId
         * @param {object} [customRule]
         * 
         * @return {object} $form
         * */
        var validateFormById = function(formId, customRule) {
            var $form = null;


            if ( !this['$forms'] )
                throw new Error('`$forms` collection not found');

            if ( typeof(formId) == 'undefined') {
                if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                    var formId  = this.id
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `formId` is missing')
                }
            }

            if ( typeof(formId) == 'string') {
                formId = formId.replace(/\#/, '')
            } else if ( typeof(formId) == 'object' ) { // weird exception

                var $target = formId.form;
                var _id = $target.getAttribute('id') || 'form.'+makeId();

                $target.setAttribute('id', _id);// just in case
                self.$forms[_id] = merge({}, formProto);

                self.$forms[_id]['target'] = $target;
                self.$forms[_id]['target']['id'] = _id;
                self.$forms[_id]['id'] = _id;
                if (self.$forms[formId['id']])
                    delete self.$forms[formId['id']];


                formId = _id;
            } else {
                throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
            }

            if ( typeof(this['$forms'][formId]) == 'undefined' || this['$forms'][formId]['id'] != formId ) {

                var $el = document.getElementById(formId);

                self.$forms[formId]             = merge({}, formProto);
                self.$forms[formId]['id']       = formId;
                self.$forms[formId]['target']   = $el;

                $form = self.$forms[formId];
                
            } else {
                $form = this['$forms'][formId] || null;
            }


            if ($form) {
                var rule = null;
                if ( typeof(customRule) == 'undefined') {
                    rule = formId.replace(/\-/g, '.');

                    if ( typeof(self.rules[rule]) != 'undefined' ) {
                        $form['rule'] = customRule = self.rules[rule];
                    } else if ( $form.target.getAttribute('data-gina-validator-rule') ) {
                        rule = $form.target.getAttribute('data-gina-validator-rule').replace(/\-/g, '.');

                        if ( typeof(self.rules[rule]) != 'undefined' ) {
                            $form['rule'] = self.rules[rule]
                        } else {
                            throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-validator-rule` on form `'+$form.target+'`: no matching rule found')
                        }
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `customRule` or `data-gina-validator-rule` attribute is missing')
                    }
                } else {
                    rule = customRule.replace(/\-/g, '.');

                    if ( typeof(self.rules[rule]) != 'undefined' ) {
                        $form['rule'] = self.rules[rule]
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
                    }
                }
                //console.log("events list ", self.events);
                // binding form
                bindForm($form.target, customRule);

            } else {
                throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+formId+'` not found')
            }

            $form['resetErrorsDisplay'] = resetErrorsDisplay;

            return $form || null;
        }


        /**
         * Reset errors display
         *
         * @param {object|string} [$form|formId]
         *
         * */
        var resetErrorsDisplay = function($form) {
            var $form = $form;
            if ( typeof($form) == 'undefined' ) {
                $form = self.$forms[this.id]
            } else if ( typeof($form) == 'string' ) {
                $form = $form.replace(/\#/, '');

                if ( typeof(self.$forms[$form]) == 'undefined') {
                    throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
                }

                $form = self.$forms[$form]
            }
            //console.log('reseting error display ', $form.id, $form);
            handleErrorsDisplay($form['target'], [])
            // getting fields & values
            // var $fields     = {}
            //     , fields    = { '_length': 0 }
            //     , name      = null
            //     , value     = 0
            //     , type      = null;
            //
            // for (var i = 0, len = $form['target'].length; i<len; ++i) {
            //     name = $form['target'][i].getAttribute('name');
            //     if (!name) continue;
            //
            //     if ( typeof($form['target'][i].type) != 'undefined' && $form['target'][i].type == 'radio' ) {
            //         //console.log('radio ', name, $form[i].checked, $form[i].value);
            //         if ( $form['target'][i].checked == true ) {
            //             fields[name] = $form['target'][i].value;
            //         }
            //
            //
            //     } else {
            //         fields[name]    = $form['target'][i].value;
            //     }
            //     $fields[name]   = $form['target'][i];
            //     // reset filed error data attributes
            //     $fields[name].setAttribute('data-errors', '');
            //
            //     ++fields['_length']
            // }

            //console.log('$fields =>\n' + $fields);

            // if ( fields['_length'] == 0 ) { // nothing to validate
            //     delete fields['_length'];
            //     var result = {
            //         'errors'    : [],
            //         'isValid'   : function() { return true },
            //         'data'      : fields
            //     };
            //
            //     handleErrorsDisplay($form['target'], result['errors'])
            //
            // } else {
            //     // console.log('testing rule [ '+$form.id.replace(/\-/g, '.') +' ]\n'+ JSON.stringify(rule, null, 4));
            //     //console.log('validating !! ', self.rules[$form.id.replace(/-/g, '.')]);
            //     validate($form['target'], fields, $fields, self.rules[$form.id.replace(/-/g, '.')], function onValidation(result){
            //         handleErrorsDisplay($form['target'], result['errors']);
            //     });
            //
            // }
        }

        var submit = function () {

            var id   = this.id;

            if ( typeof(self.$forms[id]) == 'undefined') {
                throw new Error('[ FormValidator::submit() ] not `$form` binded. Use `FormValidator::getFormById(id)` or `FormValidator::validateFormById(id)` first ')
            }

            var $form = this.target;
            var rule = this.rule || self.rules[id.replace(/\-/g, '.')] || null;

            // getting fields & values
            var $fields     = {}
                , fields    = { '_length': 0 }
                , name      = null;


            for (var i = 0, len = $form.length; i<len; ++i) {
                name = $form[i].getAttribute('name');
                if (!name) continue;

                if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                    if ( $form[i].checked == true ) {
                        fields[name] = $form[i].value;
                    }


                } else {
                    fields[name] = $form[i].value;
                }
                $fields[name]   = $form[i];
                // reset filed error data attributes
                $fields[name].setAttribute('data-errors', '');

                ++fields['_length']
            }


            if ( fields['_length'] == 0 ) { // nothing to validate
                delete fields['_length'];
                var result = {
                    'errors'    : [],
                    'isValid'   : function() { return true },
                    'data'      : fields
                };

                triggerEvent(instance, $form, 'validate.' + id, result)

            } else {
                validate($form, fields, $fields, rule, function onValidation(result){
                    triggerEvent(instance, $form, 'validate.' + id, result)
                })
            }

            return this;
        }

        var setOptions = function (options) {
            var options = merge(options, xhrOptions);
            xhrOptions = options;
        }

        /**
         * send
         * N.B.: no validation here; if you want to validate against rules, use `.submit()` before
         *
         *
         * @param {object} data
         * @param {object} [ options ]
         * */
        var send = function(data, options) {

            var $form   = this.target;
            var id      = $form.getAttribute('id');

            // forward callback to HTML attribute
            listenToXhrEvents($form);

            if (options) {
                var options = merge(options, xhrOptions);
            } else {
                var options = xhrOptions;
            }

            var url         = $form.getAttribute('action') || options.url;
            var method      = $form.getAttribute('method') || options.method;
            method          = method.toUpperCase();
            options.method  = method;
            options.url     = url;

            // to upload, use `multipart/form-data` for `enctype`
            var enctype = $form.getAttribute('enctype');

            //console.log('options ['+$form.id+'] -> ', options);

            if ( options.withCredentials ) {
                if ('withCredentials' in xhr) {
                    // XHR for Chrome/Firefox/Opera/Safari.
                    if (options.isSynchrone) {
                        xhr.open(options.method, options.url, options.isSynchrone)
                    } else {
                        xhr.open(options.method, options.url)
                    }
                } else if ( typeof XDomainRequest != 'undefined' ) {
                    // XDomainRequest for IE.
                    xhr = new XDomainRequest();
                    xhr.open(options.method, options.url);
                } else {
                    // CORS not supported.
                    xhr = null;
                    var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                    triggerEvent(instance, $form, 'error.' + id, result)
                }
            } else {
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            // setting up headers
            for (var hearder in options.headers) {
                if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                    options.headers[hearder] = enctype
                }

                xhr.setRequestHeader(hearder, options.headers[hearder]);
            }

            if (xhr) {
                // catching ready state cb
                xhr.onreadystatechange = function (event) {

                    if (xhr.readyState == 4) {
                        // 200, 201, 201' etc ...
                        if( /^2/.test(xhr.status) ) {

                            try {
                                var result = xhr.responseText;
                                if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result = JSON.parse(xhr.responseText)
                                }

                                self.eventData.success = result;
                                //console.log('sending response ...');
                                //console.log('event is ', 'success.' + id);
                                //console.log('making response ' + JSON.stringify(result, null, 4));

                                triggerEvent(instance, $form, 'success.' + id, result)

                            } catch (err) {
                                var result = {
                                    'status':  422,
                                    'error' : err.description
                                };

                                self.eventData.error = result;

                                triggerEvent(instance, $form, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            self.eventData.error = result;

                            triggerEvent(instance, $form, 'error.' + id, result)
                        }
                    }
                };

                // catching request progress
                xhr.onprogress = function(event) {
                    // console.log(
                    //    'progress position '+ event.position,
                    //    '\nprogress total size '+ event.totalSize
                    // );

                    var percentComplete = (event.position / event.totalSize)*100;
                    var result = {
                        'status': 100,
                        'progress': percentComplete
                    };

                    self.eventData.onprogress = result;

                    triggerEvent(instance, $form, 'progress.' + id, result)
                };

                // catching timeout
                xhr.ontimeout = function (event) {
                    var result = {
                        'status': 408,
                        'error': 'Request Timeout'
                    };

                    self.eventData.ontimeout = result;

                    triggerEvent(instance, $form, 'error.' + id, result)
                };


                // sending
                if (data) {
                    if ( typeof(data) == 'object' ) {
                        try {
                            data = JSON.stringify(data)
                            //data = encodeURIComponent(JSON.stringify(data))
                        } catch (err) {
                            triggerEvent(instance, $form, 'error.' + id, err)
                        }
                    }
                    //console.log('sending -> ', data);
                    xhr.send(data)
                } else {
                    xhr.send()
                }


            }
        }

        var listenToXhrEvents = function($form) {

            $form['on'] = formProto['on'];

            //data-on-submit-success
            var htmlSuccesEventCallback =  $form.getAttribute('data-on-submit-success') || null;
            if (htmlSuccesEventCallback != null) {

                if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                    eval(htmlSuccesEventCallback)
                } else {
                    $form.on('success',  window[htmlSuccesEventCallback])
                }
            }

            //data-on-submit-error
            var htmlErrorEventCallback =  $form.getAttribute('data-on-submit-error') || null;
            if (htmlErrorEventCallback != null) {
                if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                    eval(htmlErrorEventCallback)
                } else {
                    $form.on('error', window[htmlErrorEventCallback])
                }
            }
        }




        var proto = {
            'on'                : on,
            'getFormById'       : getFormById,
            'resetErrorsDisplay': resetErrorsDisplay,
            'rules'             : self.rules,
            'setOptions'        : setOptions,
            'validateFormById'  : validateFormById
        };

        var formProto = {
            'destroy'   : destroy,
            'on'        : on,
            'send'      : send,
            'submit'    : submit
        };

        var init = function (rules) {

            // parsing rules
            if ( typeof(rules) != 'undefined' ) {
                parseRules(rules, '');

                // check if rules has imports & replace
                var rulesStr = JSON.stringify(rules, null, 4);
                var importedRules = rulesStr.match(/(\"@import\s+[a-z A-Z 0-9/.]+\")/g);
                if (importedRules.length > 0) {
                    var ruleArr = [], rule = {}, tmpRule = null;
                    for (var r = 0, len = importedRules.length; r<len; ++r) {
                        ruleArr = importedRules[r].replace(/(@import\s+|\"|\')/g, '').split(/\s/g);
                        // [""@import client/form", ""@import project26/edit demo/edit"]
                        //console.log('ruleArr -> ', ruleArr, importedRules[r]);
                        for (var i = 0, iLen = ruleArr.length; i<iLen; ++i) {
                            tmpRule = ruleArr[i].replace(/\//g, '.');
                            //console.log('-> ', ruleArr[i], self.rules[ ruleArr[i] ], self.rules);
                            if ( typeof(self.rules[ tmpRule ]) != 'undefined' ) {
                                rule = merge(rule, self.rules[ tmpRule ])
                            } else {
                                console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.')
                            }
                        }
                        //console.log('replacing ', importedRules[r]);
                        rulesStr = rulesStr.replace(importedRules[r], JSON.stringify(rule));
                        //console.log('str ', rulesStr);
                        rule = {}

                    }
                    self.rules = {}, rules = JSON.parse(rulesStr);
                    parseRules(rules, '');
                    proto.rules = self.rules;

                    //self.rules = JSON.parse(rulesStr);
                    //console.log('->\n'+ JSON.stringify(rules.project.edit, null, 4));
                }
            }

            var id          = null
                , i         = 0
                , $forms    = []
                , $allForms = document.getElementsByTagName('form');


            // has rule ?
            for (var f=0, len = $allForms.length; f<len; ++f) {
                // preparing prototype (need at least an ID for this)

                $allForms[f]['id'] = ($allForms[f].getAttribute) ? $allForms[f].getAttribute('id') : null;
                if ( typeof($allForms[f].id) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                    self.$forms[$allForms[f].id] = merge({}, formProto);
                    self.$forms[$allForms[f].id]['id'] = $allForms[f].id;
                    self.$forms[$allForms[f].id]['target'] = $allForms[f];

                    var customRule = $allForms[f].getAttribute('data-gina-validator-rule');

                    if (customRule) {
                        customRule = customRule.replace(/\-/g, '.');
                        if ( typeof(self.rules[customRule]) == 'undefined' ) {
                            throw new Error('['+$allForms[f].id+'] no rule found with key: `'+customRule+'`');
                            customRule = null
                        } else {
                            customRule = self.rules[customRule]
                        }
                    }

                    // finding forms handled by rules
                    if ( typeof($allForms[f].id) == 'string' && typeof(self.rules[$allForms[f].id.replace(/\-/g, '.')]) != 'undefined' ) {

                        if (customRule) {
                            bindForm($allForms[f], customRule)
                        } else {
                            bindForm($allForms[f])
                        }

                        ++i
                    } else {
                        // weird exception when having in the form an element with name="id"
                        if ( typeof($allForms[f].id) == 'object' ) {
                            delete self.$forms[$allForms[f].id];

                            var $target = $allForms[f];

                            var _id = $allForms[f].attributes.getNamedItem('id').nodeValue || 'form.'+makeId();
                            $target.setAttribute('id', _id);
                            $target['id'] = _id;

                            self.$forms[_id] = merge({}, formProto);
                            self.$forms[_id]['target'] = $target;
                            self.$forms[_id]['id'] = _id;

                            if (customRule) {
                                bindForm($target, customRule)
                            } else {
                                bindForm($target)
                            }
                        } else {

                            if (customRule) {
                                bindForm($allForms[f], customRule)
                            } else {
                                bindForm($allForms[f])
                            }
                        }
                    }
                }

            }

            //console.log('selected forms ', self.$forms);
            proto['$forms'] = self.$forms;

            // setting up AJAX
            if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                xhr = new XMLHttpRequest();
            } else if (window.ActiveXObject) { // IE
                try {
                    xhr = new ActiveXObject("Msxml2.XMLHTTP");
                } catch (e) {
                    try {
                        xhr = new ActiveXObject("Microsoft.XMLHTTP");
                    }
                    catch (e) {}
                }
            }

            // trigger validator ready event
            triggerEvent(instance, $gina, 'validatorReady', proto);
        }

        var parseRules = function(rules, tmp) {

            for (var r in rules) {

                if ( typeof(rules[r]) == 'object' && typeof(self.rules[tmp + r]) == 'undefined' ) {
                    self.rules[tmp + r] = rules[r];
                    parseRules(rules[r], tmp + r+'.');
                }
            }
        }

        var bindForm = function($form, customRule) {
            var _id = $form.id;
            if ( typeof(_id) != 'string' ) {
                try {
                    _id = $form.getAttribute('id') || 'form.'+makeId();
                    $form.setAttribute('id', _id);
                    $form.id = _id; // won't override :( ...
                } catch(err) {
                    throw new Error('Validator::bindForm($form, customRule) could not bind form `'+ $form +'`\n'+err.stack )
                }
            }

            if ( typeof(self.$forms[_id]) == 'undefined'){
                self.$forms[_id] = $form;
            }

            if ( typeof(self.$forms[_id]) != 'undefined' && self.$forms[_id]['binded']) {
                return false
            }

            var withRules = false, rule = null, evt = '', procced = null;

            if ( typeof(customRule) != 'undefined' || typeof(_id) == 'string' && typeof(self.rules[_id.replace(/\-/g, '.')]) != 'undefined' ) {
                withRules = true;

                if ( customRule && typeof(customRule) == 'object' ) {
                    rule = customRule
                } else if ( customRule && typeof(customRule) == 'string' && typeof(self.rules[customRule.replace(/\-/g, '.')]) != 'undefined') {
                    rule = self.rules[customRule.replace(/\-/g, '.')]
                } else {
                    rule = self.rules[_id.replace(/\-/g, '.')]
                }
            }

            // binding input: checkbox, radio
            var $inputs = $form.getElementsByTagName('input'), type = null, id = null;

            var updateCheckBox = function($el) {

                var checked = $el.checked;

                if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                    $el.checked = false;
                    $el.removeAttribute('checked');
                    $el.value = 'false';

                } else {

                    $el.setAttribute('checked', 'checked');
                    //boolean exception handling
                    $el.value = 'true';
                    $el.checked = true;

                }
            };

            var updateRadio = function($el, isInit) {
                var checked = $el.checked;

                // loop if radio group
                if (!isInit) {
                    var radioGroup = document.getElementsByName($el.name);
                    //console.log('found ', radioGroup.length, radioGroup)
                    for (var r = 0, rLen = radioGroup.length; r < rLen; ++r) {
                        if (radioGroup[r].id !== $el.id) {
                            radioGroup[r].checked = false;
                            radioGroup[r].removeAttribute('checked')
                        }
                    }
                }

                if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                    $el.checked = false;
                    $el.removeAttribute('checked');

                } else {

                    $el.setAttribute('checked', 'checked');
                    $el.checked = true;

                    //console.log('name -> ', $el.name, $el.value);
                }
            }

            evt = 'click';

            procced = function () {
                // click proxy
                addListener(instance, $form, 'click', function(event) {

                    // var isBinded = false, id = event.target.getAttribute('id');//self.events[event] = this.id;
                    // if ( typeof(self.events['click.'+id]) != 'undefined' && self.events['click.'+id] == id ) {
                    //     isBinded = true
                    // }
                    //
                    // if (isBinded) cancelEvent(event);

                    if ( typeof(event.target.id) == 'undefined' ) {
                        event.target.setAttribute('id', 'click.' + makeId() );
                        event.target.id = event.target.getAttribute('id')
                    }


                    if (/^click\./.test(event.target.id) || withRules) {


                        var _evt = event.target.id;
                        if ( ! /^click\./.test(_evt)  ) {
                            _evt = 'click.' + event.target.id
                        }

                        triggerEvent(instance, event.target, _evt, event.detail)

                    }




                })
            }

            if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
                //removeListener(instance, element, name, callback)
                removeListener(instance, $form, evt, procced)
            } else {
                procced()
            }

            for (var i=0, len = $inputs.length; i<len; ++i) {
                type    = $inputs[i].getAttribute('type');

                if ( typeof($inputs[i].id) == 'undefined' || $inputs[i].id == '' ) {
                    $inputs[i]['id'] = type +'-'+ makeId();
                    $inputs[i].setAttribute('id', $inputs[i]['id'])
                }


                if ( typeof(type) != 'undefined' && type == 'checkbox' ) {

                    evt = 'click.' + $inputs[i].id;


                    procced = function ($el, evt) {



                        // recover default state only on value === true || false

                        // addListener(instance, $el, 'change', function(event) {
                        //     cancelEvent(event);
                        //
                        //     console.log('changed state ', event.target);
                        // })
                        addListener(instance, $el, evt, function(event) {

                            //cancelEvent(event);

                            if ( /(true|false)/.test(event.target.value) ) {
                               updateCheckBox(event.target);
                            }
                        });

                        if ( /(true|false)/.test($el.value) )
                           updateCheckBox($el);

                    }

                    if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $inputs[i].id ) {
                        removeListener(instance, $inputs[i], evt, function(event){
                            procced(event.target, evt)
                        })
                    } else {
                        procced($inputs[i], evt)
                    }

                } else if ( typeof(type) != 'undefined' && type == 'radio' ) {
                    evt = 'click.' + $inputs[i].id;


                    procced = function ($el, evt) {
                        addListener(instance, $el, evt, function(event) {
                            //cancelEvent(event);
                            updateRadio(event.target);

                        });

                        updateRadio($el, true)
                    }

                    if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $inputs[i].id ) {
                        removeListener(instance, $inputs[i], evt, function(event){
                            procced(event.target, evt)
                        })
                    } else {
                        procced($inputs[i], evt)
                    }
                }
            }


            if (withRules) {
                evt = 'validate.' + _id;
                //console.log('[ bind() ] : before attaching `'+evt+'` ->  `withRules`: '+withRules, '\n'+self.events[evt]+' VS '+_id, '\nevents ', self.events);

                procced = function () {
                    self.events[evt] = _id;
                    //console.log('attaching ', evt);

                    // attach form event
                    addListener(instance, $form, evt, function(event) {
                        cancelEvent(event);

                        var result = event['detail'] || self.eventData.validation;
                        //console.log('$form[ '+_id+' ] validation done !!!\n isValid ? ', result['isValid'](), '\nErrors -> ', result['errors'], '\nData -> ', result['data']);

                        handleErrorsDisplay(event['target'], result['errors']);

                        if ( result['isValid']() ) { // send if valid
                            // now sending to server
                            formProto['target'] = event['target'];
                            formProto['id']     = event['target'].getAttribute('id');

                            self.$forms[event.target.id] = formProto;
                            //console.log('sending ... ', result['data']);
                            //console.log('just before sending ', self.$forms[event.target.id]);
                            self.$forms[event.target.id].send(result['data']);

                        }

                    });
                }

                if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
                    //removeListener(instance, element, name, callback)
                    removeListener(instance, $form, evt, procced)
                } else {
                    procced()
                }

                // if ( typeof(self.events[evt]) == 'undefined' || self.events[evt] != _id ) {
                //     self.events[evt] = _id;
                //     procced(evt, $form)
                // }



                // binding submit button
                var $submit = null, $buttons = [], $buttonsTMP = [], buttonId = null;
                $buttonsTMP = $form.getElementsByTagName('button');
                if ( $buttonsTMP.length > 0 ) {
                    for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                        $buttons.push($buttonsTMP[b])
                    }
                }

                $buttonsTMP = $form.getElementsByTagName('a');
                if ( $buttonsTMP.length > 0 ) {
                    for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                        $buttons.push($buttonsTMP[b])
                    }
                }


                //console.log('$buttons ', $buttons.length, $buttons);

                var onclickAttribute = null;
                for (var b=0, len=$buttons.length; b<len; ++b) {

                    if ($buttons[b].type == 'submit' || $buttons[b].attributes.getNamedItem('data-submit') ) {

                        $submit = $buttons[b];

                        if ($submit.tagName == 'A') { // without this test, XHR callback is ignored
                            onclickAttribute = $submit.getAttribute('onclick');
                            if ( !onclickAttribute ) {
                                $submit.setAttribute('onclick', 'return false;')
                            } else if ( !/return false/) {
                                if ( /\;$/.test(onclickAttribute) ) {
                                    onclickAttribute += 'return false;'
                                } else {
                                    onclickAttribute += '; return false;'
                                }
                            }
                        }

                        if (!$submit['id']) {

                            evt = 'click.'+ makeId();
                            $submit['id'] = evt;
                            $submit.setAttribute( 'id', evt);

                        } else {
                            evt = $submit['id'];
                        }
                        
                        procced = function (evt, $submit) {
                            // attach submit events
                            addListener(instance, $submit, evt, function(event) {
                                //console.log('submiting ', evt, $submit);
                                // start validation
                                cancelEvent(event);
                                // getting fields & values
                                var $fields     = {}
                                    , fields    = { '_length': 0 }
                                    , name      = null
                                    , value     = 0
                                    , type      = null;

                                for (var i = 0, len = $form.length; i<len; ++i) {
                                    name = $form[i].getAttribute('name');
                                    if (!name) continue;

                                    // TODO - add switch cases against tagName (checkbox/radio)

                                    if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                                        //console.log('radio ', name, $form[i].checked, $form[i].value);
                                        if ( $form[i].checked == true ) {
                                            fields[name] = $form[i].value;
                                        }


                                    } else {
                                        fields[name]    = $form[i].value;
                                    }
                                    $fields[name]   = $form[i];
                                    // reset filed error data attributes
                                    $fields[name].setAttribute('data-errors', '');

                                    ++fields['_length']
                                }

                                //console.log('$fields =>\n' + $fields);

                                if ( fields['_length'] == 0 ) { // nothing to validate
                                    delete fields['_length'];
                                    var result = {
                                        'errors'    : [],
                                        'isValid'   : function() { return true },
                                        'data'      : fields
                                    };

                                    triggerEvent(instance, $form, 'validate.' + _id, result)

                                } else {
                                    //console.log('testing rule [ '+_id.replace(/\-/g, '.') +' ]\n'+ JSON.stringify(rule, null, 4));
                                    //console.log('validating ', $form, fields, rule);
                                    validate($form, fields, $fields, rule, function onValidation(result){
                                        //console.log('validation result ', 'validate.' + _id, JSON.stringify(result.data, null, 2));
                                        //console.log('events ', 'validate.' + _id, self.events )
                                        triggerEvent(instance, $form, 'validate.' + _id, result)
                                    })
                                }

                            });
                        }


                        if ( typeof(self.events[evt]) == 'undefined' || self.events[evt] != $submit.id ) {
                            self.events[evt] = $submit.id;
                            procced(evt, $submit)
                        }
                    }
                }
            }



            evt = 'submit';

            if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == _id ) {
                removeListener(instance, $form, evt)
            }

            //console.log('adding submit event ', evt, _id, self.events);
            // submit proxy
            addListener(instance, $form, evt, function(e) {

                //console.log('adding submit event ', evt, self.events['submit.'+_id]);
                var isBinded = false, id = e.target.getAttribute('id');//self.events[event] = this.id;
                if ( typeof(self.events['submit.'+id]) != 'undefined' && self.events['submit.'+id] == id ) {
                    isBinded = true
                }

                if (withRules || isBinded) cancelEvent(e);

                var _id     = e.target.getAttribute('id');

                // just collect data for over forms
                // getting fields & values
                var $fields     = {}
                    , fields    = { '_length': 0 }
                    , name      = null
                    , value     = 0
                    , type      = null;

                for (var i = 0, len = $form.length; i<len; ++i) {
                    name = $form[i].getAttribute('name');
                    if (!name) continue;

                    // TODO - add switch cases against tagName (checkbox/radio)

                    if ( typeof($form[i].type) != 'undefined' && $form[i].type == 'radio' ) {
                        //console.log('name : ', name, '\ntype ', $form[i].type, '\nchecked ? ', $form[i].checked, '\nvalue', $form[i].value);
                        if ( $form[i].checked === true ) {
                            $form[i].setAttribute('checked', 'checked');
                            fields[name] = $form[i].value;
                        }
                    } else {
                        fields[name]    = $form[i].value;
                    }

                    $fields[name]   = $form[i];

                    ++fields['_length']
                }

                if ( fields['_length'] > 0 ) { // nothing to validate
                    delete fields['_length'];
                    self.eventData.submit = {
                        'data': fields,
                        '$fields': $fields
                    }
                }

                var result = e['detail'] || self.eventData.submit;

                triggerEvent(instance, $form, 'submit.' + _id, result)
            });

            self.$forms[_id]['binded'] = true;

        }

        var validate = function($form, fields, $fields, rules, cb) {
            delete fields['_length']; //cleaning

            //console.log(fields, $fields);

            var d = new FormValidator(fields, $fields), args = null;
            var fieldErrorsAttributes = {};
            var re = null, flags = null;


            var forEachField = function($form, fields, $fields, rules, cb, i) {
                var hasCase = false, conditions = null;
                var caseValue = null, caseType = null;
                var localRules = null;

                //console.log('parsing ', fields, $fields, rules);

                for (var field in fields) {

                    hasCase = ( typeof(rules['_case_' + field]) != 'undefined' ) ? true : false;
                    if (hasCase) {

                        conditions = rules['_case_' + field]['conditions'];
                        //console.log('found case on `'+field +'`');
                        //console.log('conditions ', conditions);

                        if ( !conditions ) {
                            throw new Error('[ ginaFormValidator ] case `_case_'+field+'` found without `condition(s)` !');
                        }

                        for (var c = 0, cLen = conditions.length; c<cLen; ++c) {
                            //caseType = $fields[field].getAttribute('type');

                            //caseValue = $fields[field].value;

                            caseValue = fields[field];

                            if ($fields[field].value == "true")
                                caseValue = true;
                            else if ($fields[field].value == "false")
                                caseValue = false;

                            //console.log(caseValue +' VS '+ conditions[c]['case'], "->", (caseValue == conditions[c]['case'] || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1) );
                            if ( conditions[c]['case'] === caseValue || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1 ) {

                                //console.log('[fields ] ' + JSON.stringify(fields, null, 4));
                                localRules = {};

                                for (var f in conditions[c]['rules']) {
                                    //console.log('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                    if ( /^\//.test(f) ) { // RegExp found

                                        re      = f.match(/\/(.*)\//).pop();
                                        flags   = f.replace('/'+ re +'/', '');
                                        re      = new RegExp(re, flags);

                                        for (var localFiled in $fields) {
                                            if ( re.test(localFiled) ) {
                                                localRules[localFiled] = conditions[c]['rules'][f]
                                            }
                                        }

                                    } else {
                                        localRules[f]       = conditions[c]['rules'][f]
                                    }
                                }
                                //console.log('parsing ', localRules, fields);

                                forEachField($form, fields, $fields, localRules, cb, i+1)
                            }
                        }

                    }


                    if ( typeof(rules[field]) == 'undefined' ) continue;


                    // check against rule
                    for (var rule in rules[field]) {
                        // check for rule params
                        try {

                            if ( Array.isArray(rules[field][rule]) ) { // has args
                                //convert array to arguments
                                args = rules[field][rule];
                                d[field][rule].apply(d[field], args);
                            } else {
                                d[field][rule](rules[field][rule]);
                            }

                        } catch (err) {
                            if (rule == 'conditions') {
                                throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()` where `conditions` must be a `collection` (Array)')
                            } else {
                                throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()`')
                            }
                        }

                    }
                }


                --i;

                if (i < 0) {
                    var errors = d['getErrors']();

                    // adding data attribute to handle display refresh
                    for (var field in errors) {
                        for (rule in errors[field]) {
                            if (!fieldErrorsAttributes[field]) {
                                fieldErrorsAttributes[field] = ''
                            }

                            if (fieldErrorsAttributes[field].indexOf(rule) < 0)
                                fieldErrorsAttributes[field] += rule +' ';
                        }

                        $fields[field].setAttribute('data-errors', fieldErrorsAttributes[field].substr(0, fieldErrorsAttributes[field].length-1))
                    }

                    //console.log('data => ',  d['toData']());

                    //calling back
                    cb({
                        'isValid'   : d['isValid'],
                        'errors'    : errors,
                        'data'      : d['toData']()
                    })
                }
            }

            forEachField($form, fields, $fields, rules, cb, 0)
        }


        var handleErrorsDisplay = function($form, errors) {

            var name = null, errAttr = null;
            var $err = null, $msg = null;
            var $el = null, $parent = null, $target = null;

            for (var i = 0, len = $form.length; i<len; ++i) {
                $el     = $form[i];
                if ( /form\-item\-wrapper$/.test($el.parentNode.className) ) {
                    $parent = $el.parentNode.parentNode;
                    $target = $el.parentNode;
                } else {
                    $parent = $el.parentNode;
                    $target = $el;
                }

                name    = $el.getAttribute('name');
                errAttr = $el.getAttribute('data-errors');

                if (!name) continue;

                if ( typeof(errors[name]) != 'undefined' && !/form\-item\-error/.test($parent.className) ) {

                    $parent.className += ($parent.className == '' ) ? 'form-item-error' : ' form-item-error';

                    $err = document.createElement('div');
                    $err.setAttribute('class', 'form-item-error-message');

                    // injecting error messages
                    for (var e in errors[name]) {
                        $msg = document.createElement('p');
                        //console.log('txt => ', errors[name][e], e);
                        $msg.appendChild( document.createTextNode(errors[name][e]) );
                        $err.appendChild($msg)
                    }

                    if ($target.type != 'hidden')
                        insertAfter($target, $err);

                } else if ( typeof(errors[name]) == 'undefined' && /form\-item\-error/.test($parent.className) ) {
                    // reset when not in error
                    // remove child elements
                    var $children = $parent.getElementsByTagName('div');
                    for (var c = 0, cLen = $children.length; c<cLen; ++c) {
                        if ( /form\-item\-error\-message/.test($children[c].className) ) {
                            $parent.removeChild($children[c]);
                            break
                        }
                    }

                    $parent.className = $parent.className.replace(/(\s+form\-item\-error|form\-item\-error)/, '');

                } else if ( typeof(errors[name]) != 'undefined' && errAttr) {
                    // refreshing already displayed error on msg update
                    var $divs = $parent.getElementsByTagName('div');
                    for (var d = 0, dLen = $divs.length; d<dLen; ++d) {
                        if ($divs[d].className == 'form-item-error-message') {

                            $parent.removeChild($divs[d]);
                            $err = document.createElement('div');
                            $err.setAttribute('class', 'form-item-error-message');

                            // injecting error messages
                            for (var e in errors[name]) {
                                $msg = document.createElement('p');
                                $msg.appendChild( document.createTextNode(errors[name][e]) );
                                $err.appendChild($msg)
                            }

                            break;
                        }
                    }

                    if ($target.type != 'hidden')
                        insertAfter($target, $err);
                }
            }
        }

        init(rules);

        return proto
    }

    /**
     * Gina Popin Handler
     * */
    instance['Popin'] = function(options) {
        var popinInstance   = { 'id': makeId() };
        var $popin          = null; // is on main `gina-popins` container (first level)

        var self = {
            'options' : {
                'name' : undefined,
                'class': 'gina-popin-default'
            },
            events: {},
            eventData: {}
        };


        // XML Request
        var xhr = null;

        var registeredPopins = [];

        var events = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];

        var on = function(event, cb) {

            if ( events.indexOf(event) < 0 ) {
                cb(new Error('Event `'+ event +'` not handled by ginaPopinEventHandler'))
            } else {


                var $target = this;
                var id = $target.id;

                event += '.' + id;

                var procced = function () {
                    //register event
                    self.events[event] = $target.id;
                    self.currentTarget = $target;

                    // bind
                    addListener(instance, $popin, event, function(e) {
                        cancelEvent(e);

                        var data = null;
                        if (e['detail']) {
                            data = e['detail'];
                        } else if ( typeof(self.eventData.submit) != 'undefined' ) {
                            data = self.eventData.submit
                        } else if ( typeof(self.eventData.error) != 'undefined' ) {
                            data = self.eventData.error
                        } else if ( typeof(self.eventData.success) != 'undefined' ) {
                            data = self.eventData.success;
                        }

                        cb(e, data)

                    })
                }


                if ( typeof(self.events[event]) != 'undefined' && self.events[event] == id ) {
                    // unbind existing
                    removeListener(instance, $popin, event, procced)
                } else {
                    procced()
                }

            }

            return this
        };

        var proto = {
            'on'            : on,
            'popin'         : undefined,
            'load'          : popinLoad,
            'loadContent'   : popinLoadContent,
            'open'          : popinOpen,
            'isOpen'        : popinIsOpen,
            'close'         : popinClose
        };

        var init = function(options) {


            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }

            self.options    = merge(options, self.options);

            if ( typeof(self.options['name']) != 'string' || self.options['name'] == '' ) {
                throw new Error('`options.name` can not be left `empty` or `undefined`')
            }

            if ( registeredPopins.indexOf(self.options['name']) > -1 ) {
                throw new Error('`popin '+self.options['name']+'` already exists !')
            }

            self.options['class'] = 'gina-popin-container ' + self.options['class'];

            var popinName  = self.options['name'];

            popinInstance['popin'] = popinName;
            popinInstance = merge(popinInstance, proto);

            if ( !instance.hasPopinHandler ) {
                popinCreateContainer();
            }



            // setting up AJAX
            if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                xhr = new XMLHttpRequest();
            } else if (window.ActiveXObject) { // IE
                try {
                    xhr = new ActiveXObject("Msxml2.XMLHTTP");
                } catch (e) {
                    try {
                        xhr = new ActiveXObject("Microsoft.XMLHTTP");
                    }
                    catch (e) {}
                }
            }

            // binding `open` triggers
            bindOpen()
        }

        /**
         * popinCreateContainer
         *
         * Creates HTML container and add it to the DOM
         *
         *
         * */
        var popinCreateContainer = function() {

            // creating template
            // <div class="gina-popins">
            //     <div class="gina-popins-overlay gina-popin-is-active"></div>
            // </div>
            var $container = document.createElement('div');
            var id = 'gina-popins-'+ makeId();
            $container.setAttribute('id', id);
            $container.setAttribute('class', 'gina-popins');

            self.$target = $popin = $container;
            self.id = id;

            var $overlay = document.createElement('div');
            $overlay.setAttribute('id', 'gina-popins-overlay');
            $overlay.setAttribute('class', 'gina-popins-overlay');


            $container.appendChild( $overlay );

            // adding to DOM
            document.body.appendChild($container);

            instance.hasPopinHandler = true;
        }

        var bindOpen = function() {
            var attr    = 'data-gina-popin-name';
            var $els    = getElementsByAttribute(attr);
            var $el     = null, name = null;
            var url     = null;
            var procced = null, evt = null;


            for (var i = 0, len = $els.length; i < len; ++i) {
                $el     = $els[i];
                name    = $el.getAttribute(attr);
                if ( $el.tagName == 'A' ) {
                    url = $el.getAttribute('href');
                    if (url == '' || url =='#') {
                        url = null
                    }
                }

                if ( !url && typeof( $el.getAttribute('data-gina-popin-url') ) != 'undefined') {
                    url = $el.getAttribute('data-gina-popin-url')
                }

                if (!url) {
                    throw new Error('Found `data-gina-popin-name` without `url` !')
                }

                if ( !$el['url'] ) {
                    $el['url'] = url;
                }

                if ( !$el['popinName'] ) {
                    $el['popinName'] = name;
                }

                if ( !$el['id'] ) {
                    evt = 'popin.click.'+ makeId();
                    $el['id'] = evt;
                    $el.setAttribute( 'id', evt);
                } else {
                    evt = 'popin.click.'+ $el['id'];
                }

                procced = function () {
                    // attach submit events
                    addListener(instance, $el, evt, function(e) {
                        cancelEvent(e);
                        // loading & binding popin
                        popinLoad(e.target.popinName, e.target.url);
                        popinOpen(e.target.popinName);
                    });
                }


                if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $el.id ) {
                    removeListener(instance, $el, evt, procced)
                } else {
                    procced()
                }

            }

            // proxies
            // click on main document
            evt = 'click';
            procced = function () {
                // click proxy
                addListener(instance, document, evt, function(event) {

                    if ( typeof(event.target.id) == 'undefined' ) {
                        event.target.setAttribute('id', evt+'.' + makeId() );
                        event.target.id = event.target.getAttribute('id')
                    }


                    if ( /^popin\.click\./.test(event.target.id) ) {
                        cancelEvent(event);
                        //console.log('popin.click !!');
                        var _evt = event.target.id;
                        if ( ! /^popin\.click\./.test(_evt)  ) {
                            _evt = 'popin.click.' + event.target.id
                        }

                        triggerEvent(instance, event.target, _evt, event.detail)
                    }


                })
            }

            if ( typeof(self.events[evt]) != 'undefined' && self.events[evt] == $popin.id ) {
                removeListener(instance, document, evt, procced)
            } else {
                procced()
            }

        }



        /**
         * XML Request options
         * */
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': true, // if should be enabled under a trusted env
            'headers'       : {
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

            }
        };

        /**
         * popinLoad
         *
         * @param {string} name
         * @param {string} url
         * @param {object} [options]
         * */
        function popinLoad(name, url, options) {

            var id          = 'gina-popin-' + name;
            // popin element
            var $el         = document.getElementById(id) || null;

            if ( $el == null ) {

                var className   = self.options.class +' '+ id;
                $el             = document.createElement('div');
                $el.setAttribute('id', id);
                $el.setAttribute('class', className);
                self.$target.firstChild.appendChild($el);
            }


            if ( typeof($el['on']) == 'undefined' )
                $el['on']       = proto['on'];


            if ( typeof(options) != 'undefined' ) {
                var options = merge(options, xhrOptions);
            } else {
                var options = xhrOptions;
            }

            options.url     = url;


            if ( options.withCredentials ) {
                if ('withCredentials' in xhr) {
                    // XHR for Chrome/Firefox/Opera/Safari.
                    if (options.isSynchrone) {
                        xhr.open(options.method, options.url, options.isSynchrone)
                    } else {
                        xhr.open(options.method, options.url)
                    }
                } else if ( typeof XDomainRequest != 'undefined' ) {
                    // XDomainRequest for IE.
                    xhr = new XDomainRequest();
                    xhr.open(options.method, options.url);
                } else {
                    // CORS not supported.
                    xhr = null;
                    var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                    triggerEvent(instance, $el, 'error.' + id, result)
                }
            } else {
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            // setting up headers
            for (var hearder in options.headers) {
                xhr.setRequestHeader(hearder, options.headers[hearder]);
            }

            if (xhr) {
                // catching ready state cb
                xhr.onreadystatechange = function (event) {
                    if (xhr.readyState == 4) {
                        // 200, 201, 201' etc ...
                        if( /^2/.test(xhr.status) ) {

                            try {
                                var result = xhr.responseText;
                                if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result = JSON.parse(xhr.responseText)
                                }

                                self.eventData.success = result;
                                //console.log('making response ' + JSON.stringify(result, null, 4));

                                triggerEvent(instance, $el, 'loaded.' + id, result)

                            } catch (err) {
                                var result = {
                                    'status':  422,
                                    'error' : err.description
                                };

                                self.eventData.error = result;

                                triggerEvent(instance, $el, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            self.eventData.error = result;

                            triggerEvent(instance, $el, 'error.' + id, result)
                        }
                    }
                };

                // catching request progress
                // xhr.onprogress = function(event) {
                //     //console.log(
                //     //    'progress position '+ event.position,
                //     //    '\nprogress total size '+ event.totalSize
                //     //);
                //
                //     var percentComplete = (event.position / event.totalSize)*100;
                //     var result = {
                //         'status': 100,
                //         'progress': percentComplete
                //     };
                //
                //     self.eventData.onprogress = result;
                //
                //     triggerEvent(instance, $el, 'progress.' + id, result)
                // };

                // catching timeout
                // xhr.ontimeout = function (event) {
                //     var result = {
                //         'status': 408,
                //         'error': 'Request Timeout'
                //     };
                //
                //     self.eventData.ontimeout = result;
                //
                //     triggerEvent(instance, $el, 'error.' + id, result)
                // };


                // sending
                xhr.send();
                
                return {
                    'open': function () {
                        popinOpen(name)
                    }
                }
            }

        }

        function popinLoadContent() {

        }

        /**
         * popinOpen
         *
         * Opens a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinOpen(name) {

            // bind overlay on click
            var $overlay = $popin.childNodes[0];

            addListener(instance, $overlay, 'click', function(event) {

                // don't cancel here, it will corrupt child elements behaviors such as checkboxes and radio buttons

                if ( /gina-popin-is-active/.test(event.target.className) ) {
                    popinClose(name);
                    removeListener(instance, event.target, 'click')
                }
            });


            var id = null, $el = null;
            if ( typeof(name) == 'string' && name != '' ) {
                id = 'gina-popin-' + name;
            } else {
                id = 'gina-popin-' + this.popin;
            }

            $el = document.getElementById(id);

            $el.on('loaded', function(e, content){
                e.preventDefault();

                e.target.innerHTML = content;


                // bind with formValidator if forms are found
                if ( /<form/i.test(e.target.innerHTML) && typeof(ginaFormValidator) != 'undefined' ) {
                    var _id = null;
                    self['$forms'] = [];
                    var $forms = e.target.getElementsByTagName('form');
                    for (var i = 0, len = $forms.length; i < len; ++i) {

                        if ( !$forms[i]['id'] || typeof($forms[i]) != 'string' ) {
                            _id = $forms[i].getAttribute('id') || 'form.' + makeId();
                            $forms[i].setAttribute('id', _id);// just in case
                            $forms[i]['id'] = _id
                        } else {
                            _id = $forms[i]['id']
                        }

                        //console.log('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                        self['$forms'].push(_id);

                        ginaFormValidator.validateFormById($forms[i]['id'])
                    }
                }

                if ( !/gina-popin-is-active/.test(e.target.className) )
                    e.target.className += ' gina-popin-is-active';

                if ( !/gina-popin-is-active/.test(self.$target.firstChild.className) )
                    self.$target.firstChild.className += ' gina-popin-is-active';



                // so it can be forwarded to the handler who is listening
                triggerEvent(instance, $popin, 'ready.'+ popinInstance.id, null);

                popinInstance.target = self.$target;
                // trigger gina `popinReady` event
                triggerEvent(instance, $gina, 'popinReady', popinInstance);
            })
        }

        function popinIsOpen(name) {

        }

        /**
         * popinClose
         *
         * Closes a popin by `name` or all `is-active`
         *
         * @parama {string} [name]
         *
         * */
        function popinClose(name) {
            var id = null, $el = null;
            if ( typeof(name) == 'string' && name != '' ) {
                id = 'gina-popin-' + name;
            } else {
                id = 'gina-popin-' + this.popin;
            }

            $el = document.getElementById(id) || null;

            if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                self.$target.firstChild.className  = self.$target.firstChild.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                $el.className           = $el.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                $el.innerHTML = '';

                // removing from FormValidator instance
                var i = 0, formsLength = self['$forms'].length;
                if (self['$forms'] && self['$forms'].length > 0) {
                    for (; i < formsLength; ++i) {
                        ginaFormValidator['$forms'][ self['$forms'][i] ].destroy()
                    }
                }

                triggerEvent(instance, $el, 'close.' + id);
            }
        }

        /**
         * popinDestroy
         *
         * Destroyes a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinDestroy(name) {
            var id = 'gina-popin-' + name;
        }

        init(options);

        return popinInstance
    }




    /**
     * Gina Local Storage
     * N.B.: this is based on Web StorageAPI
     * Ses.: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
     * */
    instance['Storage'] = function(options) {

        var self = {
            'options' : {
                'bucket': 'default'
            }
        };

        var bucketInstance = {};

        var storage     = null, uuid = window.uuid;
        var entities    = {}, collections = {}; // entities & collections (data) objects
        var keywords    = ['not null']; // TODO - null, exists


        var proto = {
            'bucket'    : undefined,
            'drop'      : bucketDrop,
            'Collection': Collection
        };

        var entityProto = {
            'insert'    : collectionInsert,
            'find'      : collectionFind,
            'findOne'   : collectionFindOne,
            'update'    : null,
            'delete'    : collectionDelete,
            'drop'      : collectionDrop
        };

        var init = function(options) {

            // detect if cookies are enabled
            if ( !window.localStorage || window.localStorage && ! typeof(window.localStorage.setItem) == 'undefined' ) {
                throw new Error('Make sure your browser supports `window.localStorage` to use Gina Storage. See: `https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API#Browser_compatibility`');
            }

            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }

            self.options    = merge(options, self.options);
            storage         = window.localStorage;

            var bucketName  = self.options['bucket'];
            var bucket      = storage.getItem(bucketName);

            if (!bucket && bucketName != undefined) {
                //console.log('creating new bucket !');
                bucketCreate(bucketName);
            } else if (bucketName == undefined) {
                throw new Error('`bucket` name cannot be undefined')
            }

            bucketInstance['bucket'] = bucketName;
            bucketInstance = merge(bucketInstance, proto);
        }



        /**
         * Create bucket
         *
         * @param {string} bucketName
         * */
        var bucketCreate = function(bucketName) {
            storage.setItem(bucketName, JSON.stringify(collections));
        }

        /**
         * Drop bucket
         *
         * */
        function bucketDrop() {
            storage.removeItem(self.options['bucket']);
            bucketInstance = null;

            for (var prop in this) {
                delete this[prop]
            }

            return bucketInstance;
        }

        /**
         * Create or Get Collection by name
         *
         * @param {string} name - Collection name
         * */
        function Collection(name) {
            // retrieve collections state
            collections = JSON.parse(storage.getItem(this['bucket']));
            //console.log('collections ', (collections || null) );
            if ( typeof(collections[name]) == 'undefined' ) {
                collections[name] = [];
                storage.setItem(this['bucket'], JSON.stringify(collections));
                collections = JSON.parse(storage.getItem(this['bucket']));
            }

            entities[name]      = { '_collection': name, '_bucket': this['bucket'] };
            entities[name]      = merge(entities[name], entityProto);

            return entities[name]
        }

        /**
         * Drop collection
         *
         * @param {string} name
         * */
        function collectionDrop(name) {
            if ( typeof(collections[ this['_collection'] ]) == 'undefined' ) {
                throw new Error('Collection `'+name+'` not found')
            }

            delete entities[ this['_collection'] ]; // delete entity
            delete collections[ this['_collection'] ]; // delete data

            storage.setItem(this['_bucket'], JSON.stringify(collections));
        }

        /**
         * Insert into collection
         *
         * @param {object} content
         * */
        function collectionInsert(content) {

            // TODO - add uuid
            content['_id']         = uuid.v1();
            content['_createdAt']  = new Date().format("isoDateTime");
            content['_updatedAt']  = new Date().format("isoDateTime");

            collections[ this['_collection'] ][ collections[ this['_collection'] ].length ] = content;

            storage.setItem(this['_bucket'], JSON.stringify(collections));
        }

        /**
         * Find from collection
         *
         * // TODO - add options
         *
         * @param {object} filter
         * @param {object} [options] - e.g.: limit
         *
         * @return {array} result
         * */
        function collectionFind(filter, options) {
            if (!filter) {
                // TODO - limit of ten by
                return collections[ this['_collection'] ]
            }

            if ( typeof(filter) !== 'object' ) { // == findAll
                throw new Error('filter must be an object');
            } else {
                //console.log('search into ', this['_collection'], collections[ this['_collection'] ], collections);
                var content             = collections[ this['_collection'] ]
                    , condition         = filter.count()
                    , i                 = 0
                    , found             = []
                    , localeLowerCase   = '';

                for (var o in content) {
                    for (var f in filter) {
                        localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                        if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                            if (found.indexOf(content[o][f]) < 0 ) {
                                found[i] = content[o][f];
                                ++i
                            }

                        } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                            found[i] = content[o];
                            ++i
                        }
                    }
                }
            }

            return found
        }

        //function collectionLimit(limit) {}

        /**
         * Find a single result from collection
         *
         * e.g:
         *  // getting a record
         *  > var objectRecord = <bucket>.Collection('myBucket').findOne({_name: "someName"});
         *
         *  // updating record by adding or updating an existing property
         *  > objectRecord.myProperty = 'some value';
         *  > objectRecord.save();
         *  
         *  // deleting record
         *  > objectRecord.myProperty.delete()
         *
         * @param {object} filter
         *
         * @returns {object|array|string} result
         *
         * */
        function collectionFindOne(filter) {

            if ( typeof(filter) !== 'object' ) {
                throw new Error('filter must be an object');
            } else {
                var content             = collections[ this['_collection'] ]
                    , condition         = filter.count()
                    , i                 = 0
                    , result            = null
                    , localeLowerCase   = '';


                //console.log('condition ', condition, '\nfitler', filter, '\ncontent', content);
                if (condition == 0) return null;

                for (var o in content) {
                    for (var f in filter) {
                        localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                        if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                            if (result.indexOf(content[o][f]) < 0 ) {
                                ++i;
                                if (i === condition) {
                                    result                   = content[o];
                                    result['_index']         = o;
                                    result['_collection']    = this['_collection'];
                                    result['_bucket']        = this['_bucket'];
                                }

                            }

                        } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                            ++i;
                            if (i === condition) {
                                result                   = content[o];
                                result['_index']         = o;
                                result['_collection']    = this['_collection'];
                                result['_bucket']        = this['_bucket'];
                                result['_filter']        = filter;
                            }
                        }
                    }
                }
            }

            if (result) {
                /**
                 * save
                 *  e.g.:
                 *      // updating property
                 *      <obj>.property = 'value';
                 *      <obj>.save();
                 *
                 *      // deleting property
                 *      delete <obj>.property;
                 *      <obj>.save(true);
                 *
                 * @param {boolean} enforceDeleted
                 * */
                result['save'] = function(enforceDeleted) {

                    var enforceDeleted = enforceDeleted || false;
                    
                    try {
                        //backing up collections
                        var tmpCollections  = JSON.parse(JSON.stringify(collections));
                        var index           = this['_index'];
                        var collection      = this['_collection'];
                        var bucket          = this['_bucket'];
                        var filter          = this['_filter'];
                        this['_updatedAt']  = new Date().format("isoDateTime");

                        merge(tmpCollections[ collection ][ index ], this, true);

                        // cleaning
                        delete tmpCollections[ collection ][ index ]['_index'];
                        delete tmpCollections[ collection ][ index ]['_collection'];
                        delete tmpCollections[ collection ][ index ]['_bucket'];
                        delete tmpCollections[ collection ][ index ]['save'];
                        delete tmpCollections[ collection ][ index ]['_filter'];

                        if (enforceDeleted && typeof(tmpCollections[ collection ][ index ]) == 'object' ) {

                            var parseEnforcedCollection = function (arr, target) {
                                for (var i = 0, len = arr.length; i < len; ++i) {
                                    if ( typeof (target[i]) == 'object' && typeof(arr[i]) != 'undefined' && !Array.isArray(arr[i]) ) {
                                        parseEnforced(arr[i], target[i])
                                    } else if ( !Array.isArray(arr[i]) ){
                                        if (typeof(arr[i]) == 'undefined') {
                                            delete target[i]
                                        }
                                    } else { // is collection type
                                        parseEnforcedCollection(arr[i], target[i])
                                    }
                                }

                                return target
                            } 

                            var parseEnforced = function (obj, target) {
                                for (var prop in target) {
                                    if ( typeof (target[prop]) == 'object' && typeof(obj[prop]) != 'undefined' && !Array.isArray(obj[prop]) ) {
                                        parseEnforced(obj[prop], target[prop])
                                    } else if ( !Array.isArray(obj[prop]) ){
                                        if (typeof(obj[prop]) == 'undefined') {
                                            delete target[ prop ]
                                        }
                                    } else { // is collection type
                                        parseEnforcedCollection(obj[prop], target[prop])
                                    }
                                }

                                return target
                            };

                            if ( Array.isArray(tmpCollections[ collection ][ index ]) ) {
                                tmpCollections[ collection ][ index ] = parseEnforcedCollection(this, tmpCollections[ collection ][ index ])
                            } else if ( typeof(tmpCollections[ collection ][ index ] ) == 'object' ) {
                                tmpCollections[ collection ][ index ] = parseEnforced(this, tmpCollections[ collection ][ index ])
                            } else {
                                if (typeof(this[prop]) == 'undefined') {
                                    delete tmpCollections[ collection ][ index ]
                                }
                            }
                        }

                        collections[ collection ][ index ] = tmpCollections[ collection ][ index ];

                        // saving
                        storage.setItem(bucket, JSON.stringify(collections));

                        return collectionFindOne(filter)

                    } catch (err) {
                        throw err
                    }
                }
            }


            return result
        }

        /**
         * Delete from collection
         *
         * @param {object} filter
         *
         * @return {array} result
         * */
        function collectionDelete(filter) {

            if ( typeof(filter) !== 'object' ) {
                throw new Error('filter must be an object');
            } else {
                var content     = JSON.parse(JSON.stringify( collections[ this['_collection'] ] ))
                    //, condition = filter.count()
                    , i         = 0
                    , found     = [];

                for (var o in content) {
                    for (var f in filter) {
                        if ( filter[f] && keywords.indexOf(filter[f].toLocaleLowerCase()) > -1 && filter[f].toLowerCase() == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                            if (found.indexOf(content[o][f]) < 0 ) {
                                found[i] = content[o][f];
                                delete collections[ this['_collection'] ][o][f];
                                ++i
                            }

                        } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                            found[i] = content[o];
                            collections[ this['_collection'] ].splice(o, 1);
                            ++i
                        }
                    }
                }
            }

            if (found.length > 0 ) {
                storage.setItem(this['_bucket'], JSON.stringify(collections));
                return true
            }

            return false
        }

        init(options);


        return bucketInstance
    }


    return construct()

})();

window['gina'] = gina;