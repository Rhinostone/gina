var DeleteBundle;

//imports
var fs = require('fs');
var utils = getContext('geena.utils');
var GEENA_PATH = _( getPath('geena.core') );
var Config = require( _( GEENA_PATH + '/config') );
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

DeleteBundle = function(opt, project, env, bundle) {

    var self = this;
    var reserved = [ 'framework' ];
    self.task = 'delete';//important for later in config init

    var init = function(opt, project, env, bundle) {

        if ( reserved.indexOf(bundle) > -1 ) {
            console.log('[ '+bundle+' ] is a reserved name. Please, try something else.');
            process.exit(1)
        }
        self.root = getPath('root');
        self.opt = opt;

        self.project = project;
        self.projectData = require(project);
        self.env = env;

        //deleteBundle(bundle)
    }

    var deleteBundle = function(bundle) {
        //remove all files & infos

        //from logs
        //from tmp
        //from cache

        //in locals

        //in env.json

        //in project.json
    }

    var removeFromLogs = function(path) {

    }



    init(opt, project, env, bundle);
};

module.exports = DeleteBundle;