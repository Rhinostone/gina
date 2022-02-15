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
        //console.info('Framework ready for connections');
        console.notice('Framework ready for connections\n');

        //var frameworkPath = getPath('framework');

    };

    var cleanPIDs = function() {
        var f = 0
            , path = _(GINA_RUNDIR + '/gina')
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
                if (files[f] != self.pid) {
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

    /**
     * Check is the service is a real one.
     *
     * */
    // var isReal = function(bundle){
    //     return ( typeof(self.bundles[bundle]) != 'undefined') ? true : false
    // };


    // var startAllServices = function() {
    //     for (var service in self.servicesList) {
    //         if (self.servicesList[service] == 'framework') {
    //             //spawn cmd + service
    //             startService(service)
    //         }
    //     }
    // };

    // var startSelectedServices = function(services){

    //     //process.argv[i]
    //     for (var s=0; s < services.length; ++s) {
    //         startService(services[s])
    //     }
    // };

    // var startService = function(service) {
    //     if (isReal(service)) {
    //         var cmd = 'gina '+ self.cmd +' ';
    //         console.log('starting service: ', service)
    //     } else {
    //         console.log('gina: [ '+ service +' ] is not a real service.')
    //         //stops all.

    //     }
    // }

    init(opt)
};

module.exports = Start