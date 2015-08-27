/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var merge       = require('./merge');
var console     = require('./logger');
var math        = require('./math');
var checkSum    = math.checkSum;

/**
 * Model uitl
 *
 * @package     Gina.Utils
 * @author      Rhinostone <gina@rhinostone.com>
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

    this.setConnection = function(bundle, name, conn) {
        if (arguments.length > 1) {
            if (!self.models) {
                self.models = {}
            }
            if (!self.models[bundle]) {
                self.models[bundle] = {}
            }
            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('Connection must have a name !')
            }

            if (typeof(self.models[bundle][name]) == 'undefined') {
                self.models[bundle][name] = {};
                if (!self.files[bundle]) {
                    self.files[bundle] = {}
                }
                self.files[bundle][name] = {}
            }


            self.models[bundle][name]['_connection'] = conn;
        } else {
            self.models[bundle] = {}
        }
    }

    /**
    *
    * @param {string} name - Entity name
    * @param {object} module
    *
    * */
    this.setModelEntity = function(bundle, model, name, module) {
        if (arguments.length > 1) {
            if (!self.entities) {
                self.entities = {}
            }

            if (!self.entities[bundle]) {
                self.entities[bundle] = {}
            }

            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('ModelUtil cannot set ModelEntity whitout a name !')
            }

            if( !self.entities[bundle][model] ) {
                self.entities[bundle][model] = {}
            }

            self.entities[bundle][model][name] = module

        } else {
            self.entities[bundle][model] = arguments[0]
        }
    }

    this.updateEntityObject = function(bundle, model, name, entityObject) {

        if ( typeof(model) == 'undefined' || model == '' ) {
            throw new Error('ModelUtil cannot update EntityObject whitout a connector !')
        }

        if ( typeof(name) == 'undefined' || name == '' ) {
            throw new Error('ModelUtil cannot set ModelEntity whitout a name !')
        }

        if (!self.models[bundle][model][name]) {
            self.models[bundle][model][name] = {}
        }
        self.models[bundle][model][name] =  entityObject;

        return self.models[bundle][model][name]
    }

    this.setModel = function(bundle, name, obj) {
        if (arguments.length > 2) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (!self.models[bundle]) {
                self.models[bundle] = {}
            }

            if (!self.models[bundle][name]) {
                self.models[bundle][name] = {}
            }

            self.models[bundle][name] = merge(self.models[bundle][name], obj)

        } else {
            self.models[bundle][name] = {}
        }
    }

    this.loadAllModels = function(bundles, configuration, env, cb) {

        var loadModel = function(b, bundles, configuration, env, cb) {
            var bundle          = bundles[b]
                , len           = bundles.length
                , conf          = configuration[bundle][env]
                , connectors    = conf.content['connectors'] || undefined;

            if ( typeof(connectors) != 'undefined' && connectors != null) {
                var Model = require( _( getPath('gina.core')+'/model') );
                var mObj = {};

                var models = connectors;

                var t = 0;

                var done = function(connector) {
                    if ( typeof(models[connector]) != 'undefined' ) {
                        ++t
                    } else {
                        console.error('connector '+ connector +' not found in configuration')
                    }

                    if ( t == models.count() ) {
                        ++b
                        if (b == len) {
                            cb()
                        } else {
                            loadModel(b, bundles, configuration, env, cb)
                        }
                    }
                }

                for (var c in models) {//c as connector name
                    //e.g. var apiModel    = new Model(config.bundle + "/api");
                    // => var apiModel = getContext('apiModel')
                    console.debug('....model ', conf.bundle + "/"+c + 'Model');
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
                //cb(new Error('no connector found'));
                console.error( new Error('no connector found for bundle [ '+ bundle +' ]') );
                loadModel(b+1, bundles, configuration, env, cb)
            }
        };

        loadModel(0, bundles, configuration, env, cb)
    }

    this.reloadModels = function(conf, cb) {

        if ( typeof(conf.content['connectors']) != 'undefined' && conf.content['connectors'] != null ) {
            var bundle  = conf.bundle;
            var Model   = require( _( getPath('gina.core')+'/model') );
            var models  = conf.content.connectors;
            var mObj    = {};

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
                            self.models[bundle][connector] = {};
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


    /**
     * Get Model by [ bundleName ] & modelName
     *
     * @param {string} [ bundle ] - Bundle name
     * @param {string} model - Model name
     *
     * @return {object} model - Model entities
     * */
    getModel = function(bundle, model) {

        if (arguments.length == 1 || !bundle) {
            //console.debug(
            //    '\n[ 0 ] = '+ __stack[0].getFileName(),
            //    '\n[ 1 ] = '+ __stack[1].getFileName(),
            //    '\n[ 2 ] = '+ __stack[2].getFileName(),
            //    '\n[ 3 ] = '+ __stack[3].getFileName(),
            //    '\n[ 4 ] = '+ __stack[4].getFileName(),
            //    '\n[ 5 ] = '+ __stack[5].getFileName(),
            //    '\n[ 6 ] = '+ __stack[6].getFileName()
            //);
            var model       = (arguments.length == 1) ? bundle : model
                , file      = ( !/node_modules/.test(__stack[1].getFileName()) ) ?  __stack[1].getFileName() : __stack[2].getFileName()
                , a         = file.replace('.js', '').split('/')
                , i         = a.length-1
                , bundles   = getContext('gina.config').bundles
                , bundle    = null
                , index     = 0;

            for (; i >= 0; --i) {
                index = bundles.indexOf(a[i]);
                if ( index > -1 ) {
                    bundle = bundles[index];
                    break
                }
            }
        }

        if ( typeof(model) != 'undefined' ) {
            try {
                self.models[bundle][model]['getConnection'] = function() {
                    return self.models[bundle][model]['_connection']
                }
                return self.models[bundle][model]
            } catch (err) {
                return undefined
            }
        } else {
            return self.models[bundle]
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
    getModelEntity = function(bundle, model, entityName, conn) {
        if ( typeof(entityName) != 'undefined' ) {
            try {
                var shortName = entityName.substr(0, 1).toLowerCase() + entityName.substr(1);
                if ( self.models[bundle][model][shortName] ) {
                    return self.models[bundle][model][shortName]
                }

                var entityObj = new self.entities[bundle][model][entityName](conn);

                return self.models[bundle][model][shortName] || entityObj
            } catch (err) {
                return undefined
            }
        } else {
            return self.entities[bundle][model]
        }
    }


    Collection = function(content) {
        var content = content || [];

        this.find = function(filter) {
            if ( typeof(filter) !== 'object' ) {
                throw new Error('filter must be an object');
            } else {
                var condition = filter.count()
                    , i         = 0
                    , found     = [];

                for (var o in content) {
                    for (var f in filter) {
                        if ( typeof(content[o][f]) != 'undefined' && content[o][f].toHexString() === filter[f].toHexString() ) {
                            ++i
                        }
                        if (i === condition) {
                            found.push(content[o])
                        }
                    }
                }
            }
            return found
        }

        this.findOne = function(filter) {
            if ( typeof(filter) !== 'object' ) {
                throw new Error('filter must be an object');
            } else {
                var condition = filter.count()
                    , i         = 0;

                if (condition == 0) return null;

                for (var o in content) {
                    for (var f in filter) {
                        if ( typeof(content[o][f]) != 'undefined' && content[o][f].toHexString() === filter[f].toHexString() ) {
                            ++i
                        }
                        if (i === condition) {
                            return content[o];
                        }
                    }
                }
            }
            return null
        }
    }

    return init()
}

module.exports = ModelUtil