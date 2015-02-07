var fs = require('fs');
var console = lib.logger;

/**
 * Add new project or register old one to `~/.gina/projects.json`.
 * NB.: If project exists, it won't be replaced. You'll only get warnings.
 * */
function Help() {
    var self = {};

    var init = function() {
        try {
            console.log( '\n' + fs.readFileSync(__dirname + '/help.txt') )
        } catch(err) {
            console.log('No help available for now. Please retry on the nex release')
        }
    }

    init()
};

module.exports = Help