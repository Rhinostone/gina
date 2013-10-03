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
 * @namespace   Geena.Model
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */


var Fs = require('fs'), Events = require('events'), Util = require('util');
var Utils = require('geena.utils'), Config = require('./../config');

var Model = function(namespace){
    var _this = this;
    var _init = function(namespace){

        if ( typeof(namespace) == "undefined" || namespace == "") {
            Log.error('geena', 'MODEL:ERR:1', 'EEMPTY: Model namespace', __stack);
        }

        var namespace = namespace.split(/\//g);
        var bundle = namespace[0];
        namespace.shift();
        var model = namespace.join(".");

        console.log("Bundle", bundle);
        console.log("Model", model);

        _this.getConfig(bundle, function(err, conf){

            if (!err) {
                console.log("CONF READY ", conf);
                _this.AgentEntity = require(conf.path).AgentEntity;
                //return new _this;

            } else {
                console.log("no configuration found...");
            }
        });
    };

    //this.getInstance = function() {

    //    return {
            AgentEntity : _this.instance
    //    };
    //};

    /**
     * Get Model configuration
     *
     * @param {string} bundle
     *
     * @callback callback
     * @param {boolean|string} err - Error Status
     * @param {object} conf - Configuration
     *
     * */
    this.getConfig = function(bundle, callback){
        var configuration = Config.getInstance(bundle);

        console.log("getting for bundle ", bundle, configuration);
        if ( typeof(configuration) != 'undefined' ) {

            var confObj = {
                model : configuration.filesContent.model,
                path : configuration.modelsPath
            };
            callback(false, confObj);
        } else {
            callback('Config not instantiated');
        }
    };

    var loadEntities = function(){

        return 'coco';
    }


    /**
     return {
        getEgg : function(){
            return 'holla';
        }
    }*/
    /**
     getEgg = function(){
        return this.egg;
    };

     var loadEntities = function(){

    };

     var getConfig = function(){
        console.log("getting config ");
        //var conf = Utils.Config.get('geena', bundle, );

        var name = 'models';
        //console.log("CONF ", this.app.conf[bundle][this.app.appName]);
        try {
            //return this.app.conf[bundle][this.app.appName];
        } catch (err) {
            //return this.appName + '/models.json is ' + undefined + ' or malformed.';
        }
    };*/
    //getConfig()
    //loadEntities();
//    this.getConfig = ('geena', bundle, model, function(err, conf){
//        //loadEntities(conf.paths.models, model)
//        console.log("FOUND config ", Config.get() );
//    });
//
//    this.on('configReady', function(conf){
//        console.log(" MY CONF è!!!!! ", conf);
//    });

    _init(namespace);
    //return _this;
};

//Util.inherits(Model, Events.EventEmitter);

module.exports = Model;
