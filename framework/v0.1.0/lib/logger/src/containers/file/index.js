'use strict';
// Imports
var fs                  = require('fs');
var util                = require('util');
var promisify           = util.promisify;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { execSync }      = require('child_process');

var merge = require('../../merge');

function FileContainer(opt) {
    var init = function() {
        // /usr/local/var/log/gina/{bundle}.log
    };
    init(opt);
}
module.exports = FileContainer;