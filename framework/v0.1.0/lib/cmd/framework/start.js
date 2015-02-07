'use strict';
var Start;

var help = require( getPath('gina') + '/utils/helper');
var child = require('child_process');
var lib = require( getPath('gina.lib') );


Start = function(opt){

    //Get services list.
    var list = require(GINA_HOMEDIR + '/list.json');
    var self = {
        opt : opt,
        cmd : 'framework:start',
        servicesList : list.services[opt.release]
    };

    var init = function(opt){
        self.opt = opt;
        var frameworkPath = getPath('framework');

//        setUpLogs( function(err){
//            if (err)
//
//        })


        var argv = process.argv.toArray();
        var i = argv.indexOf(self.cmd);
        var services = argv.slice(i+1);
        if ( services.length > 0) {//by hand.
            startSelectedServices(services)
        } else {
            startAllServices()
        }




        //Start services.
//        if ( !fs.existsSync(frameworkPath) ) {
//            client.write('gina: could not find version ' + version + '.\nFirst try:\n$ gina framework:install ' + version);
//            process.exit(1)
//        } else {

        //}
    };

    /**
     * Check is the service is a real one.
     *
     * */
    var isReal = function(service){
        return ( typeof(self.servicesList[service]) != 'undefined') ? true : false
    };

//    var isRunning = fucntion(service) {
//
//    };

    var startAllServices = function() {
        for (var service in self.servicesList) {
            if (self.servicesList[service] == 'framework') {
                //spawn cmd + service
                startService(service)
            }
        }
    };

    var startSelectedServices = function(services){

        //process.argv[i]
        for (var s=0; s < services.length; ++s) {
            startService(services[s])
        }
    };

    var startService = function(service) {
        if (isReal(service)) {
            var cmd = 'gina '+ self.cmd +' ';
            console.log('starting service: ', service)
        } else {
            console.log('gina: [ '+ service +' ] is not a real service.')
            //stops all.

        }
    }

    init(opt)
};

module.exports = Start