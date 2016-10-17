// window['gina'] = {};
//
// (function(funcName, baseObj) {
//     "use strict";
//     // The public function name defaults to window.ready
//     // but you can modify the last line of this function to pass in a different object or method name
//     // if you want to put them in a different namespace and those will be used instead of
//     // window.ready(...)
//     funcName = funcName || "ready";
//     baseObj = baseObj || window['gina'];
//     var readyList = [];
//     var readyFired = false;
//     var readyEventHandlersInstalled = false;
//
//     // call this when the document is ready
//     // this function protects itself against being called more than once
//     function ready() {
//         if (!readyFired) {
//             // this must be set to true before we start calling callbacks
//             readyFired = true;
//             for (var i = 0; i < readyList.length; i++) {
//                 // if a callback here happens to add new ready handlers,
//                 // the ready() function will see that it already fired
//                 // and will schedule the callback to run right after
//                 // this event loop finishes so all handlers will still execute
//                 // in order and no new ones will be added to the readyList
//                 // while we are processing the list
//                 readyList[i].fn.call(window, readyList[i].ctx);
//             }
//             // allow any closures held by these functions to free
//             readyList = [];
//         }
//     }
//
//     function readyStateChange() {
//         if ( document.readyState === "complete" ) {
//             ready();
//         }
//     }
//
//     // This is the one public interface
//     // ready(fn, context);
//     // the context argument is optional - if present, it will be passed
//     // as an argument to the callback
//     baseObj[funcName] = function(callback, context) {
//         // if ready has already fired, then just schedule the callback
//         // to fire asynchronously, but right away
//         if (readyFired) {
//             setTimeout(function() {callback(context);}, 1);
//             return;
//         } else {
//             // add the function and context to the list
//             readyList.push({fn: callback, ctx: context});
//         }
//         // if document already ready to go, schedule the ready function to run
//         // IE only safe when readyState is "complete", others safe when readyState is "interactive"
//         if (document.readyState === "complete" || (!document.attachEvent && document.readyState === "interactive")) {
//             setTimeout(ready, 1);
//         } else if (!readyEventHandlersInstalled) {
//             // otherwise if we don't have event handlers installed, install them
//             if (document.addEventListener) {
//                 // first choice is DOMContentLoaded event
//                 document.addEventListener("DOMContentLoaded", ready, false);
//                 // backup is window load event
//                 window.addEventListener("load", ready, false);
//             } else {
//                 // must be IE
//                 document.attachEvent("onreadystatechange", readyStateChange);
//                 window.attachEvent("onload", ready);
//             }
//             readyEventHandlersInstalled = true;
//         }
//     }
// })("ready", window['gina']);
// // modify this previous line to pass in your own method name
// // and object for the method to be attached to

/**
 * Gina Frontend Framework
 *
 * Usage: var gina = require('gina');
 *
 * */
define('gina', [ 'require', 'core/main', 'gina/toolbar', 'gina/validator' ], function onCoreInit(require) {

    var core    = require('./core/main');

    function construct(core) {

        var element = document
            , evt   = null
            , name  = 'ginaready'
            , args  = core // returning core instance
        ;

        if (window.CustomEvent || document.createEvent) {

            if (window.CustomEvent) { // new method from ie9
                evt = new CustomEvent(name, {
                    'detail'    : args,
                    'bubbles'   : true,
                    'cancelable': true,
                    'target'    : element
                });

            } else { // before ie9

                evt = document.createEvent('HTMLEvents');

                evt['detail'] = args;
                evt['target'] = element;
                evt.initEvent(name, true, true);

                evt['eventName'] = name;

            }
            // trigger event
            element.dispatchEvent(evt);



        } else if (document.createEventObject) { // non standard
            evt = document.createEventObject();
            evt.srcElement.id = element.id;
            evt.detail = args;
            evt.target = element;
            element.fireEvent('on' + name, evt)
        }

        return args
    }


    return construct( core() )

});

// exposing packages
requirejs([
    "gina",
    "gina/validator",
    "gina/storage",
    "gina/toolbar",
    "gina/popin",
    "utils/merge",
    "utils/inherits",
    "utils/collection",
    "vendor/uuid",
    "jquery"
]);


// catching freelancer script load event
var tags = document.getElementsByTagName('script');

for (var t = 0, len = tags.length; t < len; ++t) {

    if ( /gina.min.js|gina.js/.test( tags[t].getAttribute('src') ) ) {

        tags[t]['onload'] = function onGinaLoaded(e) {

            if (document.addEventListener) {
                document.addEventListener("ginaready", function(event){
                    console.log('ready from gina');
                    window['gina'] = event.detail;
                })
            } else if (document.attachEvent) {
                document.attachEvent("ginaready", function(event){
                    window['gina'] = event.detail;
                })
            }
        }()
        break;
    }
}