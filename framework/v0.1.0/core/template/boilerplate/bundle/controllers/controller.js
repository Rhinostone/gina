//Imports goes here.

/**
 * {Bundle}Controller
 * This controller is inherited by all the namespace controllers.
 * This means that all public methods written here are reusable by the other controllers
 * without calling `require` in case you decide to add a namespace.
 * It is strongly advised to use namespaces to organize you code :
 * E.g.:
 *      gina namespace:add {bundle}/blogpost @{project}
 * */
function {Bundle}Controller() {
    var self = this;
    // get config/app.json content
    var appConf = this.getConfig('app');

    /**
     * Home action
     *
     * @param {object} req
     * @param {object} res
     * @callback [next]
     * */
    this.home = function(req, res) {
        var data = {
            msg: appConf.greeting
        };
        
        self.renderJSON(data);

        // use this to render errors
        // self.throwError( new Error('Error sample') );
    }

    // The onReady Event is called when the controller is loaded
    // You can use this to define, overwrite and customise default controller methods & even swig filters
    //this.onReady = function(req, res, next){
    //    // e.g: Define a setup function that you call when the controller is ready
    //    //setup(req, res, next)
    //    // Or better, you can just complete and reuse the `setup.js` and call self.setup(req, res, next)
    //}
};

module.exports = {Bundle}Controller