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
    //UtilsConfig = Utils.Config(),
    //Dev     = Utils.Dev,
    Util    = require('util'),
    Config  = require('./../config')(),
    EventEmitter  = require('events').EventEmitter;

/**
 * Model Constructor
 * @constructor
 * */
Model = function(namespace){
    var _this = this;
    var _configuration = null;

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

        console.log("\nBundle", bundle);
        console.log("Model", model);


        getConfig(bundle, function(err, conf){

            if (!err) {
                _configuration = conf.model;
                console.log("CONF READY ", model, conf.path);
                //TODO - More tries & catches...
                //Getting Entities Manager.
                var EntitiesManager = new require(conf.path)()[model];

                //For now, I just need the F..ing entity name.
                var modelPath = conf.path + '/' + modelDirName
                //console.log('modelPath: ', modelPath);
                Fs.readdir(modelPath, function(err, files){

                    var entityName, exluded = ['index.js'];

                    var produce = function(entityName, i){
                        //console.log("producing ", files[i]);
                        var UtilsConfig = new Utils.Config();
                        UtilsConfig.get('geena', 'locals.json', function(err, config){
                            if (config == undefined) {
                                throw new Error("geena/utils/.gna not found.");
                            }
                            if (err) Log.error('geena', 'MODEL:ERR:2', 'EEMPTY: EntitySuper' + err, __stack);

                            var filename = config.paths.geena + '/model/entity.js';
                            try {
                                var ModelEntityClass = require(filename);
                                var ModelEntity = new ModelEntityClass( _this.getConfig() );

                                var EntityClass = require(modelPath  + '/' + files[i]);
                                var Entity = new EntityClass();
                                //Inherits.
                                Utils.extend(true, Entity, ModelEntity );
                                //Overriding.
                                EntitiesManager[entityName] = Entity;
                                //console.log("show me ", entityName, EntitiesManager[entityName],"\n\n");

                            } catch (err) {
                                console.log("Did not find entity " + modelPath + '/' + files[i] + "\nOR "+ filename);
                            }

                            //console.log("EntityManager  \n",  EntitiesManager,"\n VS \n",  Entity);
                            if (i == files.length-1) {
                                //console.log("All done !");
                                //var EntitiesManager = new require(conf.path)()[model];
                                _this.emit('ready', false, EntitiesManager);
                                ++i;
                            }

                        });//EO UtilsConfig.get

                    }//EO produce

                    var i = 0;
                    while (i < files.length) {
                        //console.log("TEsting entity exclusion ",  i + ": ", exluded.indexOf(files[i]) != -1 && files[i].match(/.js/), files[i]);
                        if ( files[i].match(/.js/) && exluded.indexOf(files[i]) == -1 && !files[i].match(/.json/)) {
                            entityName = files[i].replace(/.js/, "") + suffix;
                            entityName = entityName.substring(0, 1).toUpperCase() + entityName.substring(1);
                            console.log("entityName  : ", entityName );
                            produce(entityName, i++);
                        } else if (i == files.length-1) {
                            //console.log("All done !");
                            _this.emit('ready', false, EntitiesManager);
                            ++i;
                        } else {
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
        if (_configuration) {
            return _configuration;
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
    var getConfig = function(bundle, callback){

        var configuration = Config.getInstance(bundle);
        //console.log("getting for bundle ", bundle, configuration);

        if ( typeof(configuration) != 'undefined' ) {
            var tmp = JSON.stringify(configuration);
            tmp = JSON.parse(tmp);
            console.log("getting for bundle ", bundle, tmp);
            //Response.
            var confObj = {
                model : tmp.content.model,
                path : tmp.modelsPath
            };
            callback(false, confObj);
        } else {
            callback('Config not instantiated');
        }
    };



//    this.getEntitiesManager = function(){
//
//    };

    _init(namespace);

    return {
        onReady : function(callback){
            _this.on('ready', function(err, entities){
                console.log("foudn entities ", entities);
                callback(err, entities );
            });
        }
    }
};
Util.inherits(Model, EventEmitter);


module.exports = Model;
