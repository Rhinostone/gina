//var console = require('./../../../lib/logger');
var merge = require('./../../../lib/merge');
function ValidatorError(fieldName, errorMessage) {
    //console.log('[ValidatorError] ', fieldName, errorMessage);
    
    var error = { // default status is 500
        status  : 500,
        fields  : {},
        location: '',
        stack   : ''
    };
    error.fields[fieldName] = errorMessage;
    var ctx             = getContext()
        , bundleName    = ctx.bundle
        , stackObj      = __stack[2]
    ;
    if ( typeof(stackObj) == 'object' ) {
        try {
            error.stack += bundleName +':';
            var filename    = stackObj.getFileName();
            
            //filename.substr(filename.lastIndexOf('\/')+1).replace(/\.js/, '')
            var re          = new RegExp('('+bundleName+'\/)(model|controller)');
            if ( re.test(filename) ) {
                var paths = getPaths(), path = null;
                if ( /model/i.test(filename) ) {
                    path = paths.models.substr(paths.models.lastIndexOf(bundleName)) +'/'+ filename.substr(filename.lastIndexOf(bundleName+'\/models'));
                    error.stack += 'model:'
                } else {
                    path = paths.controllers.substr(paths.controllers.lastIndexOf(bundleName)) +'/'+ filename.substr(filename.lastIndexOf(bundleName+'\/controllers'));
                    error.stack += 'controller:'
                }
                error.location = path;
            }
            error.stack += stackObj.getFunctionName().replace(/\./g, ':') +'  '+stackObj.getLineNumber()+':'+stackObj.getColumnNumber();
        } catch (err) {
            error.stack = err.stack;
        }        
    } else {
        error.stack = 'N/A';
    }
    var e = new Error( errorMessage );
    
    return merge(error, e);
}
if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = ValidatorError;
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( function() { return ValidatorError });
}