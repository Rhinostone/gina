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
// var readyList = [ { name: 'gina', ctx: window['gina'], fn: onGinaLoaded } ];
// var readyFired = false;
// var readyEventHandlersInstalled = false;

//console.log('which jquery ? ', window['jQuery']['fn']['jquery']);
window['originalContext'] = window['jQuery'];


// var readyList = [];
// var readyFired = false;
// var readyEventHandlersInstalled = false;
//
// // call this when the document is ready
// // this function protects itself against being called more than once
// function ready() {
//     if (!readyFired) {
//         // this must be set to true before we start calling callbacks
//         readyFired = true;
//         for (var i = 0; i < readyList.length; i++) {
//             // if a callback here happens to add new ready handlers,
//             // the ready() function will see that it already fired
//             // and will schedule the callback to run right after
//             // this event loop finishes so all handlers will still execute
//             // in order and no new ones will be added to the readyList
//             // while we are processing the list
//
//             readyList[i].fn.call(window, readyList[i].ctx);
//         }
//         // allow any closures held by these functions to free
//         readyList = [];
//     }
// }
//
// function readyStateChange() {
//     if ( document.readyState === "complete" ) {
//         gina.ready();
//     }
// }

// call this when the document is ready
// this function protects itself against being called more than once
// function ready() {
//
//     if (!readyFired) {
//
//         // this must be set to true before we start calling callbacks
//         readyFired = true;
//         var result = null;
//         var i = i || 0;
//
//         var procceed = function (i, readyList) {
//
//             if ( readyList[i] ) {
//
//                 if (readyList[i].name == 'gina') {
//
//                     var scheduler = window.setInterval(function (i, readyList) {
//                         try {
//
//                             readyList[i].ctx = window['gina'];
//                             result = readyList[i].fn.call(window, readyList[i].ctx);
//
//                             // clear
//                             if (result) {
//                                 window.clearInterval(scheduler);
//                                 ++i;
//                                 procceed(i, readyList)
//                             }
//                         } catch (err) {
//                             window.clearInterval(scheduler);
//                             throw err
//                         }
//
//                     }, 10, i, readyList);
//
//
//                 } else {
//                     readyList[i].fn.call(window, readyList[i].ctx);
//                     ++i;
//                     procceed(i, readyList)
//                 }
//
//             } else { // end
//                 // allow any closures held by these functions to free
//                 readyList = [];
//             }
//         }
//
//         procceed(i, readyList)
//     }
// }
//
// function readyStateChange() {
//     if ( document.readyState === 'complete' ) {
//         gina.ready();
//     }
// }

var ginaFormValidator = null;
var ginaToolbar = null;
window['onGinaLoaded'] = function(gina) {

    if (!gina) {
        console.log('gina not ready yet');
        return false
    } else if ( !gina["isFrameworkLoaded"] ) {

        var options = gina.options = {
            /**@js_externs env*/
            env     : '{{ page.environment.env }}',
            /**@js_externs version*/
            version : '{{ page.environment.version }}',
            /**@js_externs webroot*/
            webroot : '{{ page.environment.webroot }}'
        };

        gina["isFrameworkLoaded"]       = true;
        gina["setOptions"](options);
        var ginaPageForms               = JSON.parse('{{ JSON.stringify(page.forms) }}');

        // making adding css to the head
        var link        = null;
        link            = document.createElement('link');
        link.href       = options.webroot + "js/vendor/gina/gina.min.css";
        link.media      = "screen";
        link.rel        = "stylesheet";
        link.type       = "text/css";
        document.getElementsByTagName('head')[0].appendChild(link);

        // all required must be listed in `src/gina.js` defined modules list
        // load Form Validator
        var Validator   = require('gina/validator');
        ginaFormValidator               = new Validator(ginaPageForms.rules);
        window['ginaFormValidator']     = ginaFormValidator;

        if (options.env == 'dev') {
            var Toolbar     = require('gina/toolbar');
            ginaToolbar     = new Toolbar();
        }

        return true
    }
}