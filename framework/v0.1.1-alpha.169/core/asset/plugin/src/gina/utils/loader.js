"use strict";
/**
 * onGinaLoaded
 *
 * Used in the framework to load gina from the Super controller
 *
 * NB.:
 *  - this file is built appart
 *  - on change, you have to restart the bundle
 *
 * Must be placed before gina <script> tag
 *
 * Instructions for closure compiler: https://github.com/google/closure-compiler/wiki/@suppress-annotations
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
         * @returns {Object} routing
         *
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

            return (routes['count']() > 0) ? routes : null
        };

        // globals
        window['GINA_ENV']              = '{{ GINA_ENV }}';
        window['GINA_ENV_IS_DEV']       = /^true$/i.test('{{ GINA_ENV_IS_DEV }}') ? true: false;
        if (
            typeof(location.search) != 'undefined' && /debug\=/i.test(location.search)
            ||
            !location.search && /\?/.test(location.href)
        ) {
            // deep copy
            var search = (' ' + location.search).slice(1);
            if (!search && /\?/.test(location.href) ) {
                search = location.href.match(/\?.*/);
                if (Array.isArray(search) && search.length > 0) {
                    search = search[0]
                }
            }
            var matched = search.match(/debug=(true|false)/);
            if (matched)
                window['GINA_ENV_IS_DEV'] = gina['config']['envIsDev'] = ( /^true$/i.test(matched[0].split(/\=/)[1]) ) ? true: false;
        }

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
        if ( /^true$/i.test(options['envIsDev']) ) {
            var Toolbar             = window['require']('gina/toolbar');
            window['ginaToolbar']   = new Toolbar();
        }

        return true
    }
}