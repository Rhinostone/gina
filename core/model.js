/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Model super class
 *
 *
 * @package     Geena
 * @namespace   Geena.Model
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */

/*
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Controller Super class
 *
 *
 * @package     Geena
 * @namespace   Geena.Controller
 * @author      Rhinostone <geena@rhinostone.com>
 * @api         Public
 */
var Fs              = require("fs"),
    Utils           = require("./utils"),
    Model      = {
        app : {},
        init : function(){},
        /**
         * Load model
         *
         * @return {void}
         *
         * @private
         **/
        load : function(bundle, model){
            console.log("Super model loaded !!!!", bundle, model);
        },
        /**
         * Get config
         *
         * @param {string} [name] - Conf name without extension.
         * @return {object} result
         *
         * TODO - Protect result
         * */
        getConfig : function(){
            var name = 'models';

            try {
                return this.app.conf[name][this.app.appName];
            } catch (err) {
                return this.appName + '/models.json is ' + undefined + ' or malformed.';
            }
        }
    };



module.exports = Model;
