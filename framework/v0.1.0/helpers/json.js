/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

 const fs = require('fs');
/**
 * TextHelper
 *
 * @package     Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */

module.exports = function(){

    
    var comments = []
    /**
     * Load a json file and removing comments if found
     *
     * @return {string} filename - path
     * */
    requireJSON = function(filename){
        
        var jsonStr = fs.readFileSync(filename);
        comments    = jsonStr.match(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)|(\/\/.*)[^{}]/g);        
        
        if (comments.length > 0) {
            jsonStr = jsonStr.replace(comments[0], '');
        }
        
        return JSON.parse(jsonStr)        
    };
   

};//EO JSONHelper.
