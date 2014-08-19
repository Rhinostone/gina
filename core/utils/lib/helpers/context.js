/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var os = require('os');
var merge = require('./../merge');

/**
 * ContextHelper
 *
 * @package     Geena.Utils.Helpers
 * @author      Rhinostone <geena@rhinostone.com>
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
        //self.contexts = merge(true, self.contexts, contexts);
        joinContext(contexts)
    }

    joinContext = function(context) {
        merge(true, self.contexts, context)
    }

    setContext = function(name, obj) {

        if (arguments.length > 1) {
            //console.log("Globla setter active ", name, obj);
            //if (type)
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if ( typeof(self.contexts[name]) != "undefined") {
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