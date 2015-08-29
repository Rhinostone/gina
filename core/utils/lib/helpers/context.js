/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var os      = require('os');
var merge   = require('./../merge');
var console = require('./../logger');

/**
 * ContextHelper
 *
 * @package     Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */
function ContextHelper(contexts) {

    var self = this;

    /**
     * ContextHelper Constructor
     * */
    var init = function(contexts) {
        if ( typeof(ContextHelper.initialized) != "undefined" ) {
            return ContextHelper.instance
        } else {
            ContextHelper.initialized = true;
            ContextHelper.instance = self
        }

        if ( typeof(contexts) == 'undefined' ) {
            var contexts = {
                paths : {}
            }
        }
        self.contexts = contexts;
        return self
    }

    this.configure = function(contexts) {
        joinContext(contexts)
    }

    joinContext = function(context) {
        merge(true, self.contexts, context)
    }

    setContext = function(name, obj, force) {

        if (arguments.length > 1) {
            //console.log("Globla setter active ", name, obj);
            //if (type)
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if ( typeof(self.contexts[name]) != "undefined" && !force) {
                merge(self.contexts[name], obj)
            } else {
                self.contexts[name] = obj
            }
        } else {
            //console.log("setting context ", arguments[0]);
            self.contexts = arguments[0]
        }
    }

    getContext = function(name) {
        //console.log("getting ", name, self.contexts.content[name], self.contexts);
        if ( typeof(name) != 'undefined' ) {
            try {
                return self.contexts[name]
            } catch (err) {
                return undefined
            }
        } else {
            return self.contexts
        }
    }

    /**
     * Get bundle library
     *
     * @param {string} [ bundle ] - Bundle name
     * @param {string} lib  - Library name (module or file)
     *
     * */
    getLib = function(bundle, lib) {
        if (arguments.length == 1 || !bundle) {
            //console.debug(
            //    '\n[ 0 ] = '+ __stack[0].getFileName(),
            //    '\n[ 1 ] = '+ __stack[1].getFileName(),
            //    '\n[ 2 ] = '+ __stack[2].getFileName(),
            //    '\n[ 3 ] = '+ __stack[3].getFileName(),
            //    '\n[ 4 ] = '+ __stack[4].getFileName(),
            //    '\n[ 5 ] = '+ __stack[5].getFileName(),
            //    '\n[ 6 ] = '+ __stack[6].getFileName()
            //);
            var lib         = (arguments.length == 1) ? bundle : lib
                , libPath   = null
                , file      = ( !/node_modules/.test(__stack[1].getFileName()) ) ?  __stack[1].getFileName() : __stack[2].getFileName()
                , a         = file.replace('.js', '').split('/')
                , i         = a.length-1
                , conf      = getContext('gina.config')
                , bundles   = conf.bundles
                , env       = conf.env
                , cacheless = conf.isCacheless()
                , bundle    = null
                , index     = 0;

            for (; i >= 0; --i) {
                index = bundles.indexOf(a[i]);
                if ( index > -1 ) {
                    bundle = bundles[index];
                    break
                }
            }
        } else {
            var libPath     = null
                , conf      = getContext('gina.config')
                , env       = conf.env
                , cacheless = conf.isCacheless();
        }

        if ( typeof(lib) != 'undefined' ) {

            try {
                libPath = _(conf.bundlesConfiguration.conf[bundle][env].libPath +'/'+ lib, true);
                if (cacheless) delete require.cache[libPath];

                // init with options
                return require(libPath)({
                    bundle      : bundle,
                    env         : env,
                    cacheless   : cacheless,
                    libPath     : conf.bundlesConfiguration.conf[bundle][env].libPath
                })
            } catch (err) {
                console.error(err.stack||err.message||err);
                return undefined
            }
        } else {
            console.error( new Error("no `lib` found"))
            return undefined
        }

    }

    /**
     * Whisper
     * Convert replace constant names dictionary by its value
     *
     * @param {object} dictionary
     * @param {object} replaceable
     *
     * @return {object} revealed
     * */
    whisper = function(dictionary, replaceable, rule) {
        var s, key;
        if ( typeof(rule) != 'undefined') {
            return replaceable.replace(rule, function(s, key) {
                return dictionary[key] || s;
            })
        } else {

            if ( typeof(replaceable) == 'object' &&  !/\[native code\]/.test(replaceable.constructor) ||  typeof(replaceable) == 'function' /** && /Object/.test(replaceable.constructor) */ ) { // /Object/.test(replaceable.constructor)
                for (var attr in replaceable) {
                    if ( typeof(replaceable[attr]) != 'function') {
                        replaceable[attr] = (typeof(replaceable[attr]) != 'string' && typeof(replaceable[attr]) != 'object') ? JSON.stringify(replaceable[attr], null, 2) : replaceable[attr];
                        if (replaceable[attr] && typeof(replaceable[attr]) != 'object') {
                            replaceable[attr] = replaceable[attr].replace(/\{(\w+)\}/g, function(s, key) {
                                return dictionary[key] || s;
                            })
                        }
                    }
                }
                return replaceable
            } else { // mixing with classes
                replaceable = JSON.stringify(replaceable, null, 2);

                return JSON.parse(
                    replaceable.replace(/\{(\w+)\}/g, function(s, key) {
                        return dictionary[key] || s;
                    })
                )
            }
        }
    }

    isWin32 = function() {
        return (os.platform() == 'win32') ? true : false;
    }

    return init(contexts)
};

module.exports = ContextHelper;