/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


var merge = require('./../merge');

/**
 * ModelHelper
 *
 * @package     Geena.Utils.Helpers
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */
function ModelHelper(models) {
    var self = this;
    /**
     * Init
     * @contructor
     * */
    var init = function(models) {
        if ( typeof(ModelHelper.initialized) != "undefined" ) {
            return ModelHelper.instance
        } else {
            ModelHelper.initialized = true;
            ModelHelper.instance = self
        }

        if ( typeof(models) == 'undefined' ) {
            var models = {
                entities : {}
            }
        }
        self.models = models
    }

    this.setConnection = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (typeof(self.models[name]) == 'undefined') {
                self.models[name] = {}
            }

            if ( typeof(self.models[name]['getConnection']) != "undefined") {
                merge(
                    self.models[name]['getConnection'],
                    function() {
                        return self.models[name]['_connection']
                    }
                )
            } else {
                self.models[name]['_connection'] = obj;
                self.models[name]['getConnection'] = function() {
                    return self.models[name]['_connection']
                }
            }
        } else {
            //not sure...
            self.models = arguments[0]
        }
    }


    this.setModel = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if ( typeof(self.models[name]) != "undefined") {
                merge(self.models[name], obj)
            } else {
                self.models[name] = obj
            }
        } else {
            self.models = arguments[0]
        }
    }

    getModel = function(name) {
        if ( typeof(name) != 'undefined' ) {
            try {
                return self.models[name]
            } catch (err) {
                return undefined
            }
        } else {
            return self.models
        }
    }

    init(models);
};

module.exports = ModelHelper