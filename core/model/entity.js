/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
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

    this._maxListeners  = 50;
    var self            = this;
    var cacheless       = (process.env.IS_CACHELESS == 'false') ? false : true;

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


    var setListener = function(trigger) {

        //self.removeAllListener(trigger);
        if ( !/\#/.test(trigger) ) {
            throw new Error('trigger name not properly set: use `#` between the entity name and the method reference');
            process.exit(1)
        } else {

            self._triggers.push(trigger);

            ++self._maxListeners;
            self.setMaxListeners(self._maxListeners);

            var alias       = trigger.split(/\#/)[1]
                , method    = alias.replace(/[0-9]/g, '')
                , events    = null
                , i         = 0
            ;

            self._listeners.push({
                shortName   : trigger,
                method      : method,
                entityName  : self.name
            });

            events  = self._listeners;
            i       = events.length-1;

            if ( self._triggers.indexOf(events[i].shortName) > -1 ) {
                // reusable event
                self.on(events[i].shortName, function () {
                    //debugger;
                    this._callbacks[trigger.replace(/[0-9]/g, '')].apply(this[method], arguments);
                })
            }
        }
    }

    /**
     * Set all main listenners at once
     * TODO - add a mutex in case you have 2 threads trying to access the same method at the same time
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

            var events      = []
                , triggers  = []
                , i         = 0
                , cb        = {};

            for (var f in entity) {
                if (
                    typeof(entity[f]) == 'function' &&
                    !self[f] &&
                    f != 'onComplete'
                ) {
                    events[i] = {
                        shortName   : shortName +'#'+ f,
                        method      : f,
                        entityName  : entity.name
                    };

                    triggers.push(shortName +'#'+ f);
                    ++i;
                }
            }

            entity._listeners       = events;
            entity._triggers        = triggers;
            entity._callbacks       = {};
            entity._maxListeners    += i; // default max listeners is 10
            entity.setMaxListeners(entity._maxListeners);
            //console.debug('['+self.name+'] setting max listeners to: ' + (entity.maxListeners || eCount) );

            var f = null;
            for (var i=0; i<events.length; ++i) {

                entity.removeAllListeners(events[i].shortName); // added on october 1st to prevent adding new listners on each new querie
                //console.debug('placing event: '+ events[i].shortName +'\n');
                f = events[i].method;
                // only if method content is about the event
                if ( new RegExp('('+ events[i].shortName +'\'|'+ events[i].shortName +'\"|'+ events[i].shortName +'$)').test(entity[f].toString()) ) {

                    entity[f] = (function onEntityEvent(e, m, i) {
                        //console.debug('setting listener for: [ '+self.model+'/'+self.name+'::' + e + ' ]');

                        var cached = entity[m];

                        return function () {

                            // retrieving local arguments, & binding it to the event callback
                            cached.apply(this[m], arguments);

                            this[m].onComplete = function (cb) {

                                //Setting local listener : normal case
                                if ( entity._triggers.indexOf(events[i].shortName) > -1 ) {

                                    entity.once(events[i].shortName, function () { // cannot be `entity.on` for prod/stage
                                        cb.apply(this[m], arguments)
                                    });
                                    // backing up callback
                                    entity._callbacks[events[i].shortName] = cb;
                                }
                            }


                            return this[m] // chaining event & method
                        };


                    }(events[i].shortName, f, i))
                }
            };

            EntitySuper[self.name].instance =  entity;

            if ( !/Entity$/.test(entityName) ) {
                entityName = entityName + 'Entity'
            }
            // now merging with the current entity object
            return modelUtil.updateEntityObject(self.bundle, self.model, entityName, entity)
        }
    }

    var arrayClone = function(arr, i) {
        var copy = new Array(i);
        while (i--)
            copy[i] = arr[i];
        return copy;
    }

    var emitOne = function(handler, isFn, self, arg1) {
        if (isFn)
            handler.call(self, arg1);
        else {
            var len = handler.length;
            var listeners = arrayClone(handler, len);
            for (var i = 0; i < len; ++i)
                listeners[i].call(self, arg1);
        }
    }
    var emitTwo = function(handler, isFn, self, arg1, arg2) {
        if (isFn)
            handler.call(self, arg1, arg2);
        else {
            var len = handler.length;
            var listeners = arrayClone(handler, len);
            for (var i = 0; i < len; ++i)
                listeners[i].call(self, arg1, arg2);
        }
    }
    var emitThree = function(handler, isFn, self, arg1, arg2, arg3) {
        if (isFn)
            handler.call(self, arg1, arg2, arg3);
        else {
            var len = handler.length;
            var listeners = arrayClone(handler, len);
            for (var i = 0; i < len; ++i)
                listeners[i].call(self, arg1, arg2, arg3);
        }
    }

    var emitMany = function(handler, isFn, self, args) {
        if (isFn)
            handler.apply(self, args);
        else {
            var len = handler.length;
            var listeners = arrayClone(handler, len);
            for (var i = 0; i < len; ++i)
                listeners[i].apply(self, args);
        }
    }

    /**
     * custom emit based on node.js emit source
     * Added on 2016-02-09
     * */
    this.emit = function emit(type) {
        // BO Added to handle trigger with increment when `emit occurs whithin a loop or recursive function
        if ( self._triggers && self._triggers.indexOf(type) == -1 && self._triggers.indexOf(type.replace(/[0-9]/g, '')) > -1 ) {
            setListener(type)
        }
        // EO Added to handle trigger with increment

        var er, handler, len, args, i, events, domain;
        var needDomainExit = false;
        var doError = (type === 'error');

        events = this._events;
        if (events)
            doError = (doError && events.error == null);
        else if (!doError)
            return false;

        domain = this.domain;

        // If there is no 'error' event listener then throw.
        if (doError) {
            er = arguments[1];
            if (domain) {
                if (!er)
                    er = new Error('Uncaught, unspecified "error" event');
                er.domainEmitter = this;
                er.domain = domain;
                er.domainThrown = false;
                domain.emit('error', er);
            } else if (er instanceof Error) {
                throw er; // Unhandled 'error' event
            } else {
                // At least give some kind of context to the user
                var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
                err.context = er;
                throw err;
            }
            return false;
        }

        handler = events[type];

        if (!handler)
            return false;

        if (domain && this !== process) {
            domain.enter();
            needDomainExit = true;
        }

        var isFn = typeof handler === 'function';
        len = arguments.length;
        switch (len) {
            // fast cases
            case 1:
                emitNone(handler, isFn, this);
                break;
            case 2:
                emitOne(handler, isFn, this, arguments[1]);
                break;
            case 3:
                emitTwo(handler, isFn, this, arguments[1], arguments[2]);
                break;
            case 4:
                emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
                break;
            // slower
            default:
                args = new Array(len - 1);
                for (i = 1; i < len; i++)
                    args[i - 1] = arguments[i];
                emitMany(handler, isFn, this, args);
        }

        if (needDomainExit)
            domain.exit();

        return true;
    }


    /**
     * Get connection from entity
     * */
    this.getConnection = function() {
        return ( typeof(conn) != 'undefined' ) ? conn : null;
    }

    this.getEntity = function(entity) {
        entity = entity.substr(0,1).toUpperCase() + entity.substr(1);
        if ( !/Entity$/.test(entity) ) {
            entity = entity + 'Entity'
        }

        try {
            return getModelEntity(self.bundle, self.model, entity, conn)

        } catch (err) {
            throw err;
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