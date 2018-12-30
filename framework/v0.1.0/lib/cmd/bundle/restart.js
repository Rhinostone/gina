var fs          = require('fs');
var spawn       = require('child_process').spawn;

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Restart a given bundle or Restart all running bundles at once
 *
 * e.g.
 *  gina bundle:restart <bundle_name> @<project_name>
 *  gina bundle:restart @<project_name>
 *  gina bundle:restart --online
 *
 * */
function Restart(opt, cmd) {
    
};

module.exports = Restart