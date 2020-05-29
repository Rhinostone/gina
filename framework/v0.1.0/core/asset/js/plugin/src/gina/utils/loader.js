"use strict";
/**
 * onGinaLoaded
 *
 * Used in the framework to load gina from the Super controller
 * 
 * NB.: this file is built appart
 *
 * Must be placed before gina <script> tag
 *
 * */

window['originalContext']   = window['jQuery'];
window['ginaToolbar']       = null;
window['onGinaLoaded']      = function(gina) {

    if (!gina) {
        //console.log('gina not ready yet');
        return false

    } else {
        if ( gina["isFrameworkLoaded"] ) {
            return true
        }

        var options = gina['config'] = {
            /**@js_externs bundle*/
            'bundle': '{{ page.environment.bundle }}',
            /**@js_externs env*/
            'env'     : '{{ page.environment.env }}',
            /**@js_externs envIsDev*/
            'envIsDev' : ( /^true$/.test('{{ page.environment.envIsDev }}') ) ? true : false,
            /**@js_externs hostname*/
            'hostname': '{{ page.environment.hostname }}',
            /**@js_externs routing*/
            'routing': JSON.parse(unescape('{{ page.environment.routing }}')),
            /**@js_externs reverseRouting*/
            'reverseRouting': JSON.parse(unescape('{{ page.environment.reverseRouting }}')),
            /**@js_externs forms*/
            //'forms': JSON.parse(unescape('{{ page.environment.forms }}')),
            /**@js_externs version*/
            version : '{{ page.environment.version }}',
            /**@js_externs webroot*/
            'webroot' : '{{ page.environment.webroot }}',
            /**@js_externs protocol*/
            'protocol' : '{{ page.environment.protocol }}'
        };

        
        /** 
         * getRouting
         * 
         * @param {string} [bundle]
         * 
         * @return {object} routing
        */        
        gina['config']['getRouting'] = function(bundle) {

            if ( typeof(bundle) == 'undefined' ) {
                return gina['config']['routing']
            }

            var routes      = {};
            var routing     = gina['config']['routing'];
            var re = new RegExp("\\@" + bundle + String.fromCharCode(36)); // Closure compiler requirements: $ -> String.fromCharCode(36)
            
            var route       = null;
            for (route in routing) {                
                if ( re.test(route) )
                   routes[route] = routing[route]
            }
            
            return (routes.count() > 0) ? routes : null
        };

        // globals
        window['GINA_ENV']              = '{{ GINA_ENV }}';
        window['GINA_ENV_IS_DEV']       = '{{ GINA_ENV_IS_DEV }}';

        gina["isFrameworkLoaded"]       = true;
        gina["setOptions"](options);
        
        try {
            gina["forms"]               = JSON.parse(unescape('{{ page.environment.forms }}'));
        } catch (err) {
            throw err
        }
        

        // making adding css to the head
        var link        = null, cssPath = "css/vendor/gina/gina.min.css";
        
        // check if css has not been added yet
        var links       = document.head.getElementsByTagName('link')
            , i         = 0
            , len       = links.length
            , found     = false
            , re        = new RegExp(cssPath)
        ;
        
        for (; i < len; ++i ) {
            if ( re.test(links[i].href) ) {
                found = true;
                break
            }
        }
        
        if (!found) { // add css           
            link            = document.createElement('link');
            link.href       = options['webroot'] + cssPath;
            link.media      = "screen";
            link.rel        = "stylesheet";
            link.type       = "text/css";
            
            document.getElementsByTagName('head')[0].appendChild(link);        
        }
    
        // all required must be listed in `src/gina.js` defined modules list
        if (options['envIsDev']) {
            var Toolbar             = require('gina/toolbar');
            window['ginaToolbar']   = new Toolbar();
        }

        return true
    }
}