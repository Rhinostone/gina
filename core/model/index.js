/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs              = require('fs');
var EventEmitter    = require('events').EventEmitter;
var corePath        = getPath('gina.core');
var Config          = require( corePath + '/config' );
var config          = new Config();
var utils           = require('gina').utils;
var console         = utils.logger;
var math            = utils.math;
var inherits        = utils.inherits;
//var merge           = utils.merge;
var utilsConfig     = new utils.Config();
var modelUtil       = new utils.Model();
var Module          = require('module');



    //UtilsConfig = Utils.Config(),
//dev     = require(_(getPath('gina.core')'/dev') ),


/**
 * @class Model class
 *
 *
 * @package     Gina
 * @namespace
 * @author      Rhinostone <gina@rhinostone.com>
 * @api         Public
 */
function Model(namespace) {
    var self = this;
    this.i = 0;
    var local = {
        modelPath: null,
        entitiesPath: null,
        connection: null,
        files: {},
        toReload: [],
        trying: 0
    };

    var _configuration = null;
    var _connector = null;

    var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
    var standalone = config.Host.isStandalone();


    var setup = function(namespace) {
        if ( typeof(namespace) == 'undefined' || namespace == '') {
            console.error('gina', 'MODEL:ERR:1', 'EEMPTY: Model namespace', __stack);
        }

        var model, namespace = namespace.split(/\//g);
        _connector = namespace[1];//Has to be writtien the same for the connetors.json decalration or for the model folder
        var bundle = namespace[0];
        namespace.shift();
        //Capitalize - Normalize
        if (namespace.length > 1) {
            //            for (var i; i<namespace.length; ++i) {
            //                namespace[i] = namespace[i].substring(0, 1).toUpperCase() + namespace[i].substring(1);
            //            }

            model = namespace.join(".");
        } else {
            //Dir name.
            model = namespace[0];
        }


        console.debug("\nBundle: ", bundle);
        console.debug("Model: ", model);
        self.name = _connector;
        self.bundle = bundle;
        self.model = model;
        self.modelDirName = model;
        self.connectors = getContext('modelConnectors') || {};
    }

    /**
     * Init
     *
     * @param {string} namesapce
     *
     * @private
     * */
    var init = function(reload) {

        var bundle          = self.bundle;
        var model           = self.model;
        var modelDirName    = self.modelDirName;

        // this is supposed to happen on load or for dev env; on reload, with a checksum
        var conf        = getConfigSync(bundle);
        local.locals    = conf.locals;

        if (conf) {
            _configuration = conf.connectors;

            console.debug("CONF READY ", model, conf.path);
            //TODO - More controls...

            //For now, I just need the F..ing entity name.
            var modelPath       = local.modelPath = _(conf.path + '/' + modelDirName);
            var entitiesPath    = local.entitiesPath = _(modelPath + '/entities');
            console.debug('models scaning... ', entitiesPath, fs.existsSync(entitiesPath));
            if (!fs.existsSync(entitiesPath)) {
                self.emit('model#ready', new Error('no entities found for your model: [ ' + model + ' ]'), self.name, null)
            } else {
                var connectorPath   = _(modelPath + '/lib/connector.js');
                //Getting Entities Manager.
                var exists = fs.existsSync(connectorPath);
                if (exists) {
                    if (cacheless)
                        delete require.cache[_(connectorPath, true)];

                    var Connector = require(_(connectorPath, true));

                    self.connect(
                        Connector,
                        function onConnect(err, conn) {
                            if (err) {
                                console.error(err.stack);
                                self.emit('model#ready', err, self.name, null)

                            } else {
                                local.connection = conn;
                                self.emit('model#ready', false, self.name, conn)


                                /** must be done only when all models conn are alive because of `cross models/database use cases`

                                 //Getting Entities Manager thru connector.
                                 var entitiesManager = new require( _(conf.path) )(conn)[model](conn, { model: self.name, bundle: self.bundle});

                                 if (reload) {
                                    getModelEntities(entitiesManager, modelPath, entitiesPath, conn, function onReload(err, connector, entities, connexion){
                                        reload(err, connector, entities, connexion)
                                    })
                                } else {
                                    modelUtil.setConnection(bundle, model, conn);
                                    getModelEntities(entitiesManager, modelPath, entitiesPath, conn)
                                }*/
                            }
                        }
                    )
                } else {//Means that no connector was found in models.

                    //finished.
                    self.emit('model#ready', new Error('[ '+self.name+' ] No connector found'), self.name, conn)
                }
            }

        } else {
            console.debug("no configuration found...");
            self.emit('model#ready', new Error('no configuration found for your model: ' + model), self.name, null)
        }

        return self
    }


    this.connect = function(Connector, callback) {
        if ( typeof(self.connectors[_connector]) == 'undefined' ) {
            self.connectors[_connector] = {};
            var connector = new Connector( self.getConfig(_connector) );
            connector.onReady( function(err, conn){
                self.connectors[_connector].err = err;
                self.connectors[_connector].conn = conn;
                setContext('modelConnectors', self.connectors);
                callback(err, conn);
            });

        } else {
            callback(self.connectors[_connector].err, self.connectors[_connector].conn);
        }
    }

    this.reload = function(conf, cb) {
        setup(namespace);
        init(cb)
    }

    /**
     * Get Model configuration
     *
     * @param {string} bundle
     *
     * @callback callback
     * @param {boolean|string} err - Error Status response
     * @param {object} conf - Configuration response
     *
     * @private
     * */
    var getConfigSync = function(bundle, i) {
        var i = i || 0;
        var configuration = config.getInstance(bundle);

        try {

            var locals = _locals = utilsConfig.getSync('gina', 'locals.json')
        } catch (err) {
            console.emerg('Error while calling `Model::getConfigSync()` '+ err.stack||err.message);
            if ( i < 10) {
                console.debug('about to retry to load locals.json');
                setTimeout(function(){

                    i = i+1;
                    console.debug('retry ('+i+') ...');
                    return getConfigSync(bundle, i)
                }, 300)

            } else {
                throw new Error('Config could not be loaded');
                process.exit(1)
            }
            return false
        }

        if ( typeof(configuration) != 'undefined' && locals) {
            var tmp = JSON.stringify(configuration);
            tmp = JSON.parse(tmp);

            // configuration object.
            var confObj = {
                connectors  : tmp.content.connectors,
                path        : tmp.modelsPath,
                locals      : locals
            };

            return confObj
        } else {
            throw new Error('Config not instantiated');
            return undefined
        }
    }

    /**
     * Get Model Configuration
     *
     * @return {object|undefined} configuration
     * */
    this.getConfig = function(connector){
        var connector = ( typeof(connector) == 'undefined' ) ?  _connector : connector;

        if (_configuration) {
            return ( typeof(connector) != 'undefined' ) ? _configuration[connector] : undefined
        } else {
            return undefined
        }
    }



    /**
     * Get model
     * TODO - remove this part
     *
     * @param {object} entitiesManager
     * @param {string} modelPath
     * @param {string} entitiesPath
     * @param {object} [conn]
     * */
    //this.getModelEntities = function(entitiesManager, modelPath, entitiesPath, conn, reload) {
    //    var suffix = 'Entity';
    //    var that = self;
    //    //if (reload && cacheless) {
    //    //    that.i = 0
    //    //}
    //
    //    var i = that.i || 0;
    //    var files = fs.readdirSync(entitiesPath);
    //
    //    var entityName, excluded = ['index.js'];
    //    if (_locals == undefined) {
    //        throw new Error("gina/utils/.gna not found.");
    //    }
    //
    //    var produce = function(entityName, i){
    //
    //        try {
    //            //console.debug("producing ", self.name,":",entityName, ' ( '+i+' )');
    //
    //            var className = entityName.substr(0,1).toUpperCase() + entityName.substr(1);
    //            //entityName.substr(0,1).toLowerCase() + entityName.substr(1);
    //
    //            // superEntity
    //            var filename = _locals.paths.gina + '/model/entity.js';
    //            if (cacheless)
    //                delete require.cache[_(filename, true)]; //EntitySuperClass
    //
    //            var EntitySuperClass = require(_(filename, true));
    //            if (cacheless) { //checksum
    //                delete require.cache[_(entitiesPath + '/' + files[i], true)];//child
    //            }
    //
    //            var EntityClass = require( _(entitiesPath + '/' + files[i], true) );
    //            var sum = math.checkSumSync( _(entitiesPath + '/' + files[i]) );
    //            if ( typeof(local.files[ files[i] ]) != 'undefined' && local.files[ files[i] ] !== sum) {
    //                // will only be used for cacheless anyway
    //                local.toReload.push( _(entitiesPath + '/' + files[i]) )
    //            } else if (typeof(local.files[ files[i] ]) == 'undefined') {
    //                // recording
    //                local.files[ files[i] ] = sum
    //            }
    //
    //            //Inherits.
    //            EntityClass = inherits(EntityClass, EntitySuperClass);
    //
    //            EntityClass.prototype.name      = className;
    //            EntityClass.prototype.model     = self.model;
    //            EntityClass.prototype.bundle    = self.bundle;
    //            //EntityClass.prototype._ressource = require( _(entitiesPath + '/' + files[i], true) );
    //
    //            //for (var prop in Entity) {
    //            //    console.log('PROP FOUND ', prop);
    //            //}
    //            //console.debug('Producing model:  [ '+self.model+'::' + className +' ] @ [ '+self.bundle+' ]');
    //
    //
    //            // inherited properties fromthe user's driver `/models/connectorName/index.js`
    //            //var inheritedProperties     = entitiesManager[entityName].prototype;
    //            //
    //            //for (var p in inheritedProperties) {
    //            //    if ( p != 'constructor' && inheritedProperties.hasOwnProperty(p) ) {
    //            //        try {
    //            //            // Super properties cannot be overriden
    //            //            EntityClass.prototype[p] = inheritedProperties[p]
    //            //        } catch(err) {}
    //            //    }
    //            //}
    //
    //            entitiesManager[className] = EntityClass
    //
    //        } catch (err) {
    //            console.error(err.stack);
    //            //if ( reload ) {
    //            //    self.reload(err, self.name, undefined)
    //            //} else {
    //                self.emit('model#ready', err, self.name, undefined)
    //            //}
    //        }
    //        //console.log('::::i '+i+' vs '+(files.length-1))
    //        if (i == files.length-1) {
    //            // another one to instanciate and put in cache
    //            var ntt = null;
    //            for (var nttClass in entitiesManager) {
    //                ntt = nttClass.substr(0,1).toLowerCase() + nttClass.substr(1);
    //                modelUtil.setModelEntity(self.bundle, self.model, nttClass, entitiesManager[nttClass])
    //            }
    //            // var nttClass = null;
    //            // for (var ntt in entitiesManager) {
    //            //     nttClass = ntt.substr(0,1).toUpperCase() + ntt.substr(1);
    //            //     modelUtil.setModelEntity(self.bundle, self.model, nttClass, entitiesManager[ntt])
    //            // }
    //        }
    //        ++that.i
    //
    //    };//EO produce.
    //
    //    if (that.i < files.length) {
    //
    //        while (that.i < files.length) {
    //
    //            if ( files[that.i].match(/.js/) && excluded.indexOf(files[that.i]) == -1 && !files[that.i].match(/.json/) && ! /^\./.test(files[that.i]) ) {
    //                entityName = files[that.i].replace(/.js/, "") + suffix;
    //                produce(entityName, that.i);
    //            } else if (that.i == files.length-1) {// All done
    //                //if ( reload ) {
    //                //    self.reload(false, self.name, entitiesManager)
    //                //} else {
    //                //    self.emit('model#ready', false, self.name, entitiesManager)
    //                //}
    //
    //                ++that.i;
    //            } else {
    //                ++that.i;
    //            }
    //
    //        }//EO while.
    //    } else if (reload) {
    //
    //        var ntt = null;
    //        for (var nttClass in entitiesManager) {
    //            ntt = nttClass.substr(0,1).toLowerCase() + nttClass.substr(1);
    //            modelUtil.setModelEntity(self.bundle, self.model, nttClass, entitiesManager[nttClass])
    //        }
    //    }
    //}

    this.onReady = function(callback) {
        self.once('model#ready', function(err, model, conn) {
            // entities == null when the database server has not started.
            if ( err ) {
                console.error(err.stack||err.message)
                //console.log('No entities found for [ '+ self.name +':'+ entityName +'].\n 1) Check if the database is started.\n2) Check if exists: /models/entities/'+ entityName);
            }
            callback(err, model, conn)
        });
        setup(namespace);
        return init()
    };

    return this
};
Model = inherits(Model, EventEmitter);
module.exports = Model
