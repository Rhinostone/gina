/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

 var fs = require('fs');
 var console = require('./../../../lib/logger');
/**
 * JSONHelper
 *
 * @package     Gina.Lib.Helpers
 * @author      Rhinostone <contact@gina.io>
 * @api public
 * */

module.exports = function(){

    // `JSON.clone()` is a prototype defined in `GINA_DIR//lib/prototypes.json_clone`

    encodeRFC5987ValueChars = function(str) {
        // return encodeURIComponent(str).
        //   // Bien que la RFC 3986 réserve "!", RFC 5987 ne réserve pas ce caractère,
        //   // il n'est donc pas nécessaire l'échapper
        //   replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)). // i.e., %27 %28 %29 %2a
        //   // on notera que l'encodage valide pour "*" est %2A et qui faut donc appeler toUpperCase()
        //   // pour encoder exactement.

        //   // Selon la RFC 5987 ce qui suit n'est pas nécessairement requis
        //   // on peut donc bénéficier d'un peu plus de lisibilité : |`^
        //   replace(/%(7C|60|5E)/g, (str, hex) => String.fromCharCode(parseInt(hex, 16)));

        // return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
        //     return '%' + c.charCodeAt(0).toString(16);
        //   });

        return encodeURIComponent(str).
        // Bien que la RFC 3986 réserve "!", RFC 5987 ne réserve pas ce caractère,
        // il n'est donc pas nécessaire l'échapper
        replace(/['()]/g, escape). // c'est-à-dire %27 %28 %29
        replace(/\*/g, '%2A').
            // Selon la RFC 5987 ce qui suit n'est pas nécessairement requis
            // on peut donc bénéficier d'un peu plus de lisibilité : |`^
            replace(/%(?:7C|60|5E)/g, unescape);
    };

    /**
     * Load a json file and removing comments if found
     *
     * @param {string} filename - path to json content
     *
     * @return {object} jsonObject
     * */
    requireJSON = function(filename){

        //console.debug('[ Helpers ][ requireJSON ] ', filename);

        var i                       = null
            , len                   = null
            , commentsWithSlashes = null
            , jsonStr               = null
        ;

        try {
            if ( typeof(process.env.NODE_ENV_IS_DEV) != 'undefined' && /true/i.test(process.env.NODE_ENV_IS_DEV) ) {
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

    // var isEncoded = function(uri) {
    //     uri = uri || '';
    //     return uri !== decodeURIComponent(uri);
    // }

    /**
     * Convert JSON string with structured keys to object
     *
     * @param {string} JSON string with structured keys
     * */
    parseBodyString = function(bodyStr){
        try {
            bodyStr = decodeURIComponent(bodyStr);
        } catch (err) {
            // Already decoded - ignoring
        }

        // false & true case
        if ( /(\"false\"|\"true\"|\"on\")/.test(bodyStr) ) {
            bodyStr = bodyStr.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);
        }
        if ( /(\"null\")/i.test(bodyStr) ) {
            bodyStr = bodyStr.replace(/\"null\"/ig, null);
        }

        return parseBody(bodyStr);
    }

    var parseCollection = function (collection, obj) {

        for(var i = 0, len = collection.length; i<len; ++i) {
            obj[i] = parseObject(collection[i], obj);
        }

        return obj
    }

    var parseObject = function (tmp, obj) {
        var el      = []
            , key   = null
        ;

        if (!obj) {
            obj = {}
        }

        for (let o in tmp) {

            el[0]   = o;
            el[1]   = tmp[o];

            if ( /^(.*)\[(.*)\]/.test(el[0]) ) { // some[field] ?
                key = el[0].replace(/\]/g, '').split(/\[/g);
                obj = parseLocalObj(obj, key, 0, el[1])
            } else {
                obj[ el[0] ] = el[1]
            }
        }

        return obj
    }

    var parseBody = function(body) {
        var obj             = null
            , tmp           = null
            , arr           = null
            , isArrayType   = null
        ;
        if ( /^(\{|\[|\%7B|\%5B)/.test(body) ) {
            try {
                isArrayType = ( /^(\{|\%7B)/.test(body) ) ? false : true;
                obj = ( isArrayType ) ? [] : {};

                if ( /^(\%7B|\%5B)/.test(body) ) {
                    tmp = JSON.parse(decodeURIComponent(body))
                } else {
                    tmp = JSON.parse(body)
                }

                if ( Array.isArray(tmp) ) {
                    obj = parseCollection(tmp, obj)
                } else {
                    obj = parseObject(tmp, obj)
                }

                return obj
            } catch (err) {
                console.error('[365] could not parse body:\n' + body)
            }

        } else {
            obj = {};
            arr = body.split(/&/g);
            if ( /(\"false\"|\"true\"|\"on\")/.test(body) )
                body = body.replace(/\"false\"/g, false).replace(/\"true\"/g, true).replace(/\"on\"/g, true);


            var el      = {}
                , value = null
                , key   = null;

            for (var i = 0, len = arr.length; i < len; ++i) {
                if (!arr[i]) continue;

                arr[i] = decodeURIComponent(arr[i]);

                if ( /^\{/.test(arr[i]) || /\=\{/.test(arr[i]) || /\=\[/.test(arr[i]) ) {
                    try {
                        if (/^\{/.test(arr[i])) {
                            obj = JSON.parse(arr[i]);
                            break;
                        } else {
                            el = arr[i].match(/\=(.*)/);
                            el[0] =  arr[i].split(/\=/)[0];
                            obj[ el[0] ] = JSON.parse( el[1] );
                        }


                    } catch (err) {
                        console.error('[parseBody#1] could not parse body:\n' + arr[i])
                    }
                } else {
                    el = arr[i].split(/=/);
                    if ( /\{\}\"\:/.test(el[1]) ) { //might be a json
                        try {
                            el[1] = JSON.parse(el[1])
                        } catch (err) {
                            console.error('[parseBody#2] could not parse body:\n' + el[1])
                        }
                    }

                    if ( typeof(el[1]) == 'string' && !/\[object /.test(el[1])) {
                        key     = null;
                        el[0]   = decodeURIComponent(el[0]);
                        el[1]   = decodeURIComponent(el[1]);

                        if ( /^(.*)\[(.*)\]/.test(el[0]) ) { // some[field] ?
                            key = el[0].replace(/\]/g, '').split(/\[/g);
                            obj = parseLocalObj(obj, key, 0, el[1])
                        } else {
                            obj[ el[0] ] = el[1]
                        }
                    }
                }
            }

            return obj
        }
    }

    // var parseLocalObj = function(obj, key, k, value) {

    //     if ( typeof(obj[ key[k] ]) == 'undefined' ) {
    //         obj[ key[k] ] = {};
    //     }

    //     for (var prop in obj) {

    //         if (k == key.length-1) {

    //             if (prop == key[k]) {
    //                 obj[prop] = ( typeof(value) != 'undefined' ) ? value : '';
    //             }

    //         } else if ( key.indexOf(prop) > -1 ) {
    //             ++k;
    //             if ( !obj[prop][ key[k] ] )
    //                 obj[prop][ key[k] ] = {};


    //             parseLocalObj(obj[prop], key, k, value)

    //         }
    //     }

    //     return obj;
    // }

    var parseLocalObj = function(obj, key, k, value) {

        for (let i=0,len=key.length; i<len; i++) {
            // by default
            let _key = key[k];
            if (i == k) {
                // Array or Object ?
                if ( typeof(obj[ key[k] ]) == 'undefined' || typeof(obj[ key[k] ]) == 'string' ) {
                    if ( Array.isArray(obj) ) {
                        // index
                        // _key = obj.length;
                        _key = ~~key[k];
                        obj[ _key ] = ( /^\d+$/.test(key[k+1]) ) ? [] : {};
                    } else {
                        obj[ key[k] ] = ( /^\d+$/.test(key[k+1]) ) ? [] : {};
                    }
                }

                // Assinging value
                if (k == key.length-1) {
                    let _value = ( typeof(value) != 'undefined' ) ? value : '';
                    if ( Array.isArray( obj[key[k]] ) ) {
                        obj[key[k]].push(_value);
                        // _key = (obj.length > 0) ? obj.length-1 : 0;
                        // obj[ _key ] = _value;
                    }
                    else {
                        obj[ key[k] ] = _value;
                    }
                    break;
                }
                // Assinging index or key
                else {
                    if ( /^\d+$/.test(key[k]) && !Array.isArray(obj) ) {
                        obj = [];
                        // _key = (obj.length > 0) ? obj.length-1 : 0;
                    }
                    // Handle unstructured array from object
                    // E.G.: design[1][id] where design is starting with `1` index instead of `0`
                    // if ( Array.isArray(obj) ) {
                    //     // current Index
                    //     _key = ~~key[k];
                    //     // _key = (obj.length > 0) ? obj.length-1 : 0;
                    // }
                    // Init array or object
                    if ( typeof(obj[ _key ]) == 'undefined' ) {
                        // obj[ _key ] = ( /^\d+$/.test(key[k+1]) ) ? [] : {};
                        obj[ _key ] = null;
                    }

                    parseLocalObj(obj[ _key ], key, k+1, value);
                }
            }
        }

        return obj;
    }

};//EO JSONHelper.
