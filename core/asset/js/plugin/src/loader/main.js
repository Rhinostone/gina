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
//var ginaFormValidator = null, ginaToolbar = null, ginaStorage = null;
function onGinaLoaded(gina) {

    var options = {
        "env"     : "{{ page.environment.env }}",
        "version" : "{{ page.environment.version }}",
        "webroot" : "{{ page.environment.webroot }}"
    };

    gina["setOptions"](options);
    gina["isFrameworkLoaded"]  = true;

    //ginaStorage             = new gina.Storage({bucket: "gina"});
    //ginaToolbar             = new Toolbar();
    //var ginaPageForms           = JSON.parse(\'{{ JSON.stringify(page.forms) }}\');
    //ginaFormValidator           = new gina.Validator(ginaPageForms.rules);
    //window.ginaFormValidator    = ginaFormValidator;
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