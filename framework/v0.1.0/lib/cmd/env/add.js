var fs      = require('fs');
var console = lib.logger;
var scan    = require('../port/inc/scan.js');

/**
 * Add new environment for a given project
 *
 *
 * */
function Add(opt, cmd) {
    var self = {}, local = {};

    var init = function() {

        self.projects = require(_(GINA_HOMEDIR + '/projects.json'));
        self.bundles = [];

        var i = 3, envs = [];

        for (; i<process.argv.length; ++i) {
            if ( /^\@[a-z0-9_.]/.test(process.argv[i]) ) {
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
        var b, p
            , file      = _(self.projects[self.name].path + '/env.json')
            , ports     = require(_(GINA_HOMEDIR + '/ports.json'));


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
            self.bundles.push(b)
        }

        // to env.json file
        if ( !fs.existsSync(file) ) {
            lib.generator.createFileFromDataSync({}, file)
        }

        if ( typeof(self.bundles.length) == 'undefined' || self.bundles.length == 0) {
            try {
                addEnvToProject();
                console.log('environment'+((self.envs.length > 1) ? 's' : '')+' [ '+ self.envs.join(', ') +' ] created');
                process.exit(0);
            } catch (err) {
                console.error(err.stack||err.message);
                process.exit(1)
            }
        } else {
            // rollback infos
            self.envPath = _(self.projects[self.name].path + '/env.json');
            self.envData = require(self.envPath);
            self.portsPath = _(GINA_HOMEDIR + '/ports.json');
            self.portsData = require(self.portsPath);
            self.portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json');
            self.portsReverseData = require(self.portsReversePath);

            addEnvToBundles(0)
        }
    }


    /**
     * Adding envs to /project/root/env.json
     *
     * @param {string} file
     * */
    var addEnvToBundles = function(b) {
        if (b > self.bundles.length-1) {// done
            try {
                addEnvToProject();
                console.log('environment'+((self.envs.length > 1) ? 's' : '')+' [ '+ self.envs.join(', ') +' ] created');
                process.exit(0)
            } catch (err) {
                console.error(err.stack||err.message);
                process.exit(1)
            }
        }

        var options = {}, bundle = self.bundles[b];

        if ( /^[a-z0-9_.]/.test(bundle) ) {

            local.bundle = bundle;
            local.b = b;

            // find available port
            options = {
                ignore  : self.portsList,
                len   : self.envs.length
            };
            scan(options, function(err, ports){
                if (err) {
                    console.error(err.stack|err.message);
                    process.exit(1)
                }

                for (var p=0; p<ports.length; ++p) {
                    self.portsList.push(ports[p])
                }
                self.portsList.sort();
                self.ports = ports;

                try {
                    setPorts(local.bundle);
                } catch (err) {
                    rollback(err)
                }
            })

        } else {
            console.error('[ '+ bundle+' ] is not a valid bundle name')
            process.exit(1)
        }
    }

    var setPorts = function(bundle) {
        var portsPath = _(GINA_HOMEDIR + '/ports.json', true)
            , portsReversePath = _(GINA_HOMEDIR + '/ports.reverse.json', true)
            , envDataPath = _(self.projects[self.name].path + '/env.json', true);


        if ( typeof(require.cache[portsPath]) != 'undefined') {
            delete require.cache[portsPath]
        }
        if ( typeof(require.cache[portsReversePath]) != 'undefined') {
            delete require.cache[portsReversePath]
        }
        if ( typeof(require.cache[envDataPath]) != 'undefined') {
            delete require.cache[envDataPath]
        }

        var envData = require(envDataPath)
            , portsData = require(portsPath)
            , portsReverseData = require(portsReversePath);


        var e = 0
            , content = JSON.parse(JSON.stringify(envData))
            , ports = JSON.parse(JSON.stringify(portsData))
            , portsReverse = JSON.parse(JSON.stringify(portsReverseData))
            , patt
            , p
            , found = false;


        for (; e<self.envs.length; ++e) {
            if ( typeof(content[local.bundle]) == 'undefined' ) {
                content[local.bundle] = {}
            }
            if ( typeof(content[local.bundle][self.envs[e]]) == 'undefined' ) {
                content[local.bundle][self.envs[e]] = {
                    "host" : "127.0.0.1"
                }
            }

            patt = new RegExp('^'+local.bundle +'@'+ self.name +'/'+ self.envs[e] +'$');
            for (p in ports) {
                if ( patt.test(ports[p]) ) {
                    found = true;
                    break
                }
            }
            if ( typeof(ports[self.ports[e]] ) == 'undefined' && !found ) {
                ports[self.ports[e]] = local.bundle + '@' + self.name + '/' + self.envs[e]
            }

            if ( typeof(portsReverse[local.bundle + '@' + self.name]) == 'undefined') {
                portsReverse[local.bundle + '@' + self.name] = {}
            }


            if ( typeof(portsReverse[local.bundle + '@' + self.name][self.envs[e]]) == 'undefined') {
                portsReverse[local.bundle + '@' + self.name][self.envs[e]] = ''+ self.ports[e]
            }

        }


        try {
            lib.generator.createFileFromDataSync(content, envDataPath);
            self.envDataWrote = true;
            // save to ~/.gina/ports.json & ~/.gina/ports.reverse.json
            lib.generator.createFileFromDataSync(ports, portsPath);
            self.portsDataWrote = true;
            lib.generator.createFileFromDataSync(portsReverse, portsReversePath);
            self.portsReverseDataWrote = true;

            ++local.b;
            addEnvToBundles(local.b)
        } catch (err) {
            rollback(err)
        }
    }

    /**
     * Adding envs to ~/.gina/projects.json
     *
     * @param {array} envs
     * */
    var addEnvToProject = function() {
        var e = 0
            , modified = false
            , envs = self.envs
            , projects = JSON.parse(JSON.stringify(self.projects));
        // to ~/.gina/projects.json
        for (; e<envs.length; ++e) {
            if (projects[self.name].envs.indexOf(envs[e]) < 0 ) {
                modified = true;
                projects[self.name].envs.push(envs[e])
            }
        }
        //writing
        if (modified) {
            lib.generator.createFileFromDataSync(
                projects,
                _(GINA_HOMEDIR + '/projects.json')
            );
            self.projectDataWrote = true
        }
    }

    var rollback = function(err) {
        console.error('could not complete env registration: ', (err.stack||err.message));
        console.warn('rolling back...');

        var writeFiles = function() {
            //restore env.json
            if ( typeof(self.envDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.envData, self.envPath)
            }

            //restore ports.json
            if ( typeof(self.portsDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.portsData, self.portsPath)
            }

            //restore ports.reverse.json
            if ( typeof(self.portsReverseDataWrote) == 'undefined' ) {
                lib.generator.createFileFromDataSync(self.portsReverseData, self.portsReversePath)
            }

            process.exit(1)
        };

        writeFiles()
    };

    init()
};

module.exports = Add