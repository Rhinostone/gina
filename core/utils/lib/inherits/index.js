/**
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
'use strict';
var Inherits;

/**
 * @class Inherits
 *
 * @package geena.utils
 * @namesame geena.utils.inherits
 * @author Rhinostone <geena@rhinostone.com>
 *
 * @api Public
 * */
Inherits = function(a, b) {
    /**
     * init
     * @constructor
     * */
    var init = function(a, b) {
        var err = check(a, b);
        if (!err) {

            var c = ( function() {
                var cache = a;
                return function() {
                    //super class
                    this.s = function(){};
                    this.s.apply(b, arguments);
                    b.apply(this.s, arguments);
                    if (this.s.protected != undefined) {
                        for (var prop in this.s.protected) {
                            this[prop] = this.s.protected[prop]
                        }
                    } else {
                        for (var prop in this.s) {
                            this[prop] = this.s[prop]
                        }
                    }
                    cache.apply(this, arguments);
                    delete this.s
                }
            }());

            b.prototype = {};
            a.prototype = Object.create(b.prototype, {});
            c.prototype = Object.create(a.prototype, {});

            return c
        } else {
            throw new Error(err)
        }
    }

    var check = function(a, b) {
        if ( typeof(a) == 'undefined' || typeof(b) == 'undefined') {
            return 'inherits(a, b): neither [ a ] nor [ b ] can\'t be undefined or null'
        }
        return false
    }

    return init
};

module.exports = Inherits()
