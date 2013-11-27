/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Model class
 *
 *
 * @package     Geena
 * @namespace
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */

var Model;

//Imports.
var Fs      = require('fs'),
    Module  = require('module')
    Utils   = require('geena.utils'),
    //Dev     = Utils.Dev,
    Util    = require('util'),
    EventEmitter  = require('events').EventEmitter,
    Config  = require('./../config');

Model = function(namespace){
    var _this = this;
    var configuration = null;

    /**
     * Init
     *
     * @param {string} namesapce
     *
     * @private
     * */
    var _init = function(namespace){
        //TODO - if intance...


        if ( typeof(namespace) == "undefined" || namespace == "") {
            Log.error('geena', 'MODEL:ERR:1', 'EEMPTY: Model namespace', __stack);
        }
        var suffix = 'Entity';
        var namespace = namespace.split(/\//g);
        var bundle = namespace[0];
        namespace.shift();
        //Capitalize - Normalize
        if (namespace.length > 1) {
            for (var i; i<namespace.length; ++i)
                namespace[i] = namespace[i].substring(0, 1).toUpperCase() + namespace[i].substring(1);

            var model = namespace.join(".");
        } else {
            //Dir name.
            var modelDirName = namespace[0];
            namespace[0] = namespace[0].substring(0, 1).toUpperCase() + namespace[0].substring(1);
            var model = namespace[0];
        }

        //console.log("\nBundle", bundle);
        //console.log("Model", model);


        getContext(bundle, function(err, conf){

            if (!err) {
                configuration = conf.model;
                //console.log("CONF READY ", model, conf.path/** conf*/);
                //TODO - More tries & catches...
                //Getting Entities Manager.
                var EntitiesManager = new require(conf.path)();
                //var Entities = EntitiesManager[model];

                //For now, I just need the F..ing entity name.
                var modelPath = conf.path + '/' + modelDirName
                //console.log('modelPath: ', modelPath);
                Fs.readdir(modelPath, function(err, files){

                    var entityName, exluded = ['index.js'];

                    //Will be in Utils.Dev.Factory soon.
                    var produce = function(entityName, i){
                        console.log("producing ", files[i]);

                        Utils.Config.get('geena', 'project.json', function(err, config){
                            if (err) Log.error('geena', 'MODEL:ERR:2', 'EEMPTY: EntitySuper' + err, __stack);

                            var filename = config.paths.geena + '/model/entityFactory.js';

                            //TODO - Factory class
                            //var Factory = new Factory({source: , target: ).onComplete();
                            console.log("LOADING ", filename);
                            //Getting source.
                            loadFile(filename, entityName, function(err, source){
                                console.log("got source ", err, source);

                                try {
                                    if (entityName != "undefiend") {
                                        console.log("preparing entity ", entityName);
                                        //TODO - Would be great to implement in Utils.Dev.
                                        var EntityFactorySource = source
                                            .replace(/\{Entity\}/g, entityName)
                                            .replace(/\{Model\}/g, model);

                                        //var EntityFactory = new requireFromString(EntityFactorySource)( _this.getConfig() );
                                        var EntityFactoryClass = requireFromString(EntityFactorySource);
                                        var EntityFactory = new EntityFactoryClass( _this.getConfig() );
                                        console.log("Factory is ",  EntityFactory);

                                        //var Entity = new Entity();
                                        Utils.extend(true, Entity, EntityFactory);
                                        console.log("\nEntity CONTENT ", Entity, " \nVS\n", EntityFactory);

                                    } else {
                                        throw new Error('Geena.Model.getContext(...): [entityName] is undefined.');
                                    }
                                } catch (err) {
                                    Log.error('geena', 'MODEL:ERR:4', 'EEMPTY: EntitySuper\n' + err, __stack);
                                }

                                //Entity = new EntitiesManager[model]();
                                //Utils.extend(true, _this, Entity);
                                console.log("EntityManager  \n",  EntitiesManager,"\n VS \n",  EntityFactory);
                                if (i == files.length-1) {
                                    console.log("All done !");
                                    _this.emit('ready', false, EntitiesManager);
                                    ++i;
                                }

                            });//EO loadFile

                        });//EO Utils.Config.get

                    }//EO produce

                    var i = 0;
                    while (i < files.length) {
                        //console.log("TEsting entity exclusion ",  i + ": ", exluded.indexOf(files[i]) != -1 && files[i].match(/.js/), files[i]);
                        if ( files[i].match(/.js/) && exluded.indexOf(files[i]) == -1 && !files[i].match(/.json/)) {
                            entityName = files[i].replace(/.js/, "") + suffix;
                            console.log("entityName  : ", entityName );
                            produce(entityName, i++);
                        } else if (i == files.length-1) {
                            console.log("All done !");
                            _this.emit('ready', false, EntitiesManager);
                            ++i;
                        } else {
                            console.log("missed ", i, files[i]);
                            ++i;
                        }
                    }//EO while.

                });//EO Fs.readdir.

            } else {
                _this.emit('ready', 'no configuration found for your model: ' + model);
                console.log("no configuration found...");
            }
        });


    };
    /**
     * Get Model Configuration
     *
     * @return {object|undefined} configuration
     * */
    this.getConfig = function(){
        if (configuration) {
            return configuration;
        } else {
            return undefined;
        }
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
    var getContext = function(bundle, callback){
        var configuration = Config.getInstance(bundle);

        console.log("getting for bundle ", bundle, configuration);
        if ( typeof(configuration) != 'undefined' ) {
            //Response.
            var confObj = {
                model : configuration.content.model,
                path : configuration.modelsPath
            };
            callback(false, confObj);
        } else {
            callback('Config not instantiated');
        }
    };

    var loadFile = function(filename, entityName, callback){


        Fs.readFile(filename, function (err, data){

            if (err) {
                Log.error('geena', 'MODEL:ERR:3', err, __stack);
                callback(err);
            }

            console.log("Evaluating...", data.toString() );
            var entityFactory = data.toString().replace(/\{Entity\}/g, entityName);
            console.log("SHIT ");
            //process.exit(42);
            callback(false, entityFactory);
        });

    };

    var requireFromString = function(src, filename) {
        var Module = module.constructor;
        var m = new Module();
        m._compile(src, filename);
        return m.exports;
    }

//    this.getEntitiesManager = function(){
//
//    };

    _init(namespace);

    return {
        onReady : function(callback){
            _this.on('ready', function(err, entities){
                //console.log("foudn entities ", entities);
                callback(err, new entities() );
            });
        },
        getInstance : function(){
            return
        }
    }
};
Util.inherits(Model, EventEmitter);


module.exports = Model;
