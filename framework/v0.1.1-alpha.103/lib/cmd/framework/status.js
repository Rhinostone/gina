var fs          = require('fs');
const {spawn}       = require('child_process');
const {execSync}    = require('child_process');
//const { debug } = require('console');

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Framework status
 *
 * e.g.
 *  gina framework:status
 *  or
 *  gina status
 *
 * */
function Status(opt, cmd) {
    var self    = {};


    var init = function(opt, cmd) {

        console.debug('Getting framework status');

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        status(opt, cmd);
    }

    var status = function(opt, cmd) {
        var pidFiles = null;
        try {
            pidFiles = fs.readdirSync(GINA_RUNDIR);
        } catch (fileError) {
            throw fileError
        }

        var runningVersions = [];
        for (let i=0, len=pidFiles.length; i<len; i++) {
            let file = pidFiles[i];
            if ( !/^gina\-/.test(file) ) {
                continue;
            }
            let pid = fs.readFileSync(_(GINA_RUNDIR +'/'+ file)).toString().trim() || null;
            runningVersions.push({
                title   : file.replace(/\.pid$/, ''),
                pid     : ~~pid
            });
        }

        if ( runningVersions.length > 0 ) {
            console.log('Gina is running');
            return
        }

        console.log('Gina is not running');
    }


    init(opt, cmd)
}

module.exports = Status;