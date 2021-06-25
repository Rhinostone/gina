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
            , commentsWithSlashes = null
            , jsonStr               = null
        ;
        
        try {
            if ( typeof(process.env.IS_CACHELESS) != 'undefined' && /true/i.test(process.env.IS_CACHELESS) ) {
                delete require.cache[filename];
            }
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
        commentsWithSlashes = jsonStr.match(/\/\/(.*)?/g);        
                
        len = ( commentsWithSlashes) ? commentsWithSlashes.length : 0;
        if (commentsWithSlashes && len > 0) {
            i = 0;
            for(; i< len; ++i) {
                // ignore urls
                if ( /(\:|\")/.test( jsonStr.substr(jsonStr.indexOf(commentsWithSlashes[i])-1,1) ) )
                    continue;
                    
                jsonStr = jsonStr.replace(commentsWithSlashes[i], '');
            }
        }        
        
        try {      
            return JSON.parse(jsonStr)
        } catch (err) {
            var pos     = null
                , msg   = null
                , error = null
            ;
            var stack   = err.stack.match(/position(\s|\s+)\d+/);
            if ( Array.isArray(stack) && stack.length > 0) {
                pos     = stack[0].replace(/[^\d+]/g, '');            
                jsonStr = jsonStr.substr(0, pos) + '--(ERROR !)--\n' + jsonStr.substr(pos);
                msg     = (jsonStr.length > 400) ?  '...'+ jsonStr.substr(pos-200, 300) +'...' : jsonStr;
                error = new Error('[ requireJSON ] could not parse `'+ filename +'`:' +'\n\rSomething is wrong around this portion:\n\r'+msg+'<strong style="color:red">"</strong>\n\rPlease check your file: `'+ filename +'`'+ '\n\r<strong style="color:red">'+err.stack+'</strong>\n');       
            } else {
                error = new Error('[ requireJSON ] could not parse `'+ filename +'`:' +'\n\rSomething is wrong with the content of your file.\n\rPlease check the syntax of your file : `'+ filename +'`'+ '\n\r<strong style="color:red">'+err.stack+'</strong>\n');       
            }
            
            if ( !/\/controllers/i.test(err.stack) && typeof(console.emerg) != 'undefined' ) {
                console.emerg(error.message);
                process.exit(1);
            }            
            throw error;
        }               
    };

};//EO JSONHelper.
