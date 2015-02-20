var fs          = require('fs');
var readline    = require('readline');
var rl          = readline.createInterface(process.stdin, process.stdout);

var console = lib.logger;
var scan    = require('../env/inc/scan');

/**
 * Add new bundle to a given project.
 * NB.: If bundle exists, it won't be replaced. You'll only get warnings.
 * */
function Remove() {
    var self = {};

    var init = function() {

    }

    var isDefined = function(name, value) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            return true
        }
        return false
    }

    var isValidName = function(name, value) {
        self[name] = value;
        if (self[name] == undefined) return false;

        self[name] = self[name].replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self[name])
    }

    init()
};

module.exports = Remove