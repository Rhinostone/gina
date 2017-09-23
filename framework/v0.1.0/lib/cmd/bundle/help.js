var fs          = require('fs');

var CmdHelper   = require('./../helper');
var console     = lib.logger;

/**
 * Help
 *
 * */
function Help() {
    var self = {};

    var init = function() {

        // import CMD helpers
        new CmdHelper(self);

        // configure
        configure();


        getHelp()
    }

    init()
};

module.exports = Help