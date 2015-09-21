/*
 * This file is part of the gina package.
 * Copyright (c) 2015 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs          = require('fs');
var merge       = require('./merge');
var console     = require('./logger');
var inherits    = require('./inherits');
//var math        = require('./math');
//var checkSum    = math.checkSum;

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

        if ( !ModelUtil.instance && !getContext('modelUtil') ) {
            self.models = self.models || {};
            self.entities = {};
            self.files = {};
            setContext('modelUtil', self);
            ModelUtil.instance = self;
            return self
        } else {
            if (!ModelUtil.instance) {
                ModelUtil.instance = getContext('modelUtil')
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
                throw new Error('`modelUtil cannot set `modelEntity whitout a name !')
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
            throw new Error('`modelUtil` cannot update `entityObject` whitout a connector !')
        }

        if ( typeof(name) == 'undefined' || name == '' ) {
            throw new Error('`modelUtil` cannot set `modelEntity` whitout a name !')
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
            var modelObject     = getContext('modelUtil').entities[bundles[b]] // to check if already laoded
                , bundle        = bundles[b]
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
                    if ( modelObject && typeof(modelObject[c]) != 'undefined' ) {
                        done(connector)
                    } else {
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


                                    if (self.models[bundle][c]) {// only used when tryin to import multiple models into the same entity
                                        self.models[bundle][c]['getConnection'] = function() {
                                            return self.models[bundle][c]['_connection']
                                        }
                                    }
                                    // creating entities instances
                                    for (var ntt in entitiesObject) {
                                        entitiesObject[ntt] = new entitiesObject[ntt](conn)
                                    }
                                    done(connector)
                                }
                            })
                   }

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

        if ( typeof(model) != 'undefined' && typeof(self.models[bundle]) != 'undefined' ) {
            try {
                self.models[bundle][model]['getConnection'] = function() {
                    return self.models[bundle][model]['_connection']
                }
                return self.models[bundle][model]
            } catch (err) {
                return undefined
            }
        } else {
            // we might be in a case where we are trying to import a model into another while the targetd model is not yet loaded
            // this will happen if you are trying to do it from within an entity: ModelA::entity trying to getModel(ModelB) while ModelB is not loaded yet

            // Check if targetd model exists and load it synchronously if found
            var ctx                 = getContext()
                , modelConnector    = ctx.modelConnectors[model] || null
                , conn              = modelConnector.conn
                , entitiesManager   = null
                , env               = ctx['gina.config'].env
                , conf              = ctx['gina.config'].bundlesConfiguration.conf[bundle][env]
                , modelPath         = _(conf.modelsPath + '/' + model)
                , entitiesPath      = _(modelPath + '/entities')
                ;

            if ( modelConnector && conf && fs.existsSync(modelPath) ) {
                conn            = modelConnector.conn;
                entitiesManager = new require( modelPath )(conn);

                self.setConnection(bundle, model, conn);

                return importModelEntitiesSync(bundle, model, conn, entitiesManager, modelPath, entitiesPath, ctx)
            } else {
                return undefined
            }
        }
    }

    /**
     * Import Model Entities synchronously
     *
     * @param {string} bundle
     * @param {string} model
     * @param {object} conn
     * @param {object} entitiesManager
     * @param {string} modelPath
     * @param {string} entitiesPath
     * @param {object} ctx - Context
     *
     *
     * @return {object} modelEntities
     *
     * TODO - Refacto gina/core/model/index.js `getModelEntities` to look less messed up: loading entities can be synchronously, they are loaded during the server init or page refresh if `cacheless` is active. Maybe, it is possible to make this one `public`and call it from the main model load ?
     * */
    var importModelEntitiesSync = function(bundle, model, conn, entitiesManager, modelPath, entitiesPath, ctx) {
        var ginaCorePath        = getPath('gina.core')
            , ctx               = ctx || getContext()
            , cacheless         = ctx['gina.config'].isCacheless()
            , suffix            = 'Entity'
            , files             = fs.readdirSync(entitiesPath)
            , i                 = 0
            , len               = files.length
            , entityName        = null
            , excluded          = ['index.js']
            , className         = null
            , filename          = null
            , EntitySuperClass  = null
            , EntityClass       = null
            , entityObject      = {}
            ;

        try {
            self.models[bundle][model]['getConnection'] = function() {
                return self.models[bundle][model]['_connection']
            }
        } catch (err) {
            return undefined
        }

        for (; i < len; ++i) {
            if ( /\.js/.test(files[i]) && excluded.indexOf(files[i]) == -1 && !/\.json/.test(files[i]) && ! /^\./.test(files[i]) ) {
                entityName  = files[i].replace(/\.js/, '') + suffix;
                className   = entityName.substr(0,1).toUpperCase() + entityName.substr(1);
                filename    = _(ginaCorePath + '/model/entity.js', true);

                if (cacheless)
                    delete require.cache[_(filename, true)]; //EntitySuperClass

                EntitySuperClass                = require(_(filename, true));
                if (cacheless)
                    delete require.cache[_(entitiesPath + '/' + files[i], true)];//child

                EntityClass                     = require( _(entitiesPath + '/' + files[i], true) );
                //Inherits.
                EntityClass                     = inherits(EntityClass, EntitySuperClass);
                EntityClass.prototype.name      = className;
                EntityClass.prototype.model     = model;
                EntityClass.prototype.bundle    = bundle;

                entitiesManager[entityName]     = EntityClass;
                self.setModelEntity(bundle, model, className, EntityClass);
                // creating instance
                entityObject[entityName]        = new entitiesManager[entityName](conn)
            }
        }

        self.models[bundle][model] = entityObject;
        return self.models[bundle][model]
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

                // loading order case ... when U comes after B & U is not loaded yet
                if ( !self.entities[bundle][model][entityName] ) {
                    var ctx                 = getContext()
                        , env               = ctx['gina.config'].env
                        , conf              = ctx['gina.config'].bundlesConfiguration.conf[bundle][env]
                        , modelPath         = _(conf.modelsPath + '/' + model)
                        , entitiesPath      = _(modelPath + '/entities')
                        , filename          = _(entitiesPath + '/' + shortName.replace(/Entity/, '') +'.js')
                        , EntityClass       = null
                        ;

                    if ( fs.existsSync(filename) ) {
                        EntityClass         = require(filename);
                        self.setModelEntity(bundle, model, entityName, EntityClass);

                        var entityObj       =  new self.entities[bundle][model][entityName](conn);
                        self.models[bundle][model][shortName] = entityObj;

                        return entityObj
                    } else {
                        return undefined
                    }

                } else {
                    var entityObj = new self.entities[bundle][model][entityName](conn);
                }


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