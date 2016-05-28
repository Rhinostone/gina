/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs          = require('fs');
var merge       = require('./merge');
var console     = require('./logger');
var inherits    = require('./inherits');
var math        = require('./math');
//var checkSum    = math.checkSum;

/**
 * Model uitl
 *
 * @package     Gina.Utils
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */
function ModelUtil() {
    var self        = this;
    var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;

    /**
     * Init
     * @contructor
     * */
    var init = function() {

        if ( !ModelUtil.instance && !getContext('modelUtil') ) {
            self.models = self.models || {}; // used when getModel(modelName) is called
            self.entities = {};
            self.entitiesCollection = {}; // used when getEntity(entityName) is called - handles entity relations
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
            if (!self.entitiesCollection) {
                self.entitiesCollection = {}
            }
            if (!self.models[bundle]) {
                self.models[bundle] = {}
            }
            if (!self.entitiesCollection[bundle]) {
                self.entitiesCollection[bundle] = {}
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

            if (typeof(self.entitiesCollection[bundle][name]) == 'undefined') {
                self.entitiesCollection[bundle][name] = {};
            }


            self.models[bundle][name]['_connection'] = conn;
            self.entitiesCollection[bundle][name]['_connection'] = conn;
        } else {
            self.models[bundle] = {};
            self.entitiesCollection[bundle] = {}
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

            if ( !/Entity$/.test(name) ) {
                name = name + 'Entity'
            }
            self.entities[bundle][model][name] = module

        } else {
            self.entities[bundle][model] = arguments[0]
        }
    }

    this.updateModel = function(bundle, model, name, entityObject) {

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

    this.updateEntities = function(bundle, model, name, entityObject) {

        if ( typeof(model) == 'undefined' || model == '' ) {
            throw new Error('`modelUtil` cannot update `entityObject` whitout a connector !')
        }

        if ( typeof(name) == 'undefined' || name == '' ) {
            throw new Error('`modelUtil` cannot set `modelEntity` whitout a name !')
        }

        if (!self.entitiesCollection[bundle][model][name]) {
            self.entitiesCollection[bundle][model][name] = {}
        }

        self.entitiesCollection[bundle][model][name] =  entityObject;

        return self.entitiesCollection[bundle][model][name]
    }

    this.setModel = function(bundle, name, obj) {
        if (arguments.length > 2) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (!self.models[bundle]) {
                self.models[bundle] = {}
            }
            if (!self.entitiesCollection[bundle]) {
                self.entitiesCollection[bundle] = {}
            }
            //entitiesCollection

            if (!self.models[bundle][name]) {
                self.models[bundle][name] = {}
            }
            if (!self.entitiesCollection[bundle][name]) {
                self.entitiesCollection[bundle][name] = {}
            }

            self.models[bundle][name] = merge(self.models[bundle][name], obj);
            self.entitiesCollection[bundle][name] = merge(self.entitiesCollection[bundle][name], obj)

        } else {
            self.models[bundle][name] = {};
            self.entitiesCollection[bundle][name] = {}
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

                        var conn                = null
                            , entitiesManager   = null
                            , modelPath         = null
                            , entitiesPath      = null
                            , entitiesObject    = null
                            , foundInitError    = false;

                        // end - now, loading entities for each `loaded` model
                        //
                        for (var bundle in self.models) {

                            for (var name in self.models[bundle]) {//name as connector name
                                conn            = self.models[bundle][name]['_connection'];
                                modelPath       = _(conf.modelsPath + '/' + name);
                                entitiesPath    = _(modelPath + '/entities');
                                //Getting Entities Manager thru connector.
                                entitiesManager = new require( _(conf.modelsPath + '/index.js', true) )(conn)[name](conn, { model: name, bundle: bundle});

                                self.setConnection(bundle, name, conn);

                                // step 1: creating entities classes in the context
                                // must be done only when all models conn are alive because of `cross models/database use cases`
                                for (var nttClass in entitiesManager) {
                                    if ( !/^[A-Z]/.test( nttClass ) ) {
                                        throw new Error('Entity Class `'+ nttClass +'` should start with an uppercase !');
                                        foundInitError = true
                                    }
                                    self.setModelEntity(bundle, name, nttClass, entitiesManager[nttClass])
                                }

                                // step 2: creating entities instances
                                for (var nttClass in entitiesManager) {
                                    new entitiesManager[nttClass](conn) // will update self.models
                                }
                            }
                        }


                        if (foundInitError) process.exit(1)

                        cb()
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
                            function onModelReady( err, connector, conn) {
                                if (err) {
                                    console.error('found error ...');
                                    console.error(err.stack||err.message||err);
                                } else {

                                    if ( typeof(self.models[bundle]) == 'undefined') {
                                        self.models[bundle] = {}
                                    }

                                    if ( typeof(self.models[bundle][connector]) == 'undefined') {
                                        self.models[bundle][connector] = {}
                                    }

                                    if ( typeof(self.models[bundle][connector]['_connection']) == 'undefined' ) {
                                        self.models[bundle][connector]['_connection'] = conn
                                    }

                                    if ( typeof(self.models[bundle][connector]['getConnection']) == 'undefined' ) {// only used when tryin to import multiple models into the same entity
                                        self.models[bundle][connector]['getConnection'] = function() {
                                            return self.models[bundle][connector]['_connection']
                                        }
                                    }
                                }

                                done(connector)
                            })
                   }

                }


            } else {
                //throw new Error('no connector found for bundle [ '+ bundle +' ]');
                // this is normal if there is no connector.json found in the source
                if (b < bundles.length-1) {
                    loadModel(b+1, bundles, configuration, env, cb)
                } else {
                    cb()
                }

            }
        };

        loadModel(0, bundles, configuration, env, cb)
    }


    /**
     * Reload modes
     * cacheless mode only
     *
     * @param {obj} conf
     * @callback cb
     * */
    this.reloadModels = function(conf, cb) {
        if ( typeof(conf.content['connectors']) != 'undefined' && conf.content['connectors'] != null ) {

            var models              = conf.content.connectors
                , conn              = null
                , foundInitError    = false
                , entitiesManager   = null
                , modelPath         = null
                , entitiesPath      = null
                , entitiesObject    = null
                , wait              = 0;

            setContext('modelConnectors', models);

            // end - now, loading entities for each `loaded` model
            for (var bundle in self.models) {

                for (var name in self.models[bundle]) { //name as connector name
                    conn            = self.models[bundle][name]['_connection'];

                    modelPath       = _(conf.modelsPath + '/' + name);
                    entitiesPath    = _(modelPath + '/entities');

                    //Getting Entities Manager thru connector.
                    entitiesManager = new require( _(conf.modelsPath + '/index.js', true) )(conn)[name](conn, { model: name, bundle: bundle});

                    // creating entities instances
                    // must be done only when all models conn are alive because of `cross models/database use cases`
                    for (var nttClass in entitiesManager) {
                        if ( !/^[A-Z]/.test( nttClass ) ) {
                            throw new Error('Entity Class `'+ nttClass +'` should start with an uppercase ?');
                            foundInitError = true
                        }
                        self.setModelEntity(bundle, name, nttClass, entitiesManager[nttClass])
                    }

                    for (var nttClass in entitiesManager) {
                        // will force updates on self.models
                        self.models[bundle][name][nttClass.toLowerCase()+'Entity'] = new entitiesManager[nttClass](conn)
                    }
                }
            }

            cb(false)

        } else {
            cb(new Error('[ '+ conf.bundle+' ] no connector found !'))
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
                , bundle    = null;

            var conf        = getContext('gina.config') || null;
            if (conf) {
                var bundles     = conf.bundles
                    , index     = 0;

                for (; i >= 0; --i) {
                    index = bundles.indexOf(a[i]);
                    if ( index > -1 ) {
                        bundle = bundles[index];
                        break
                    }
                }
            } else {
                conf    = getContext();
                bundle  = conf.bundle;
            }
        }

        if ( typeof(model) != 'undefined' && typeof(self.models[bundle]) != 'undefined' ) {

            try {
                if ( typeof(self.models[bundle][model]['getConnection']) == 'undefined' ) {
                    self.models[bundle][model]['getConnection'] = function() {
                        return self.models[bundle][model]['_connection']
                    }
                }

                return self.models[bundle][model]
            } catch (err) {
                return undefined
            }
        }
        // TODO - remove this
        /** else { // not supposed to work
            // we might be in a case where we are trying to import a model into another while the targetd model is not yet loaded
            // this will happen if you are trying to do it from within an entity: ModelA::entity trying to getModel(ModelB) while ModelB is not loaded yet

            // Check if targetd model exists and load it synchronously if found
            //debugger;
            var ctx                 = getContext()
                , env               = ctx['gina.config'].env
                , conf              = ctx['gina.config'].bundlesConfiguration.conf[bundle][env]
                , modelConnector    = ctx.modelConnectors[model] || null //self.loadModelSync(bundle, model, conf, env)
                , conn              = ctx.modelConnections[bundle][model]
                , entitiesManager   = null
                , modelPath         = _(conf.modelsPath + '/' + model)
                , entitiesPath      = _(modelPath + '/entities')
                ;

            if ( modelConnector && conf && fs.existsSync(modelPath) ) {
                conn            = modelConnector;
                if ( cacheless )
                    delete require.cache[_(modelPath + '/index.js', true)];

                entitiesManager = new require( _(modelPath + '/index.js', true) )(conn, {model: model, bundle: bundle});

                self.setConnection(bundle, model, conn);

                //var ntt = null;
                for (var nttClass in entitiesManager) {
                    //ntt = nttClass.substr(0,1).toLowerCase() + nttClass.substr(1);
                    // creating instance
                    //self.models[bundle][model][ntt]  = new entitiesManager[nttClass](conn);
                    new entitiesManager[nttClass](conn);
                }

                return self.models[bundle][model]

                // remove the whole method ... useless since classes are now produced from model/index.js
                //return importModelEntitiesSync(bundle, model, conn, entitiesManager, modelPath, entitiesPath, ctx)
            } else {
                return undefined
            }
        }*/
    }

    // /**
    //  * Import Model Entities synchronously
    //  *
    //  * @param {string} bundle
    //  * @param {string} model
    //  * @param {object} conn
    //  * @param {object} entitiesManager
    //  * @param {string} modelPath
    //  * @param {string} entitiesPath
    //  * @param {object} ctx - Context
    //  *
    //  *
    //  * @return {object} modelEntities
    //  *
    //  * TODO - Refacto gina/core/model/index.js `getModelEntities` to look less messed up: loading entities can be synchronously, they are loaded during the server init or page refresh if `cacheless` is active. Maybe, it is possible to make this one `public`and call it from the main model load ?
    //  * */
    // var importModelEntitiesSync = function(bundle, model, conn, entitiesManager, modelPath, entitiesPath, ctx) {
    //     var ginaCorePath        = getPath('gina.core')
    //         , ctx               = ctx || getContext()
    //         , cacheless         = ctx['gina.config'].isCacheless()
    //         , suffix            = 'Entity'
    //         , files             = fs.readdirSync(entitiesPath)
    //         , i                 = 0
    //         , len               = files.length
    //         , entityName        = null
    //         , excluded          = ['index.js']
    //         , className         = null
    //         , filename          = null
    //         , EntitySuperClass  = null
    //         , EntityClass       = null
    //         ;
    //
    //     try {
    //         self.models[bundle][model]['getConnection'] = function() {
    //             return self.models[bundle][model]['_connection']
    //         }
    //     } catch (err) {
    //         return undefined
    //     }
    //
    //     filename    = _(ginaCorePath + '/model/entity.js', true);
    //     if (cacheless)
    //         delete require.cache[_(filename, true)]; //EntitySuperClass
    //
    //     EntitySuperClass                = require(_(filename, true));
    //
    //     for (; i < len; ++i) {
    //         if ( /\.js/.test(files[i]) && excluded.indexOf(files[i]) == -1 && !/\.json/.test(files[i]) && ! /^\./.test(files[i]) ) {
    //             entityName  = files[i].replace(/\.js/, '') + suffix;
    //             className   = entityName.substr(0,1).toUpperCase() + entityName.substr(1);
    //
    //             if ( typeof(entitiesManager[entityName]) == 'undefined' ) {
    //
    //                 if (cacheless)
    //                     delete require.cache[_(entitiesPath + '/' + files[i], true)];//child
    //
    //                 EntityClass                     = require( _(entitiesPath + '/' + files[i], true) );
    //                 //Inherits.
    //                 EntityClass                     = inherits(EntityClass, EntitySuperClass);
    //                 EntityClass.prototype.name      = className;
    //                 EntityClass.prototype.model     = model;
    //                 EntityClass.prototype.bundle    = bundle;
    //
    //                 entitiesManager[entityName]     = EntityClass;
    //
    //             } else {
    //                 EntityClass = entitiesManager[entityName];
    //             }
    //
    //
    //
    //             self.setModelEntity(bundle, model, className, EntityClass)
    //         }
    //     }
    //
    //     // don't be a smart ass, you need 2 loops because of the local referencesto other entities thru `this.getEntity(...)` (relations/mapping)
    //     for (var _ntt in entitiesManager) {
    //         // creating instance
    //         self.models[bundle][model][_ntt]  = new entitiesManager[_ntt](conn);
    //     }
    //
    //     return self.models[bundle][model]
    // }

    /**
     * Get Model Entity
     *
     * @param {string} model
     * @param {string} entityName
     * @param {object} conn
     *
     * @return {object} entity
     * */
    getModelEntity = function(bundle, model, entityClassName, conn) {
        if ( typeof(entityClassName) != 'undefined' ) {
            try {
                var shortName = entityClassName.substr(0, 1).toLowerCase() + entityClassName.substr(1);

                //console.debug(parent+'->getEntity('+shortName+')');
                if ( self.models[bundle][model][shortName] ) { // cacheless is filtered thanks to self.reloadModels(...)
                    //return self.models[bundle][model][shortName]
                    return self.entitiesCollection[bundle][model][shortName]
                } else {
                    return new self.entities[bundle][model][entityClassName](conn);
                }

            } catch (err) {
                throw err;
                return undefined
            }
        } else {
            return self.entities[bundle][model]
        }
    }


    /**
     * Collection cLass
     * Allows you to handle your own collections as you would normaly with mongodb
     *
     * @param {array} collection
     * @return {object} instance
     *
     * Collection::find
     *  @param {object} filter eg.: { uid: "someUID" }
     *  @return {array} result
     *
     * Collection::findOne
     *  @param {object} filter
     *  @return {object} result
     *
     * */
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
                        if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
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
                        if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
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