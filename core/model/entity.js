/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var utils           = require('gina').utils;
var console         = utils.logger;
var helpers         = utils.helpers;
var inherits        = utils.inherits;
var modelUtil       = new utils.Model();

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
                    f != 'onComplete' //&&
                    //f.substr(f.length-4) !== 'Sync' &&  // deprecated
                    //f.substr(f.length-4) !== 'Task' &&
                    //f.substr(f.length-4) !== '_task' &&
                    //f.substr(f.length-5) !== '_sync' &&
                    //f.substr(f.length-5) !== '-sync'
                ) {
                    events[i] = {
                        shortName   : shortName +'#'+ f,
                        method      : f,
                        entityName  : entity.name
                    };
                    ++i;
                }
            }

            eCount += i;
            self.setMaxListeners(entity.maxListeners || eCount);
            //console.debug('['+self.name+'] setting max listeners to: ' + (entity.maxListeners || eCount) );

            var f = null;
            for (var i=0; i<events.length; ++i) {

                entity.removeAllListeners(events[i].shortName); // added on october 1st to prevent adding new listners on each new querie
                //console.debug('placing event: '+ events[i].shortName +'\n');
                f = events[i].method;
                // only if method content is about the event
                if ( new RegExp('('+ events[i].shortName +'\'|'+ events[i].shortName +'\"|'+ events[i].shortName +'$)').test(entity[f].toString()) ) {
                    entity[f] = (function(e, m, i) {
                        //console.debug('setting listener for: [ '+self.model+'/'+self.name+'::' + e + ' ]');

                        var cached = entity[m];

                        return function () {
                            var args = arguments;
                            this[m].onComplete = function (cb) {
                                //Setting local listener
                                entity.once(events[i].shortName, function () {
                                    cb.apply(this[m], arguments)
                                });

                                // running local code
                                cached.apply(this[m], args);
                            }

                            return this[m] // chaining event & method
                        };


                    }(events[i].shortName, f, i))
                }
            };

            EntitySuper[self.name].instance =  entity;

            // now merging with the current entity object
            return modelUtil.updateEntityObject(self.bundle, self.model, entityName, entity)
        }
    }

    /**
     * Get connection from entity
     * */
    this.getConnection = function() {
        return ( typeof(conn) != 'undefined' ) ? conn : null;
    }

    this.getEntity = function(entity) {
        entity = entity.substr(0,1).toUpperCase() + entity.substr(1);
        if (entity.substr(entity.length-6) != 'Entity') {
            entity = entity + 'Entity'
        }

        try {
            return getModelEntity(self.bundle, self.model, entity, conn)

        } catch (err) {
            throw new Error(err.stack);
            return null
        }
    }



    ///**
    // * Get config
    // *
    // * @param {string} [name] - Conf name without extension.
    // * @return {object} result
    // *
    // * TODO - Protect result
    // * */
    //this.getConfig = function(name) {
    //    var tmp = null;
    //
    //    if ( typeof(name) != 'undefined' ) {
    //        try {
    //            // needs to be read only
    //            tmp = JSON.stringify(local.options.conf.content[name]);
    //            return JSON.parse(tmp)
    //        } catch (err) {
    //            return undefined
    //        }
    //    } else {
    //        tmp = JSON.stringify(local.options.conf);
    //        return JSON.parse(tmp)
    //    }
    //}

    return init()
};

EntitySuper = inherits(EntitySuper, EventEmitter);
module.exports = EntitySuper