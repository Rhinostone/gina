/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


var merge   = require('./merge');
var console = require('./logger');
var math    = require('./math');
var checkSum = math.checkSum;

/**
 * Model uitl
 *
 * @package     Geena.Utils
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */
function ModelUtil() {
    var self = this;
    var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;

    /**
     * Init
     * @contructor
     * */
    var init = function() {

        if ( !ModelUtil.instance && !getContext('ModelUtil') ) {
            self.models = self.models || {};
            self.entities = {};
            self.files = {};
            setContext('ModelUtil', self);
            ModelUtil.instance = self;
            return self
        } else {
            if (!ModelUtil.instance) {
                ModelUtil.instance = getContext('ModelUtil')
            }
            self = ModelUtil.instance;
            return ModelUtil.instance
        }
    }

    this.setConnection = function(name, conn) {
        if (arguments.length > 1) {
            if (!self.models) {
                self.models = {}
            }
            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('Connection must have a name !')
            }

            if (typeof(self.models[name]) == 'undefined') {
                self.models[name] = {};
                self.files[name] = {}
            }


            self.models[name]['_connection'] = conn;
            self.models[name]['getConnection'] = function() {
                return self.models[name]['_connection']
            }
        } else {
            self.models = {}
        }
    }

    /**
    *
    * @param {string} name - Entity name
    * @param {object} module
    *
    * */
    this.setModelEntity = function(model, name, module) {
        if (arguments.length > 1) {
            if (!self.models) {
                self.models = {}
            }
            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('ModelUtil cannot set ModelEntity whitout a name !')
            }

            if( !self.entities[model] ) {
                self.entities[model] = {}
            }
            //if ( typeof(self.entities[model][name]) != "undefined") {
            //    merge(self.entities[model][name], module)
            //} else {
            self.entities[model][name] = module
            //}
        } else {
            self.entities[model] = arguments[0]
        }
    }

    this.updateEntityObject = function(model, name, entityObject) {

        if ( typeof(model) == 'undefined' || model == '' ) {
            throw new Error('ModelUtil cannot update EntityObject whitout a connector !')
        }

        if ( typeof(name) == 'undefined' || name == '' ) {
            throw new Error('ModelUtil cannot set ModelEntity whitout a name !')
        }

        if (!self.models[model][name]) {
            self.models[model][name] = {}
        }
        self.models[model][name] =  entityObject;

        return self.models[model][name]
    }

    this.setModel = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (!self.models[name]) {
                self.models[name] = {}
            }

            self.models[name] = merge(self.models[name], obj)

        } else {
            self.models[name] = {}
        }
    }

    this.loadAllModels = function(conf, cb) {

        if ( typeof(conf.content['connectors']) != 'undefined' && conf.content['connectors'] != null) {
            var Model = require( _( getPath('geena.core')+'/model') );
            var mObj = {};
            var models = conf.content.connectors;

            var t = 0;

            var done = function(connector) {
                if ( typeof(models[connector]) != 'undefined' ) {
                    ++t
                } else {
                    console.error('connector '+ connector +' not found in configuration')
                }

                if ( t == models.count() ) {
                    cb()
                }
            }

            for (var c in models) {//c as connector name
                //e.g. var apiModel    = new Model(config.bundle + "/api");
                // => var apiModel = getContext('apiModel')
                console.log('....model ', c + 'Model');
                mObj[c+'Model'] = new Model(conf.bundle + "/" + c);
                mObj[c+'Model']
                    .onReady(
                    function onModelReady( err, connector, entitiesObject, conn) {
                        if (err) {
                            console.error('found error ...');
                            console.error(err.stack||err.message||err);
                            done(connector)
                        } else {
                            // creating entities instances
                            for (var ntt in entitiesObject) {
                                entitiesObject[ntt] = new entitiesObject[ntt](conn)
                            }
                            done(connector)
                        }
                    })
            }
        } else {
            cb(new Error('no connector found'))
        }
    }

    this.reloadModels = function(conf, cb) {
        if ( typeof(conf.content['connectors']) != 'undefined' && conf.content['connectors'] != null ) {

            var Model = require( _( getPath('geena.core')+'/model') );
            var models = conf.content.connectors;
            var mObj = {};

            var t = 0;
            var m = [];
            for (var c in models) {
                m.push(c)
            }

            var done = function(connector, t) {
                if ( typeof(models[connector]) == 'undefined' ) {
                    console.error('connector '+ connector +' not found in configuration')
                }
                if ( t == models.count() ) {
                    cb()
                } else {
                    reload(t)
                }
            };

            var reload = function(i) {

                mObj[m[i]+'Model'] = new Model(conf.bundle + '/' + m[i]);
                mObj[m[i]+'Model']
                    .reload( conf, function onReload(err, connector, entitiesObject, conn) { // entities to reload
                        if (err) {
                            console.error(err.stack||err.message||err)
                        } else {
                            self.models[connector] = {};
                            for (var ntt in entitiesObject) {
                                entitiesObject[ntt] = new entitiesObject[ntt](conn);
                            }
                        }
                        done(connector, i+1);
                    })
            }
            reload(0)
        } else {
            cb(new Error('no connector found'))
        }
    }


    getModel = function(model) {
        if ( typeof(model) != 'undefined' ) {
            try {
                return self.models[model]
            } catch (err) {
                return undefined
            }
        } else {
            return self.models
        }
    }

    /**
     * Get Model Entity
     *
     * @param {string} model
     * @param {string} entityName
     * @param {object} conn
     *
     * @return {object} entity
     * */
    getModelEntity = function(model, entityName, conn) {
        if ( typeof(entityName) != 'undefined' ) {
            try {
                var shortName = entityName.substr(0, 1).toLowerCase() + entityName.substr(1);
                if ( self.models[model][shortName] ) {
                    return self.models[model][shortName]
                }

                var entityObj = new self.entities[model][entityName](conn);

                return self.models[model][shortName] || entityObj
            } catch (err) {
                return undefined
            }
        } else {
            return self.entities[model]
        }
    }

    return init()
}

module.exports = ModelUtil