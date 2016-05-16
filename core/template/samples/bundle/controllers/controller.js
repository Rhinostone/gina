//Imports goes here.

/**
 * {Bundle}Controller
 * */
function {Bundle}Controller() {
    var self = this;

    /**
     * Init default action
     *
     * @param {object} req
     * @param {object} res
     * @param {object} [next]
     * */
    this.init = function(req, res) {
        console.log('got init action');
        self.renderJSON({ status: '200', msg: 'hello world !' })
    }

    // The onReady Event is called when the controller is loaded
    // You can use this to define, overwrite and customise controller methods & even swig filters
    //this.onReady = function(req, res, next){
    //    // e.g: Define a setup function that you call when the controller is ready
    //    //setup(req, res, next)
    //}
};

module.exports = {Bundle}Controller