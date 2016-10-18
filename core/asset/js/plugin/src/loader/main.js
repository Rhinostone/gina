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
var ginaFormValidator = null;
var ginaToolbar = null;
function onGinaLoaded(gina) {

    var options = {
        /**@js_externs env*/
        env     : '{{ page.environment.env }}',
        /**@js_externs version*/
        version : '{{ page.environment.version }}',
        /**@js_externs webroot*/
        webroot : '{{ page.environment.webroot }}'
    };

    gina["setOptions"](options);
    gina["isFrameworkLoaded"]       = true;
    var ginaPageForms               = JSON.parse('{{ JSON.stringify(page.forms) }}');

    // all required must be listed in `src/gina.js` defined modules list
    var Validator   = require('gina/validator');
    ginaFormValidator               = new Validator(ginaPageForms.rules);
    window['ginaFormValidator']     = ginaFormValidator;

    // making adding css to the head
    var link    = null;
    link        = document.createElement('link');
    link.href   = "/js/vendor/gina/gina.min.css";
    link.media  = "screen";
    link.rel    = "stylesheet";
    link.type   = "text/css";
    document.getElementsByTagName('head')[0].appendChild(link);

    if (options.env == 'dev') {
        var Toolbar     = require('gina/toolbar');
        ginaToolbar     = new Toolbar();
    }
}

if (document.addEventListener) {
    document.addEventListener("ginaready", function(event){
        onGinaLoaded(event.detail)
    })
} else if (document.attachEvent) {
    document.attachEvent("ginaready", function(event){
        onGinaLoaded(event.detail)
    })
}