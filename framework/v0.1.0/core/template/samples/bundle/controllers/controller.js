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
        self.renderJSON({ status: 'ok', msg: 'hello world !' })
    }
};

module.exports = {Bundle}Controller