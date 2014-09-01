/*
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Geena.Core.Utils Class
 *
 * @package    Geena.Core
 * @author     Rhinostone <geena@rhinostone.com>
 */


var merge = require('./lib/merge');


function Utils() {

    var self = this;


    /**
     * Clean files on directory read
     * Mac os Hack
     * NB.: use once in the server.js
     * TODO - remove it...
     **/
    this.cleanFiles = function(files){
        for(var f=0; f< files.length; f++){
            if(files[f].substring(0,1) == '.')
                files.splice(0,1);
        }
        return files;
    };

    var _require = function(path) {
        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve(path)];
            return require(path)
        } else {
            return require(path)
        }
    }


    return {
        Config      : _require('./lib/config'),
        //dev     : require('./lib/dev'),//must be at the same level than geena.utils => geena.dev
        inherits    : _require('./lib/inherits'),
        helpers     : _require('./lib/helpers'),
        //this one must move to Dev since it's dev related
        Model       : _require('./lib/model'),
        merge       : _require('./lib/merge'),
        generator   : _require('./lib/generator'),//move to geena.dev
        Proc        : _require('./lib/proc'),
        Shell       : _require('./lib/shell'),
        logger      : _require('./lib/logger'),
        url         : _require('./lib/url'),
        cmd         : _require('./lib/cmd'),
        Validator   : _require('./lib/validator')
    }
};

module.exports = Utils()