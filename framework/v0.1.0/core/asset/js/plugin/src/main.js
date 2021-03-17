/**
 * Gina Frontend Framework
 *
 * Usage:
 *  By adding gina tag in the end of the DOM ( just before </body>)
 *
 *      <script type="text/javascript" src="/js/vendor/gina/gina.min.js"></script>
 *
 *  You can add or edit config options through the `data-gina-config`
 *      <script type="text/javascript" src="/js/vendor/gina/gina.min.js" data-gina-config="{ env: 'dev', envIsDev: true, webroot: '/' }"></script>
 *
 *  Through RequireJS
 *
 *      var gina = require('gina');
 *
 *  Useful Globals
 *
 *  window['originalContext']
 *      You have to passe your `jQuery` or your `DollarDom` context to Gina
 *      e.g.: 
 *          window['originalContext'] = window['jQuery']
 *      
 *      This can be achieved by overriding `window['originalContext']` before defining your handler
 *       Default value will be jQuery
 *
 * */

//var wContext = ( typeof(window.onGinaLoaded) == 'undefined') ? window : parent.window; // iframe case
var readyList = [ { name: 'gina', ctx: window['gina'], fn: window.onGinaLoaded } ];
var readyFired = false;
var readyEventHandlersInstalled = false;

// call this when the document is ready
// this function protects itself against being called more than once
function ready() {

    if (!readyFired) {

        // this must be set to true before we start calling callbacks
        readyFired = true;
        var result = null;
        var i = i || 0;

        var handleEvent = function (i, readyList) {

            if ( readyList[i] ) {

                if (readyList[i].name == 'gina') {

                    var scheduler = window.setInterval(function (i, readyList) {
                        try {
                            if ( typeof(readyList) == 'undefined' ) {
                                // Fixing init bug in chrome
                                readyList = window.readyList;
                            }                            
                            readyList[i].ctx = window.gina;
                            result = readyList[i].fn.call(window, readyList[i].ctx, window.require);

                            // clear
                            if (result) {
                                window.clearInterval(scheduler);
                                ++i;
                                handleEvent(i, readyList);
                            }
                        } catch (err) {
                            window.clearInterval(scheduler);
                            throw err;
                        }

                    }, 50, i, readyList);


                } else { // onEachHandlerReady
                    // iframe case
                    if ( !window.$ && typeof(parent.window.$) != 'undefined' ) {
                        window.$ = parent.window.$;
                    }
                    // by default, but can be overriden in your handler (before the handler definition)
                    if ( typeof(window.originalContext) == 'undefined' && typeof(window.$) != 'undefined' ) {
                        window.originalContext = window.$
                    }
                    readyList[i].ctx = window.originalContext || $;// passes the user's orignalContext by default; if no orignalContext is set will try users'jQuery
                    readyList[i].fn.call(window, readyList[i].ctx, window.require);
                    ++i;
                    handleEvent(i, readyList);
                }

            } else { // end
                // allow any closures held by these functions to free
                readyList = [];
            }
        }

        handleEvent(i, readyList);
    }
}

function readyStateChange() {
    if ( document.readyState === 'complete' ) {        
        gina.ready();
    }
}


if ( typeof(window['gina']) == 'undefined' ) {// could have be defined by loader

    var gina = {
        /**
         * ready
         * This is the one public interface use to wrap `handlers`
         * It is an equivalent of jQuery(document).ready(cb)
         *
         * No need to use it for `handlers`, it is automatically applied for each `handler`
         *
         * @callback {callback} callback
         * @param {object} [context] - if present, it will be passed
         * */
        /**@js_externs ready*/
        ready: function(callback, context) {


            // if ready has already fired, then just schedule the callback
            // to fire asynchronously, but right away
            if (readyFired) {
                setTimeout(function() {callback(context);}, 1);
                return;
            } else {
                // add the function and context to the list
                readyList.push({ name: 'anonymous', fn: callback, ctx: context });
            }

            // if document already ready to go, schedule the ready function to run
            // IE only safe when readyState is "complete", others safe when readyState is "interactive"
            if (document.readyState === "complete" || (!document.attachEvent && document.readyState === "interactive")) {
                setTimeout(ready, 1);
            } else if (!readyEventHandlersInstalled) {
                // otherwise if we don't have event handlers installed, install them
                if (document.addEventListener) {
                    // first choice is DOMContentLoaded event
                    document.addEventListener("DOMContentLoaded", ready, false);
                    // backup is window load event
                    window.addEventListener("load", ready, false);
                } else {
                    // must be IE
                    document.attachEvent("onreadystatechange", readyStateChange);
                    window.attachEvent("onload", ready);
                }
                readyEventHandlersInstalled = true;
            }

        }
    };

    window['gina'] = gina;
}


define('core', ['require', 'gina'], function (require) {
    require('gina')(window['gina']); // passing core required lib through parameters
});


require.config({
    "packages": ["gina"]
});

// exporting
require([
    //vendors
    "vendor/uuid",
    "vendor/engine.io",

    "core",
    // helpers
    "helpers/prototypes",
    "helpers/binding",
    "helpers/dateFormat",

    // plugins
    "gina/link",
    "gina/validator",
    "gina/popin",
    "gina/storage",

    // utils
    "utils/dom",
    "utils/events",
    "utils/effects",
    "utils/inherits",
    //"utils/merge",
    "utils/form-validator",
    "utils/collection",
    "utils/routing"
]);


// catching freelancer script load event
var tags = document.getElementsByTagName('script');

for (var t = 0, len = tags.length; t < len; ++t) {

    if ( /gina.min.js|gina.js/.test( tags[t].getAttribute('src') ) ) {

        tags[t]['onload'] = function onGinaLoaded(e) {
            // TODO - get the version number from the response ?? console.log('tag ', tags[t].getAttribute('data-gina-config'));
            // var req = new XMLHttpRequest();
            // req.open('GET', document.location, false);
            // req.send(null);
            // var version = req.getAllResponseHeaders().match(/X-Powered-By:(.*)/)[0].replace('X-Powered-By: ', '');
            if (window['onGinaLoaded']) {
                var onGinaLoaded = window['onGinaLoaded']
            } else {
                function onGinaLoaded(gina) {

                    if (!gina) {
                        return false
                    } else {
                        if ( gina["isFrameworkLoaded"] ) {
                            return true
                        }

                        var options = gina['config'] = {
                            /**@js_externs env*/
                            //env     : '{{ page.environment.env }}',
                            /**@js_externs envIsDev*/
                            envIsDev : ( /^true$/.test('{{ page.environment.envIsDev }}') ) ? true : false,
                            /**@js_externs version*/
                            //version : '{{ page.environment.version }}',
                            /**@js_externs webroot*/
                            'webroot' : '{{ page.environment.webroot }}',
                        };

                       
                        // globals
                        window['GINA_ENV']          = '{{ GINA_ENV }}';
                        window['GINA_ENV_IS_DEV']   = /true/i.test('{{ GINA_ENV_IS_DEV }}') ? true : false;
                        if ( typeof(location.search) != 'undefined' && /debug\=/i.test(window.location.search) ) {
                            window['GINA_ENV_IS_DEV'] = gina['config']['envIsDev'] = options['envIsDev'] = /true/i.test(window.location.search.match(/debug=(true|false)/)[0].split(/\=/)[1]) ? true: false;  
                        }

                        gina["setOptions"](options);
                        gina["isFrameworkLoaded"]       = true;

                        // making adding css to the head
                        var link    = null;
                        link        = document.createElement('link');
                        link.href   = options.webroot + "css/vendor/gina/gina.min.css";
                        link.media  = "screen";
                        link.rel    = "stylesheet";
                        link.type   = "text/css";
                        document.getElementsByTagName('head')[0].appendChild(link);

                        return true
                    }
                }
            }


            if (document.addEventListener) {
                document.addEventListener("ginaloaded", function(event){
                    //console.log('Gina Framework is ready !');
                    window['gina'] = event.detail;
                    onGinaLoaded(event.detail)
                })
            } else if (document.attachEvent) {
                document.attachEvent("ginaloaded", function(event){
                    window['gina'] = event.detail;
                    onGinaLoaded(event.detail)
                })
            }
        }()
        break;
    }
}