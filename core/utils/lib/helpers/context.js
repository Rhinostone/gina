/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * ContextHelper
 *
 * @package     Geena.Utils.Helpers
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */
var ContextHelper;

var EventEmitter = require('events').EventEmitter;
var extend = require('./../extend');
/**
 * ContextHelper Constructor
 * */
ContextHelper = function(contexts) {

    var _this = this;

    var init = function(contexts) {
        if ( typeof(ContextHelper.initialized) != "undefined" ) {
            return ContextHelper.instance
        } else {
            ContextHelper.initialized = true;
            ContextHelper.instance = _this
        }

        if ( typeof(contexts) == 'undefined' ) {
            var contexts = {
                paths : {}
            }
        }
        _this.contexts = contexts
    }

    joinContext = function(context) {
        extend(true, _this.contexts, context)
    }

    setContext = function(name, obj) {

        if (arguments.length > 1) {
            //console.log("Globla setter active ", name, obj);
            //if (type)
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if ( typeof(_this.contexts[name]) != "undefined") {
                extend(_this.contexts[name], obj)
            } else {
                _this.contexts[name] = obj
            }
        } else {
            //console.log("setting context ", arguments[0]);
            _this.contexts = arguments[0]
        }
    }

    getContext = function(name) {
        //console.log("getting ", name, _this.contexts.content[name], _this.contexts);
        if ( typeof(name) != 'undefined' ) {
            try {
                return _this.contexts[name]
            } catch (err) {
                return undefined
            }
        } else {
            return _this.contexts
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
    whisper = function(dictionary, replaceable) {
//        var replace = function(dic, rep) {
//            rep = JSON.stringify(rep, null, 2)
//            return JSON.parse(rep.replace(/\{(\w+)\}/g, function(s, key) {
//                return dic[key] || s;
//            }))
//        }
//        var parse = function (dictionary, obj) {
//            for (var k in obj) {
//                if ( typeof(obj[k]) == 'object') {
//                    //obj[k] = JSON.stringify(obj[k], null, 2);
//                    parse(dictionary, obj[k], replaceable)
//                } else {
//                    obj[k] = replace(dictionary, obj[k]);
//                }
//            }
//            return obj
//        }
//
//        replaceable = parse(dictionary, replaceable);
//        console.log('parsing: ', replaceable);
//        return replaceable;

        replaceable = JSON.stringify(replaceable, null, 2);
        return JSON.parse(
            replaceable.replace(/\{(\w+)\}/g, function(s, key) {
                return dictionary[key] || s;
            })
        )
    }

    init(contexts)
};

module.exports = ContextHelper;