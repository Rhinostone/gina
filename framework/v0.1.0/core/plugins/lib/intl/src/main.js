
function IntlPlugin() {

    var merge       = merge || require('utils/merge');
    var Collection  = Collection || require('utils/collection');

    var self = {
        options : {
            isCaseSensitive: true,
            locale: 'en' // by default
        }
    };
    
    // load phrases
    var phrases = {
        'amendment' : {
            _data : null,
            en : 'amendment',
            fr : 'avenant'
        }
    }

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    var merge       = require('utils/merge');
    var Collection  = require('utils/collection');

    module.exports  = IntlPlugin

} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/intl', function(){ return IntlPlugin })
}