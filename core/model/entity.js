/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var Entity;

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

module.exports = Entity