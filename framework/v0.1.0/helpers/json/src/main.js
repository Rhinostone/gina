/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

 var fs = require('fs');
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
            throw new Error('[ requireJSON ] could not parse `'+ filename +'`:\n\r' /*+ fs.readFileSync(filename).toString()*/ +'\n\rSomething is wrong arround this portion:\n\r<strong style="color:red">'+err.stack+'</strong><br>'+jsonStr+'<strong style="color:red">"</strong>\nPlease check your file: `'+ filename +'`'+ '\n');       
        }               
    };
   

};//EO JSONHelper.
