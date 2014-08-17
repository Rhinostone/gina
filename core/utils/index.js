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

    // TODO - Should be in another handler.. closer to the view controller/handler
    this.refToObj = function (arr){
        var tmp = null,
            curObj = {},
            obj = {},
            count = 0,
            data = {},
            last = null;
        //console.info('arr is --------------------------\n', arr);
        for (var r in arr) {
            tmp = r.split(".");
            //console.info('len ', r,tmp);
            //Creating structure - Adding sub levels
            for (var o in tmp) {
                //console.info('ooo ', o, tmp[o], arr[r]);
                count++;
                if (last && typeof(obj[last]) == "undefined") {
                    curObj[last] = {};
                    //console.info("count is ", count);
                    if (count >= tmp.length) {
                        //Assigning.
                        // !!! if null or undefined, it will be ignored while extending.
                        curObj[last][tmp[o]] = (arr[r]) ? arr[r] : "undefined";
                        last = null;
                        count = 0;
                        break;
                    } else {
                        curObj[last][tmp[o]] = {};
                    }
                } else if (tmp.length === 1) { //Just one root var
                    //console.info('assigning ', arr[r], ' to ',tmp[o]);
                    curObj[tmp[o]] = (arr[r]) ? arr[r] : "undefined";
                    //last = null;
                    //count = 0;
                    obj = curObj;
                    break;
                }
                obj = curObj;
                last = tmp[o];
            }
            //console.info('current obj ',obj);
            data = merge(true, data, obj);
            //console.info('merged ', data);
            obj = {};
            curObj = {};
        }
        return data;
    }

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
        merge       : _require('./lib/merge'),
        generator   : _require('./lib/generator'),//move to geena.dev
        Proc        : _require('./lib/proc'),
        Shell       : _require('./lib/shell'),
        logger      : _require('./lib/logger'),
        url         : _require('./lib/url'),
        cmd         : _require('./lib/cmd')
    }
};

module.exports = Utils()