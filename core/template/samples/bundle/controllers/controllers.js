/**
 * {Bundle}Controller
 * */
var {Bundle}Controller;

//Imports.

{Bundle}Controller = function() {
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
        self.renderJSON({ status: 'ok', msg: 'hello world !' })
    }
};

module.exports = {Bundle}Controller