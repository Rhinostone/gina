var DeployInit;

var Deploy = require('./geena-deploy');
//var inherits = require('../inherits');



DeployInit = function(opt) {

    var self = this;

    this.init = function() {
        if (self.initialized == undefined) {
            self.initialized = true;
            console.log('init once !!');
        }
        //return self
    }


};

module.exports = DeployInit