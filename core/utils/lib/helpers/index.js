/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @module Helpers
 *
 * Gina Utils Helpers
 *
 * @package     Gina.Utils
 * @namespace   Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 */

var Helpers = {
        console     : require('./console')(),
        //DateTime    : require('./time')(),
        dateFormat  : require('./dateFormat')(),
        //Form        : require('./form')(),
        //I18n        : require('./i18n')(),
        path        : require('./path')(),
        context     : require('./context')(),
        text        : require('./text')(),
        task        : require('./task')()
};


module.exports = Helpers;


/**
 * format date
 * @return {array} Return formated date
 **/
Object.defineProperty( Date.prototype, 'format', {
    writable:   false,
    enumerable: false,
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    value: function(mask, utc){ return Helpers.dateFormat.format(this, mask, utc) }
});
/**
 * count days between current & dateTo
 * @return {array} Return formated date
 **/
Object.defineProperty( Date.prototype, 'countDaysTo', {
    writable:   false,
    enumerable: false,
    //If loaded several times, it can lead to an exception. That's why I put this.
    configurable: true,
    value: function(dateTo){ return Helpers.dateFormat.countDaysTo(this, dateTo) }
});



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

/***/
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