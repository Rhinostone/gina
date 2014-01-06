/* Geena.Utils.extend(source, prop1, prop2..)
 *
 * Copyright (c) 2009-2014 Rhinostone <geena@rhinostone.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, extend, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
//var fs = require('fs');

function isObject(obj){
    if( !obj
        || {}.toString.call(obj) !== '[object Object]'
        || obj.nodeType
        || obj.setInterval
    ){
        return false;
    }

    var hasOwn              = {}.hasOwnProperty;
    var hasOwnConstructor   = hasOwn.call( obj, 'constructor');
    var hasMethodPrototyped = hasOwn.call( obj.constructor.prototype, 'isPrototypeOf');


    if( obj.constructor &&
        !hasOwnConstructor &&
        !hasMethodPrototyped ){
      return false;
    }

    //Own properties are enumerated firstly, so to speed up,
    //if last one is own, then all properties are own.
    var key;
    for( key in obj ){}

    return key === undefined || hasOwn.call( obj, key );
};

function extend (){
  var target = arguments[ 0 ] || {};
  var i      = 1;
  var length = arguments.length;
  var deep   = false;
  var options, name, src, copy, copy_is_array, clone;

  // Handle a deep copy situation
  if( typeof target === 'boolean' ){
    deep   = target;
    target = arguments[ 1 ] || {};
    // skip the boolean and the target
    i = 2;
  }

  // Handle case when target is a string or something (possible in deep copy)
  if( typeof target !== 'object' && typeof target !== 'function' ){
    target = {};
  }

  for( ; i < length; i++ ){
    // Only deal with non-null/undefined values
    if(( options = arguments[ i ]) != null ){
      // Extend the base object

      for( name in options ){
        src  = target[ name ];
        copy = options[ name ];

        // Prevent never-ending loop
        if( target === copy ){
          continue;
        }

        // Recurse if we're merging plain objects or arrays
        if( deep && copy && ( isObject( copy ) || ( copy_is_array = Array.isArray( copy )))){

            if( copy_is_array ){
                copy_is_array = false;
                clone = src && Array.isArray( src ) ? src : [];
            }else{
                clone = src && isObject( src)  ? src : {};
            }

            //[propose] Supposed to go deep... deep... deep...
            for(var prop in copy){
                if(typeof(clone[ prop ]) != "undefined"){
                    copy[ prop ] = clone[ prop ];
                }
            }

          // Never move original objects, clone them
          if(typeof(src) != "boolean"){//if property is not boolean
            target[ name ] = extend( deep, clone, copy );
          }
        // Don't bring in undefined values
        }else if( copy !== undefined ){
            //[propose]Don't override existing if prop defined
            if(typeof(src) != "undefined" && src != copy){
                target[ name ] = src;
            }else{
                target[ name ] = copy;
            }

        }
      }
    }
  }

  // Return the modified object
  return target;
};

//Exports module.
module.exports = extend;