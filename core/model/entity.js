/*
 * This file is part of the gina package.
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var utils = require('gina').utils;
var console = utils.logger;
var helpers = utils.helpers;
var inherits = utils.inherits;
var modelUtil = new utils.Model();
//var Config = require('../config');
//var config = new Config();

/**
 * @class Model.EntitySuper class
 *
 *
 * @package     Gina
 * @namespace   Gina.Model
 * @author      Rhinostone <gina@rhinostone.com>
 * @api         Public
 */
function EntitySuper(conn) {

    var self = this;

    var init = function() {
        if (!EntitySuper[self.name]) {
            EntitySuper[self.name] = {}
        }

        if ( !EntitySuper[self.name].instance ) {
            if (EntitySuper[self.name].initialized) {
                return setListeners(EntitySuper[self.name].instance)
            } else {
                return setListeners()
            }
        } else {
            return EntitySuper[self.name].instance
        }
    }

    /**
     * Set all main listenners at once
     * */
    var setListeners = function(instance) {
        if ( !EntitySuper[self.name].initialized ) {
            EntitySuper[self.name].initialized = true;
            // get entity objet
            var entity = instance || self.getEntity(self.name);
            if (!entity) return false;

            // use this property inside your entity to disable listeners
            if (entity.hasOwnEvents) return false;

            var entityName = self.name.substr(0,1).toLowerCase() + self.name.substr(1);
            var shortName = entityName.replace(/Entity/, '');

            var events = [], i = 0, cb = {};
            var eCount = 5; // default max listeners is 5
            for (var f in entity) {
                if (
                    typeof(entity[f]) == 'function' &&
                    !self[f] &&
                    f != 'onComplete' &&
                    f.substr(f.length-4) !== 'Sync' &&
                    f.substr(f.length-4) !== 'Task' &&
                    f.substr(f.length-4) !== '_task' &&
                    f.substr(f.length-5) !== '_sync' &&
                    f.substr(f.length-5) !== '-sync'
                ) {
                    events[i] = shortName +'#'+ f;
                    ++i;

                    console.debug('setting listener for: [ '+self.model+'/'+self.name+'::' + f +'(...) ]');
                    entity[f] = (function(e, ev) {
                        var cached = entity[ev];

                        return function () {
                            //if (!entity.trigger) {
                            //    entity.trigger = e
                            //}
                            this[ev].onComplete = function (cb) {
                                entity.once(entity.name + '#' + ev, function (args) {
                                    cb.apply(this[ev], args)
                                })
                            }

                            cached.apply(this[ev], arguments);
                            return this[ev] // chaining event & method
                        }
                    }(shortName +'#'+ f, f))
                }
            }
            eCount += i;

            self.setMaxListeners(entity.maxListeners || eCount);
            //entity.setMaxListeners(entity.maxListeners || eCount);

            console.debug('['+self.name+']setting max listeners to: ' + (entity.maxListeners || eCount) );

            for (var i=0; i<events.length; ++i) {

                entity.removeAllListeners(events[i]); // added on october 1st to prevent adding new listners on each new querie

                entity.on(events[i], (function(e) {
                    return function() {
                        console.log('calling back from event: ', e);
                        var f = e.split(/\#/)[1];
                        entity.emit(entity.name+'#'+f, arguments);
                        // won't work here in some cases... save it for another case... out of here
                        //if (this.trigger === e) {
                        //}
                    }
                }(events[i])))
            }

            EntitySuper[self.name].instance =  entity;
            // now merging with the current entity object
            return modelUtil.updateEntityObject(self.model, entityName, entity)
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