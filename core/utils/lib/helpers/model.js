/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * ModelHelper
 *
 * @package     Geena.Utils.Helpers
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */
var ModelHelper;

var extend = require('./../extend.js');

ModelHelper = function(models) {
    var _this = this;
    /**
     * Init
     * @contructor
     * */
    var init = function(models) {
        if ( typeof(ModelHelper.initialized) != "undefined" ) {
            return ModelHelper.instance
        } else {
            ModelHelper.initialized = true;
            ModelHelper.instance = _this
        }

        if ( typeof(models) == 'undefined' ) {
            var models = {
                entities : {}
            }
        }
        _this.models = models
    }

    this.setConnection = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (typeof(_this.models[name]) == 'undefined') {
                _this.models[name] = {}
            }

            if ( typeof(_this.models[name]['getConnection']) != "undefined") {
                extend(
                    _this.models[name]['getConnection'],
                    function() {
                        return _this.models[name]['_connection']
                    }
                )
            } else {
                _this.models[name]['_connection'] = obj;
                _this.models[name]['getConnection'] = function() {
                    return _this.models[name]['_connection']
                }
            }
        } else {
            //not sure...
            _this.models = arguments[0]
        }
    }


    this.setModel = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if ( typeof(_this.models[name]) != "undefined") {
                extend(_this.models[name], obj)
            } else {
                _this.models[name] = obj
            }
        } else {
            _this.models = arguments[0]
        }
    }

    getModel = function(name) {
        if ( typeof(name) != 'undefined' ) {
            try {
                return _this.models[name]
            } catch (err) {
                return undefined
            }
        } else {
            return _this.models
        }
    }

    init(models);
};

module.exports = ModelHelper