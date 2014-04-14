/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var Entity;

//var util = require('util');
//var EventEmitter = require('events').EventEmitter;

/**
 * @class Model.{Model}.Entity class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model.{Model}
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */

Entity = function(configuration, conn) {

    var _this = this;
    var self = {
        conn : conn
    };

    this.getConfig = function() {
        console.log("{Entity}Entity super ON !", configuration);
        return configuration
    }


    this.getConnection = function() {
        return ( typeof(self.conn) != 'undefined' ) ? self.conn : null;
    }

};

//util.inherits(Entity, EventEmitter);
module.exports = Entity