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
var modelHelper = new utils.model();

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
            setListeners();
            EntitySuper[self.name].instance = self;
            return self
        } else {
            return EntitySuper[self.name].instance;
        }
    }

    /**
     * Set all main listenners at once
     * */
    var setListeners = function() {
        if ( !EntitySuper[self.name].hasOwnEvents ) {
            EntitySuper[self.name].hasOwnEvents = true;
            // get entity objet
            var entity = self.getEntity(self.name);
            var shortName = self.name.replace(/Entity/, '').toLocaleLowerCase();
            var events = [], i = 0;

            for (var f in entity) {
                if ( typeof(entity[f]) == 'function' && !self[f] && f != 'onComplete') {
                    events[i] = shortName +'#'+ f;
                    ++i;


                    console.log('setting listner ' + f);
                }
            }

            entity.onComplete = function(cb) {
                // Loop on registered events
                for (var i=0; i<events.length; ++i) {
                    entity.once(events[i], function(err, data) {
                        //cb(self._cbData['user#set'].err, self._cbData['user#set'].data);
                        cb(err, data)
                    })
                }
            };
            // now merge with the current entity object
            modelHelper.updateEntityObject(self.model, shortName+'Entity', entity);
            return
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
    }

    // self.trigger might be useless because of the existing self.emit(evt, err, data)
    ///**
    // * Trigger callback
    // *
    // * */
    //this.trigger = function(err, data, evt) {
    //    // eg.: evt = 'user#set';
    //    self.emit(evt, err, data);
    //};

    return init()
};

EntitySuper = inherits(EntitySuper, EventEmitter);
module.exports = EntitySuper