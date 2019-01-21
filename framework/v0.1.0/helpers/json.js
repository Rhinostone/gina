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
        
        var jsonStr = fs.readFileSync(filename).toString();   
        // don't take any between quotes & and ignore chars like `:`  `,`  - ([^"A-Za-z0-9_:,"]+)
        // ignore {" - [^}"]
        
        
        comments_with_slashes    = jsonStr.match(/[^}"](\/\/\s+[A-Za-z0-9-_ \.(\)\:\!\?\#\,]+|\/\/[A-Za-z0-9-_ \.(\)\:\!\?\#\,]+)+|(\/\/".*\"\,|\/\/".*\")+/g);
        //comments_with_slashes    = jsonStr.match(/[^}"](\/\/\s+[A-Za-z0-9-_ \(\)\:\!\?\#]+|\/\/[A-Za-z0-9-_ \(\)\:\!\?\#]+)+|(\/\/".*\"\,|\/\/".*\")+/g);
        if ( comments_with_slashes ) {
            for (var m = 0, mLen = comments_with_slashes.length; m < mLen; ++m) {
                jsonStr = jsonStr.replace(comments_with_slashes[m], '');
            }                    
        } 
        
        try {
            return JSON.parse(jsonStr) 
        } catch (err) {
            throw new Error('[ requireJSON ] could not parse `'+ filename +'`:\n\r' + fs.readFileSync(filename).toString() +'\n\rVS\n\r<strong style="color:red">"</strong>'+jsonStr+'<strong style="color:red">"</strong>');            
        }
               
    };
   

};//EO JSONHelper.
