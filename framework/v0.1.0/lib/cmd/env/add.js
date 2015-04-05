var fs      = require('fs');

var console = lib.logger;
var scan    = require('./inc/scan.js');

/**
 * Add new environment for a given project
 *
 * To check if port is running
 *
 * 1) try with node to create a socket .. if exception is thrown => busy
 * 2) You have
 *  => on linux :
 *      $ lsof -i :80
 *  => on win32
 *      $ netstat -p
 * 3) netstat work on windows ... they say ...
 *  => $ netstat -ln | grep ':80 ' | grep 'LISTEN'
 *
 * */
function Add() {
    var self = {}, local = {};

    var init = function() {

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));

        var i = 3, envs = [];

        for (; i<process.argv.length; ++i) {
            if ( /^\@[a-z0-9_.]/.test(process.argv[i]) ) {
                self.bundle = process.argv[i].split('@')[0] || null;

                if ( !isValidName(process.argv[i]) ) {
                    console.error('[ '+process.argv[i]+' ] is not a valid project name. Please, try something else: @[a-z0-9_.].');
                    process.exit(1);
                }

            } else if (/^[a-z0-9_.]/.test(process.argv[i])) {
                envs.push(process.argv[i])
            }
        }

        if ( typeof(self.name) == 'undefined') {
            var folder = new _(process.cwd()).toArray().last();
            if ( isDefined(folder) ) {
                self.name = folder
            }
        }


        if ( isDefined(self.name) && envs.length > 0) {
            self.envs = envs;
            saveEnvs()
        } else {
            //console.error('[ '+ self.name+' ] is not an existing project');
            console.error('Missing argument @<project_name>');
            process.exit(1)
        }
    }

    this.setParameters = function(params){
        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));
    }

    var isDefined = function(name) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            return true
        }
        return false
    }

    var isValidName = function(name) {
        if (name == undefined) return false;

        self.name = name.replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self.name)
    }


    var saveEnvs = function() {
        var conf      = {}
            , envs      = self.envs
            , b, p
            , bundles   = []
            , modified  = false
            , file      = _(self.projects[self.name].path + '/env.json')
            , ports     = require(_(GINA_HOMEDIR + '/ports.json'))
            ;


        if ( !fs.existsSync( _(self.projects[self.name].path + '/project.json') )) {
            console.error('project corrupted');
            process.exit(1)
        }

        self.project = require(_(self.projects[self.name].path + '/project.json'));
        self.portsList = [];
        for (p in ports) {
            self.portsList.push(p)
        }
        for (b in self.project.bundles) {
            bundles.push(self.project.bundles[b])
        }

        // to env.json file
        if ( !fs.existsSync(file) ) {
            lib.generator.createFileFromDataSync({}, file)
        }

        conf = require(_(self.projects[self.name].path + '/project.json')).bundles;

        if ( self.bundle && conf.count() > 0 ) {
            setPorts(conf, bundles, modified, function(err, modified){

                if (modified) addEnvToBundle(conf, file)
            }, 0, 0)
        } else { // else means that no bundle found yet ... that's ok !
            addEnvToProject()
        }
        //for (bundle in conf) {
        //    for (; e<envs.length; ++e) {
        //        if ( typeof(conf[bundle][envs[e]]) == 'undefined' ) {
        //            modified = true;
        //            conf[bundle][envs[e]] = {
        //                "host": "127.0.0.1", // || -h={host}
        //                "port": {
        //                    "http": 3130 //Replace by getAvailabePort() || -p={port} => getAvailabePort(port)
        //                }
        //            }
        //        } // ignore silently if env already exists
        //    }
        //    //writing
        //    if (modified) addEnvToBundle(conf, file)
        //}

    }

    /**
     * Get available port - Will scan until a free one is found
     *
     * @return {integer} port
     * */
    var setPorts = function (conf, bundles, modified, cb, b, e) {

        local.this = {
            conf        : conf,
            bundles     : bundles,
            modified    : modified,
            cb          : cb,
            b           : b,
            e           : e,
            bundle      : bundles[b],
            len         : conf.count()
        };

        var len = local.this.len;

        if (e > len-1) { // exit
            delete local.this;
            cb(false, modified)
        } else {

            //for(; e < bundles.length; ++e) {
            //
            //}
            scan({ignore: self.portsList}, function(err, port){
                var l = local.this;
                if (err) {
                    l.cb(err)
                } else {

                    //l.modified = true;
                    l.conf[l.bundle[l.b]][envs[l.e]] = {
                        "host": "127.0.0.1", // || -h={host}
                        "port": {
                            "http": port
                        }
                    };
                    ++l.e;
                    setPorts(l.conf, l.bundles, l.modified, l.cb, l.b, l.e)
                }

            })
        }
    }



    /**
     * Adding envs to /project/root/env.json
     *
     * @param {string} file
     * */
    var addEnvToBundle = function(conf, file) {
        lib.generator.createFileFromDataSync(
            conf,
            file
        )
    }

    /**
     * Adding envs to ~/.gina/projects.json
     *
     * @param {array} envs
     * */
    var addEnvToProject = function() {
        var e = 0
            , modified = false
            , envs = self.envs;
        // to ~/.gina/projects.json
        for (; e<envs.length; ++e) {
            if (self.projects[self.name].envs.indexOf(envs[e]) < 0 ) {
                modified = true;
                self.projects[self.name].envs.push(envs[e])
            }
        }
        //writing
        if (modified) {
            lib.generator.createFileFromDataSync(
                self.projects,
                _(GINA_HOMEDIR + '/projects.json')
            )
            return true
        }
        return false
    };

    var end = function(envs, created) {

        if (created)
            console.log('environment'+((envs.length > 1) ? 's' : '')+' [ '+ envs.join(', ') +' ] created');

        process.exit(0)
    }

    init()
};

module.exports = Add