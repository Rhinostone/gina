/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Geena.Core.Dev Class
 * Must be loaded by hand.
 *
 * @package    Geena.Core
 * @author     Rhinostone <geena@rhinostone.com>
 */



//By default
var dev = {
    Factory : require('./lib/factory'),
    Class   : require('./lib/class')
};

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

module.exports = dev;