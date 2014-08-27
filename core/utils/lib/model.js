/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


var merge = require('./merge');

/**
 * Model uitls
 *
 * @package     Geena.Utils
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */
function Model() {
    var self = this;

    /**
     * Init
     * @contructor
     * */
    var init = function() {

        if ( !Model.instance ) {
            self.models = self.models || {};
            self.entities = {};
            Model.instance = self;
            return self
        } else {
            self = Model.instance;
            return Model.instance
        }
    }

    this.setConnection = function(name, conn) {
        if (arguments.length > 1) {
            if (!self.models) {
                self.models = {}
            }
            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('Connection must have a name !')
            }

            if (typeof(self.models[name]) == 'undefined') {
                self.models[name] = {}
            }


            self.models[name]['_connection'] = conn;
            self.models[name]['getConnection'] = function() {
                return self.models[name]['_connection']
            }
        } else {
            //not sure...
            self.models = arguments[0]
        }
    }

    /**
     *
     * @param {string} name - Entity name
     * @param {object} module
     *
     * */
    this.setModelEntity = function(model, name, module) {
        if (arguments.length > 1) {
            if (!self.models) {
                self.models = {}
            }
            if ( typeof(name) == 'undefined' || name == '' ) {
                throw new Error('ModelHelper cannot set ModelEntity whitout a name !')
            }

            if( !self.entities[model] ) {
                self.entities[model] = {}
            }
            if ( typeof(self.entities[model][name]) != "undefined") {
                merge(self.entities[model][name], module)
            } else {
                self.entities[model][name] = module
            }
        } else {
            self.entities[model] = arguments[0]
        }
    }

    this.updateEntityObject = function(model, name, entityObject) {

        if ( typeof(model) == 'undefined' || model == '' ) {
            throw new Error('ModelHelper cannot update EntityObject whitout a connector !')
        }

        if ( typeof(name) == 'undefined' || name == '' ) {
            throw new Error('ModelHelper cannot set ModelEntity whitout a name !')
        }

        if (!self.models[model][name]) {
            self.models[model][name] = {}
        }

        self.models[model][name] = merge(self.models[model][name], entityObject);
        return self.models[model][name]
    }

    this.setModel = function(name, obj) {
        if (arguments.length > 1) {
            if ( typeof(name) == 'undefined' || name == '' ) {
                var name = 'global'
            }

            if (!self.models[name]) {
                self.models[name] = {}
            }

            self.models[name] = merge(self.models[name], obj)
        } else {
            self.models = arguments[0]
        }
    }

    getModel = function(model) {
        if ( typeof(model) != 'undefined' ) {
            try {
                return self.models[model]
            } catch (err) {
                return undefined
            }
        } else {
            return self.models
        }
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
    getModelEntity = function(model, entityName, conn) {
        if ( typeof(entityName) != 'undefined' ) {
            try {
                var shortName = entityName.substr(0, 1).toLowerCase() + entityName.substr(1);
                if ( self.models[model][shortName] ) {
                    return self.models[model][shortName]
                }
                var entityObj = new self.entities[model][entityName](conn);
                return self.models[model][shortName] || entityObj
            } catch (err) {
                return undefined
            }
        } else {
            return self.entities[model]
        }
    }

    return init()
}

module.exports = Model