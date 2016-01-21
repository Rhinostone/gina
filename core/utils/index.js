/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Gina.Core.Utils Class
 *
 * @package    Gina.Core
 * @author     Rhinostone <gina@rhinostone.com>
 */


var merge = require('./lib/merge');


function Utils() {

    var _require = function(path) {
        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            try {
                delete require.cache[require.resolve(path)];
                return require(path)
            } catch (err) {
                return {}
            }

        } else {
            return require(path)
        }
    }


    var self =  {
        Config      : _require('./lib/config'),
        //dev     : require('./lib/dev'),//must be at the same level than gina.utils => gina.dev
        inherits    : _require('./lib/inherits'),
        helpers     : _require('./lib/helpers'),
        //this one must move to Dev since it's dev related
        Model       : _require('./lib/model'),
        merge       : _require('./lib/merge'),
        generator   : _require('./lib/generator'),//move to gina.dev
        Proc        : _require('./lib/proc'),
        Shell       : _require('./lib/shell'),
        logger      : _require('./lib/logger'),
        math        : _require('./lib/math'),
        url         : _require('./lib/url'),
        cmd         : _require('./lib/cmd'),
        multiparty  : _require('multiparty'),
        Validator   : _require('./lib/validator')
    };

    /**
     * Clean files on directory read
     * Mac os Hack
     * NB.: use once in the server.js
     * TODO - remove it...
     **/
    self.cleanFiles = function(files){
        for(var f=0; f< files.length; f++){
            if(files[f].substring(0,1) == '.')
                files.splice(0,1);
        }
        return files;
    };

    return self
};

module.exports = Utils()