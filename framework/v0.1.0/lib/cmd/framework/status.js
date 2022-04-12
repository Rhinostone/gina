const { debug } = require('console');
var fs          = require('fs');
const spawn       = require('child_process');
const execSync    = require('child_process');

// var help    = require( getPath('gina').root + '/utils/helper');
// var lib     = require( getPath('gina').lib );
//var helpers     = require( getPath('gina').helpers );

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Framework status
 *
 * e.g.
 *  gina framework:status
 *  
 *
 * */
function Status(opt, cmd) {
    var self    = {};
    

    var init = function(opt, cmd) {
        
        console.debug('Getting framework status');
        
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
                        
        // check CMD configuration
        //if (!isCmdConfigured()) return false;
        
        
        // if (!self.name) {
        //     status(opt, cmd, 0);
        // } else {
            status(opt, cmd);
        // }        
    }
    
    var status = function(opt, cmd) {
        var pidFiles = fs.readdirSync(GINA_RUNDIR);
        var runningVersions = [];
        for (let i=0, len=pidFiles.length; i<len; i++) {
            let file = pidFiles[i];
            if ( !/^gina/.test(file) ) {
                continue;
            }
            runningVersions.push({
                title   : file.replace(/\.pid$/, ''),
                pid     : fs.readFileSync(_(GINA_RUNDIR +'/'+ file)).toString().trim()
                // TODO - Add the running version
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