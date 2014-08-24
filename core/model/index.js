/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//Imports.
var fs      = require('fs');
var vm      = require('vm');
var EventEmitter  = require('events').EventEmitter;
var Module  = require('module');
var utils   = require('../utils');

var console = utils.logger;
var modelHelper = new utils.Model();
var inherits = utils.inherits;

    //UtilsConfig = Utils.Config(),
//dev     = require(_(getPath('geena.core')'/dev') ),


/**
 * @class Model class
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
function Model(namespace) {
    var self = this;
    var _configuration = null;
    var _connector = null;
    var _locals = null;
    var utils   = require('../utils');
    var config = getContext('geena.config');
    var utilsConfig = getContext('geena.utils.config');
    var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;


    var setup = function(namespace) {
        if ( typeof(namespace) == "undefined" || namespace == "") {
            log.error('geena', 'MODEL:ERR:1', 'EEMPTY: Model namespace', __stack);
        }

        var namespace = namespace.split(/\//g);
        _connector = namespace[1];//Has to be writtien the same for the connetors.json decalration or for the model folder
        var bundle = namespace[0];
        namespace.shift();
        //Capitalize - Normalize
        if (namespace.length > 1) {
//            for (var i; i<namespace.length; ++i) {
//                namespace[i] = namespace[i].substring(0, 1).toUpperCase() + namespace[i].substring(1);
//            }


            var model = namespace.join(".");
        } else {
            //Dir name.
            var modelDirName = namespace[0];
            //namespace[0] = namespace[0].substring(0, 1).toUpperCase() + namespace[0].substring(1);
            var model = namespace[0];
        }


        console.log("\nBundle", bundle);
        console.log("Model", model);
        self.name = _connector;
        self.bundle = bundle;
        self.model = model;
        self.modelDirName = modelDirName;
    };

    /**
     * Init
     *
     * @param {string} namesapce
     *
     * @private
     * */
    var init = function() {
        //TODO - if instance...
        var bundle = self.bundle;
        var model = self.model;
        var modelDirName = self.modelDirName;
        getConfig(bundle, function onGetConfigDone(err, conf){

            if (!err) {
                _configuration = conf.connectors;
                console.log("CONF READY ", model, conf.path);
                //TODO - More controls...

                //For now, I just need the F..ing entity name.
                var modelPath       = _(conf.path + '/' + modelDirName);
                var entitiesPath    = _(modelPath + '/entities');
                console.log('models scaning... ', entitiesPath, fs.existsSync(entitiesPath));
                if (!fs.existsSync(entitiesPath)) {
                    self.emit('model#ready', new Error('no entities found for your model: [ ' + model + ' ]'), self.name, null);
                    //console.log("[ "+model+" ]no entities found...")
                } else {
                    var connectorPath   = _(modelPath + '/lib/connector.js');
                    //Getting Entities Manager.
                    var exists = fs.existsSync(connectorPath);
                    //fs.exists(connectorPath, function (exists){
                    if (exists) {
                        if (cacheless)
                            delete require.cache[_(connectorPath, true)];

                        var Connector = require(connectorPath);

                        self.connect(
                            Connector,
                            function onConnect(err, conn) {
                                if (err) {
                                    console.error(err.stack);
                                    self.emit('model#ready', err, self.name, null);
                                } else {
                                    //Getting Entities Manager.
                                    if (cacheless)
                                        delete require.cache[_(conf.path, true)];

                                    var entitiesManager = new require(conf.path)()[model];
                                    modelHelper.setConnection(model, conn);
                                    getModelEntities(entitiesManager, modelPath, entitiesPath, conn)
                                }
                            }
                        )
                    } else {
                        //Means that no connector was found in models.
                        if (cacheless)
                            delete require.cache[_(conf.path, true)];

                        var entitiesManager = new require(conf.path)()[model];
                        getModelEntities(entitiesManager, modelPath, entitiesPath, undefined)
                    }
                    //});
                }

            } else {
                self.emit('model#ready', new Error('no configuration found for your model: ' + model), self.name, null);
                console.log("no configuration found...")
            }
        });


    };

    this.connect = function(Connector, callback) {
        var connector = new Connector( self.getConfig(_connector) );
        connector.onReady( function(err, conn){
            callback(err, conn);
        })
    };

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
    var getConfig = function(bundle, callback) {
        var configuration = config.getInstance(bundle);

        //console.log("getting for bundle ", bundle, configuration);
        utilsConfig.get('geena', 'locals.json', function(err, locals){
            _locals = locals;
            if ( typeof(configuration) != 'undefined' ) {
                var tmp = JSON.stringify(configuration);
                tmp = JSON.parse(tmp);
                console.log("getting config for bundle ", bundle);
                //Response.
                var confObj = {
                    connectors   : tmp.content.connectors,
                    path        : tmp.modelsPath,
                    locals      : locals
                };
                callback(false, confObj);
            } else {
                callback('Config not instantiated');
            }
        });
    };

    /**
     * Get Model Configuration
     *
     * @return {object|undefined} configuration
     * */
    this.getConfig = function(connector){
        var connector = ( typeof(connector) == 'undefined' ) ?  _connector : connector;

        if (_configuration) {
            return ( typeof(connector) != 'undefined' ) ? _configuration[connector] : undefined;
        } else {
            return undefined;
        }
    };



    /**
     * Get model
     *
     * @param {object} entitiesManager
     * @param {string} modelPath
     * @param {string} entitiesPath
     * @param {object} [conn]
     * */
    var getModelEntities = function(entitiesManager, modelPath, entitiesPath, conn) {
        var suffix = 'Entity';

        var that = this;
        var i = that.i = that.i || 0;
        var files = fs.readdirSync(entitiesPath);
        //fs.readdir(entitiesPath, function(err, files){

            var entityName, exluded = ['index.js'];

            var produce = function(entityName, i){
                console.log("producing ", self.name,":",entityName, i);
                if (_locals == undefined) {
                    throw new Error("geena/utils/.gna not found.");
                }
                //if (err) log.error('geena', 'MODEL:ERR:2', 'EEMPTY: EntitySuper' + err, __stack);

                var filename = _locals.paths.geena + '/model/entity.js';// super
                try {
                    if (cacheless) {
                        delete require.cache[_(filename, true)];//super
                        delete require.cache[_(entitiesPath + '/' + files[i], true)];//child
                    }

                    var className = entityName.substr(0,1).toUpperCase() + entityName.substr(1);

                    var EntitySuperClass = require(_(filename, true));
                    var EntityClass = require( _(entitiesPath + '/' + files[i]) );


                    //Inherits.
                    var EntityClass = inherits(EntityClass, EntitySuperClass);

                    EntityClass.prototype.name = className;
                    EntityClass.prototype.model = self.model;

                    //for (var prop in Entity) {
                    //    console.log('PROP FOUND ', prop);
                    //}

                    entitiesManager[entityName] = EntityClass;

                } catch (err) {
                    console.error(err.stack);
                    self.emit('model#ready', err, self.name, undefined);
                }
                console.log('::::i '+i+' vs '+(files.length-1))
                if (i == files.length-1) {
                    // another one to instanciate and put in cache
                    for (var nttClass in entitiesManager) {
                        var _nttClass = nttClass.substr(0,1).toUpperCase() + nttClass.substr(1);
                        modelHelper.setModelEntity(self.model, _nttClass, entitiesManager[nttClass]);
                    }
                    //finished.
                    self.emit('model#ready', false, self.name, entitiesManager, conn);
                }
                ++that.i

            };//EO produce.

            if (that.i < files.length) {
                while (that.i < files.length) {
                    //console.log("TEsting entity exclusion ",  i + ": ", exluded.indexOf(files[i]) != -1 && files[i].match(/.js/), files[i]);
                    if ( files[that.i].match(/.js/) && exluded.indexOf(files[that.i]) == -1 && !files[that.i].match(/.json/)) {
                        entityName = files[that.i].replace(/.js/, "") + suffix;
                        //entityName = entityName.substring(0, 1).toUpperCase() + entityName.substring(1);
                        console.log("entityName  : ", entityName );
                        produce(entityName, that.i);
                    } else if (that.i == files.length-1) {
                        //console.log("All done !");
                        self.emit('model#ready', false, self.name, entitiesManager);
                        ++that.i;
                    } else {
                        ++that.i;
                    }
                }//EO while.
            }
        //});//EO Fs.readdir.
    };



    this.onReady = function(callback) {
        console.log('binding...');
        self.once('model#ready', function(err, model, entities, conn) {
            //entities == null when the database server isn't start.
            if ( err ) {
                console.error(err.stack||err.message)
                //console.log('No entities found for [ '+ self.name +':'+ entityName +'].\n 1) Check if the database is started.\n2) Check if exists: /models/entities/'+ entityName);
            } //else {
              //  console.log('!! found entities ', entities);
                //modelHelper.setModel(model, entities);
            //}
            callback(err, model, entities, conn);
        });
        setup(namespace);
        init();
    };



    return this
}

Model = inherits(Model, EventEmitter);
module.exports = Model;
