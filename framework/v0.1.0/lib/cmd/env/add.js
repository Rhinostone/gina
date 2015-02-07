var console = lib.logger;
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
    var self = {};

    var init = function() {

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));

        var i = 3
            , envs = [];

        for (; i<process.argv.length; ++i) {
            if ( /^\@[a-z0-9_.]/.test(process.argv[i]) ) {
                self.name = process.argv[i];
                isValidName()
            } else if (/^[a-z0-9_.]/.test(process.argv[i])) {
                envs.push(process.argv[i])
            }
        }


        if ( isDefined(self.name) ) {
            saveEnvs(envs)
        }




        //if ( typeof(process.argv[3]) != 'undefined' ) {
        //    if ( !self.main.envs[GINA_RELEASE].inArray(process.argv[3]) ) {
        //        addEnv(process.argv[3])
        //    } else {
        //        console.warn('Environment [ '+process.argv[3]+' ] already exists')
        //    }
        //} else {
        //    console.error('Missing argument in [ gina env:add <environment> ]')
        //}
    }

    var isDefined = function(name) {
        if ( typeof(self.projects[name]) != 'undefined' ) {
            console.error('[ '+ name +' ] is an existing project. Please choose another name or remove it first.');
            process.exit(1)
        }
    }

    var isValidName = function() {
        if (self.name == undefined) return false;

        self.name = self.name.replace(/\@/, '');
        var patt = /^[a-z0-9_.]/;
        return patt.test(self.name)
    }

    var saveEnvs = function(envs) {
        var e           = 0
            , conf      = {}
            , file      = _(self.projects[self.name].path + '/env.json')
            , template  = _(GINA_DIR + '/ressources/template/env.json')
            , ports     = require(_(GINA_HOMEDIR + '/ports.json'));

        if ( fs.existsSync(file) ) {
            conf = require(file);
            //writing

        }

        for (; e<envs.length; ++e) {

        }
    }

    var addEnv = function(env) {
        self.main['envs'][GINA_RELEASE].push(env);
        lib.generator.createFileFromDataSync(
            self.main,
            self.target
        )
    };

    init()
};

module.exports = Add