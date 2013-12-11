/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
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
var extend = require('./../extend.js');
/**
 * ContextHelper Constructor
 * */
ContextHelper = function(contexts){

    var _this = this;

    var init = function(contexts){
        if ( typeof(ContextHelper.initialized) != "undefined" ) {
            //console.log("class ContextHelper already initialized");
            return ContextHelper.instance;
        } else {
            //console.log("class ContextHelper NOT initialized");
            ContextHelper.initialized = true;
            ContextHelper.instance = _this;
        }

        if ( typeof(contexts) == 'undefined' ) {
            var contexts = {
                paths : {}
            };
        }
        _this.contexts = contexts;
    };

    joinContext = function(context){
        //console.log("adding new context\n",_this.topics, "\nVS\n", topic);
        extend(true, _this.contexts, context);
    };

    setContext = function(name, obj){

        if (arguments.length > 1) {
            //console.log("Globla setter active ", name, obj);
            //if (type)
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global';
            }

            if ( typeof(_this.contexts[name]) != "undefined") {
                extend(_this.contexts[name], obj);
            } else {
                _this.contexts[name] = obj;
            }
        } else {
            //console.log("setting context ", arguments[0]);
            _this.contexts = arguments[0];
        }
    };

    getContext = function(name){
        //console.log("getting ", name, _this.contexts.content[name], _this.contexts);
        if ( typeof(name) != 'undefined' ) {
            try {
                return _this.contexts[name];
                //return _this.contexts.content[name];
            } catch (err) {
                return undefined;
            }
        } else {
            return _this.contexts;
        }
    };

    /**
     * Whisper
     * Convert replace constant names dictionary by its value
     *
     * @param {object} dictionary
     * @param {object} replaceable
     *
     * @return {object} revealed
     * */
    whisper = function(dictionary, replaceable){
        //console.error("hum ?? ",  replaceable , " \nDIco", dictionary);
//        if (process.platform == 'win32') {
//            //replaceable = ( JSON.stringify(replaceable, null, 4) ).replace(/\//g, '\\');
//            //replaceable = ( JSON.stringify(replaceable) ).replace(/\//g, '_');
//            replaceable = JSON.stringify(replaceable, null, 1).replace(/\//g, '\\');
        replaceable = JSON.stringify(replaceable, null, 2);
//        } else {
//            replaceable = ( JSON.stringify(replaceable) );
//        }
        //dictionary = dictionary.replace(/\\/g, '_');
//        console.error("poutin !! ", replaceable.replace(/\{(\w+)\}/g, function(s, key) {
//            return dictionary[key] || s;
//        }));
//        console.error("poutin ", replaceable.replace(/\{(\w+)\}/g, function(s, key) {
//            return dictionary[key] || s;
//        })  );
        //process.exit(42);
        return JSON.parse(
            replaceable.replace(/\{(\w+)\}/g, function(s, key) {
                return dictionary[key] || s;
            })
        );
    };

    init(contexts);
};

module.exports = ContextHelper;