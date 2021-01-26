/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

 var fs = require('fs');
/**
 * PluginsHelper
 *
 * @package     Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */

module.exports = function(loadedPlugins){
    for (let plugin in loadedPlugins) {
        switch (plugin) {
            case 'Validator':
                // Global
                if ( typeof(ValidatorError) == 'undefined')
                    ValidatorError = require('./validator-error');
                break;
        
            default:
                break;
        }
    }
};//EO JSONHelper.
