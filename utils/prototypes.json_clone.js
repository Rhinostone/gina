/**
 * JSON.clone
 * Clone JSON object
 * 
 * Changes made here must be reflected in: 
 *  - gina/utils/prototypes.js
 *  - gina/framework/version/helpers/prototypes.js
 *  - gina/framework/version/core/asset/js/plugin/src/gina/utils/polyfill.js
 * 
 * @param {object} source
 * @param {object} [target]
 * 
 * @returns {object} cloned JSON object
 **/
function JSONClone(source, target) {
    if (source == null || typeof source != 'object') return source;
    if (source.constructor != Object && source.constructor != Array) return source;
    
    if (
        source.constructor == Date 
        || source.constructor == RegExp 
        || source.constructor == Function 
        || source.constructor == String 
        || source.constructor == Number 
        || source.constructor == Boolean
    ) {
        return new source.constructor(source);
    }
        

    try {
        target = target || new source.constructor();
    } catch (err) {                
        throw err;
    }
    
    var i       = 0
        , len   = Object.getOwnPropertyNames(source).length || 0
        , keys  = Object.keys(source)
    ;
    
    while (i<len) {
        let key = Object.getOwnPropertyNames(source)[i];
        if (key == 'undefined') {
            i++;
            continue;
        }
        if (source[key] === undefined) {
            var warn = new Error('JSON.clone(...) possible error detected: source['+key+'] is undefined !! Key `'+ key +'` should not be left `undefined`. Assigning to `null`');
            warn.stack = warn.stack.replace(/^Error\:\s+/g, '');
            if ( typeof(warn.message) != 'undefined' ) {
                warn.message = warn.message.replace(/^Error\:\s+/g, '');
            }
            console.warn(warn);
            target[key] = null
        } else {
            target[key] = (typeof target[key] == 'undefined' ) ? JSONClone(source[key], null) : target[key];
        }
        
        i++;
    }
    i = null; len = null; keys = null;

    return target;
}

// TODO - add unit tests
// TODO - decide which one we want to keep
// Following code should have the same effect as the default code, but error are better handled

// var JSONClone = function(source, target) {
//     if (source == null || source == undefined || typeof source != 'object') return source;
//     if (source.constructor.name != 'Object' && source.constructor.name != 'Array') return source;
//     // if (
//     //     source.constructor == Date 
//     //     || source.constructor == RegExp 
//     //     || source.constructor == Function 
//     //     || source.constructor == String 
//     //     || source.constructor == Number 
//     //     || source.constructor == Boolean
//     // ) {
//     //     return new source.constructor(source)
//     // }
    
//     //target = target || new source.constructor();
//     target = ( typeof(target) != 'undefined' && target) ? target : new source.constructor();
//     var i       = 0
//         , len   = Object.getOwnPropertyNames(source).length || 0
//         , keys  = Object.keys(source)
//         , error = null
//     ;
    
//     while (i<len) {
//         try {
//             //target[keys[i]] = (typeof target[keys[i]] == 'undefined') ? JSONClone(source[keys[i]], null) : target[keys[i]];
//             if (typeof target[keys[i]] != 'undefined') {
//                 ++i;
//                 continue;
//             }
//             if ( typeof(source[keys[i]]) != 'undefined' ) {
//                 let _source = source[keys[i]];
//                 if (/^null|undefined$/i.test(_source)) {
//                     target[keys[i]] = _source
//                 }                        
//                 else if (
//                     _source.constructor.name == 'Date'
//                     || _source.constructor.name == 'RegExp'
//                     || _source.constructor.name == 'Function'
//                     || _source.constructor.name == 'String'
//                     || _source.constructor.name == 'Number'
//                     || _source.constructor.name == 'Boolean'
//                 ) {
//                     target[keys[i]] =  _source
//                 } 
//                 else if (
//                     // _source.constructor.name == 'Date'
//                     // || _source.constructor.name == 'RegExp'
//                     // || _source.constructor.name == 'Function'
//                     // || _source.constructor.name == 'String'
//                     // || _source.constructor.name == 'Number'
//                     // || _source.constructor.name == 'Boolean'
//                     //|| 
//                     _source.constructor.name == 'Array'
//                     //|| _source.constructor.name == 'Object'
//                 ) {
//                     //target[keys[i]] = new _source.constructor(_source)
//                     target[keys[i]] = _source.slice()
//                 }
//                 else {
//                     //target[keys[i]] = JSONClone(_source[keys[i]], null)
//                     target[keys[i]] = new _source.constructor(_source)
//                 }
//             }

//             i++;
//         } catch (err) {
//             var errString = 'JSON.clone(...) error on constructor not supported: ['+ keys[i] +'] `'+ source.constructor.name  +'`\n'+ err.stack;
//             console.error(errString);
//             error = new Error(errString);
//             break;
//         }  
//     }
    
//     if (error) {
//         throw error;
//     }
    
//     i = null; len = null; keys = null;

//     return target;
                    
// };



// WHY NOT USE SOMETHING ELSE ?
// Could have been fine, but not working when you have references pointing to another object
// return Object.assign({}, source);
// var JSONClone = function(source, target) {
//     return Object.assign(target||{}, source);
// };

// Performences issue
//return JSON.parse(JSON.stringify(source));
// var JSONClone = function(source) {
//     return JSON.parse(JSON.stringify(source));
// };

if ((typeof (module) !== 'undefined') && module.exports) {
    // Publish as node.js module
    module.exports = JSONClone
} else if (typeof (define) === 'function' && define.amd) {
    // Publish as AMD module    
    return JSONClone
}