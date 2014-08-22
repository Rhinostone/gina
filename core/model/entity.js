/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var utils   = require('geena').utils;
var inherits = utils.inherits;
//var Config = require('../config');
//var config = new Config();

/**
 * @class Model.{Model}.EntitySuper class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model.{Model}
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
function EntitySuper(conn) {

    var self = this;

    var init = function() {
        if (!EntitySuper[self.name]) {
            EntitySuper[self.name] = {}
        }
        if ( !EntitySuper[self.name].instance ) {
            EntitySuper[self.name].instance = self;
            return self;
        } else {
            return EntitySuper[self.name].instance;
        }
    }

    this.getConnection = function() {
        return ( typeof(conn) != 'undefined' ) ? conn : null;
    }

    this.getEntity = function(entity) {
        entity = entity.substr(0,1).toUpperCase() + entity.substr(1);
        if (entity.substr(entity.length-6) != 'Entity') {
            entity = entity + 'Entity'
        }

        try {
            return getModelEntity(self.model, entity, conn)
        } catch (err) {
            throw new Error(err.stack);
            return null
        }
    };

    return init()
};

EntitySuper = inherits(EntitySuper, EventEmitter);
module.exports = EntitySuper