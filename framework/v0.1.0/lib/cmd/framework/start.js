'use strict';
var fs      = require('fs');
var help    = require( getPath('gina').root + '/utils/helper');
// var child   = require('child_process');
var lib     = require( getPath('gina').lib );
//var helpers     = require( getPath('gina').helpers );
var console = lib.logger;
/**
 * Framework start command - Needs to be launched as [sudo], [admin] or [root]
 *
 * NB.: Another alternative is to set appropriate permissions for `/var/run/gina`
 * e.g. if you have a `gina` user in the `www-data` group
 *  $ sudo mkdir /var/run/gina
 *  $ sudo chown -R gina:www-data /var/run/gina
 *
 * @param {object} opt - Constructor options
 * */
function Start(opt){

    //Get services list.
    var self = {};

    var console = lib.logger;

    //var self = {
    //    opt : opt,
    //    cmd : 'framework:start',
    //    servicesList : list.services[opt.release]
    //};

    var init = function(opt){
        
        
        self.pid        = opt.pid;
        setEnvVar('GINA_PID', opt.pid);
        self.projects   = require(GINA_HOMEDIR + '/projects.json');
        self.services   = [];
        self.bundles    = [];

        cleanPIDs();
        console.notice('Framework ready for connections\n');

    };

    var cleanPIDs = function() {
        var f = 0
            , path = _(GINA_RUNDIR)
            , files = null
        ;

        if ( fs.existsSync( path ) ) {
            try {

                files = fs.readdirSync( path );

            } catch (err) {

                //if (err.stack)
                //    err.stack = 'Possible write privilege exception: grant access to your user or run the command as sudo/admin\n'+ err.stack;

                console.crit(err.stack||err.message);
                process.exit(1);
            }


            for (;f < files.length; ++f) {
                
                // skip all but framework pid files
                if ( files[f] != process.title +'.pid' ) {
                    continue;
                }
                
                let filePid = null;
                try {
                    filePid = fs.readFileSync(_(path +'/'+ files[f], true)).toString().trim();
                } catch(fileErr) {
                    fs.unlinkSync(_(path +'/'+ files[f], true));
                    continue;
                }
                // remove old framework pid files
                if (filePid && filePid != self.pid) {
                    try {
                        new _(path +'/'+ files[f]).rmSync()
                    } catch(err) {
                        console.error(err.stack||err.message);
                        process.exit(1);
                    }
                }
            }
        }
    }

    init(opt)
}

module.exports = Start;