/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var EventEmitter  = require('events').EventEmitter;
var utils   = require('geena').utils;
var inherits = utils.inherits;

/**
 * @class Model.{Model}.Entity class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model.{Model}
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
function Entity(configuration, conn) {

    var _this = this;
    var self = {};

    this.setListeners = function(list) {
//        for (var e=0; e<list.length; ++e) {
//
//        }
    }

    this.getConnection = function() {
        return ( typeof(conn) != 'undefined' ) ? conn : null;
    }

};

inherits(Entity, EventEmitter);
module.exports = Entity