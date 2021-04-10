/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2021 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

 var fs = require('fs');
 var console = require('./../../../lib/logger');
/**
 * TextHelper
 *
 * @package     Gina.Utils.Helpers
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */

module.exports = function(){

    
    /**
     * Load a json file and removing comments if found
     *
     * @return {string} filename - path
     * */
    requireJSON = function(filename){        
        
        //console.debug('[ Helpers ][ requireJSON ] ', filename);
        
        var i                       = null
            , len                   = null
            , comments_with_slashes = null
            , jsonStr               = null
        ;
        
        try {
            jsonStr = fs.readFileSync(filename).toString();
        } catch (err) {
            if ( typeof(console.emerg) != 'undefined' ) {
                console.emerg(err.stack);
                process.exit(1);
            }
            throw err            
        }
        
        
        /** block style comments */
        if ( /\/\*\*/.test(jsonStr) ) {
            jsonStr   = jsonStr.replace(/(\/\*([^*]|[\r\n]|(\*+([^*\/]|[\r\n])))*\*+\/)/g, '');
        }
        
        // line style comments
        comments_with_slashes = jsonStr.match(/\/\/(.*)?/g);        
                
        len = ( comments_with_slashes) ? comments_with_slashes.length : 0;
        if (comments_with_slashes && len > 0) {
            i = 0;
            for(; i< len; ++i) {
                // ignore urls
                if ( /(\:|\")/.test( jsonStr.substr(jsonStr.indexOf(comments_with_slashes[i])-1,1) ) )
                    continue;
                    
                jsonStr = jsonStr.replace(comments_with_slashes[i], '');
            }
        }        
        
        try {      
            return JSON.parse(jsonStr)
        } catch (err) {        
            var pos = err.stack.match(/position(\s|\s+)\d+/)[0].replace(/[^\d+]/g, '');            
            jsonStr = jsonStr.substr(0, pos) + '--(ERROR !)--\n' + jsonStr.substr(pos);
            var msg = (jsonStr.length > 400) ?  '...'+ jsonStr.substr(pos-200, 300) +'...' : jsonStr;
            
            var error = new Error('[ requireJSON ] could not parse `'+ filename +'`:' +'\n\rSomething is wrong arround this portion:\n\r'+msg+'<strong style="color:red">"</strong>\n\rPlease check your file: `'+ filename +'`'+ '\n\r<strong style="color:red">'+err.stack+'</strong>\n');       
            if ( typeof(console.emerg) != 'undefined' ) {
                console.emerg(error.message);
                process.exit(1);
            }            
            throw error;
        }               
    };

};//EO JSONHelper.
