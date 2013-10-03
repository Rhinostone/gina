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

//Imports.
var Fs      = require('fs'),
    Events  = require('events'),
    Utils   = require('geena.utils'),
    Config  = require('./../config');

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

//        console.log("Bundle", bundle);
//        console.log("Model", model);

        _this.getConfig(bundle, function(err, conf){

            if (!err) {
                console.log("CONF READY ", conf.path/** conf*/);
                //Getting Entity Manager.
                var EntityManager = require(conf.path);
                Utils.extend(true, _this, EntityManager);
            } else {
                console.log("no configuration found...");
            }
        });
    };


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
    _init(namespace);
};

module.exports = Model;
