var fs          = require('fs');
var console     = lib.logger;
var merge       = lib.merge;

/**
 * CmdHelper
 *
 * @package     gina.lib.cmd
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */
function CmdHelper(cmd, client) {
    
    var conf = {
        main: null,
        settings: null,
        ports: null, // ports & protocols
        reversePorts: null,
        projects: null
    };

    // cmd properties list
    var self = {
        task: null,
        // framework main config {object}
        mainConfig : null,
        // framework main config path {string}
        mainConfigPath : null,
        // CMD params list ( starting with --) {object}
        params : {}, //
        nodeParams : [],
        // project name {string}
        projectName : null, // defined by filterArgs()
        projectLocation: null,
        projectArgvList: [],
        // global projects collection {collection}
        projects : null, // defined by filterArgs()
        // current project path
        projectPath : null, // local project/project.json - defined by filterArgs()
        projectConfigPath: null, // path to .gina/project.json 
        projectData: {},
        // current project bundles list {array}
        bundles : [], // defined by filterArgs()
        // don't use this collection to store into files
        bundlesByProject: {}, // bundles collection will be loaded into cmd.projects[$project].bundles
        bundlesLocation : null,
        
        // current project env.json path
        envPath : null, // path to env.json - defined by filterArgs()
        // current env {object}
        envData : {}, // defined by loadAssets()
        envs : [], // defined by loadAssets()
        defaultEnv : null, // defined by loadAssets()
        devEnv : null, // defined by loadAssets()
        protocols : [], // defined by loadAssets()
        protocolsAvailable : [], // defined by loadAssets()
        defaultProtocol : null, // defined by loadAssets()
        portsPath : null, // defined by filterArgs()
        portsData : {}, // defined by loadAssets()
        portsList : [], // conxtual ports list (bundle or project)  for the scanner ?
        portsGlobalList : [], // global ports list  for the scanner ?
        portsReversePath : null, // defined by filterArgs()
        portsReverseData : {} // defined by loadAssets()
    };


    // merging with default
    cmd = merge(cmd, self);
    
    var getParams = function () {

        // filtering CMD arguments VS node.js argument
        var taskGroup       = cmd.task.split(/:/)[0]
            , file          = _( __dirname +'/'+ taskGroup +'/arguments.json', true )
            , cmdArguments = []
        ;

        if ( fs.existsSync(file) ) {
            if ( typeof(require.cache[file]) != 'undefined') {
                delete require.cache[require.resolve(file)]
            }

            cmdArguments = require(file);
        }

        var arr = [];

        for (var a in process.argv) {

            if ( process.argv[a].indexOf('--') > -1 && process.argv[a].indexOf('=') > -1) {

                arr = (process.argv[a].replace(/--/, '')).split(/=/);

                arr[0] = arr[0].toLowerCase();

                //Boolean values.
                if (arr[1] === "true") {
                    arr[1] = true
                }

                if (arr[1] === "false") {
                    arr[1] = false
                }

                if ( cmdArguments.indexOf('--' + arr[0]) > -1 )
                    cmd.params[arr[0]] = arr[1];
                else
                    cmd.nodeParams.push('--' + arr[0] +'='+ arr[1]);

            } else if ( process.argv[a].indexOf('--') > -1 ) {

                if ( cmdArguments.indexOf(process.argv[a]) > -1 )
                    cmd.params[ process.argv[a] ] = true;
                else
                    cmd.nodeParams.push(process.argv[a]);
            }
        }
    }

    /**
     * isCmdConfigured
     * filter argv & merge cmd properties
     * Used once at init to filter argv inputs and set some assets variables
     *
     *
     * @return {boolean} isConfigured
     * */
    isCmdConfigured = function() {
        
        cmd.configured = ( typeof(cmd.configured) != 'undefined' ) ? cmd.configured : false;

        if (cmd.configured) return; // can only be called once !!

        var errMsg = null;

        try {

            // framework package
            //cmd.package     = require( _(GINA_HOMEDIR + '/template/conf/package.json', true) );
            
            
            // main config
            cmd.mainConfigPath = _(GINA_HOMEDIR + '/main.json', true);
            if ( typeof(require.cache[cmd.mainConfigPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.mainConfigPath)]
            }
            cmd.mainConfig  = require( cmd.mainConfigPath );

            // projectsprojects
            cmd.projectConfigPath = _(GINA_HOMEDIR + '/projects.json', true);
            if ( typeof(require.cache[cmd.projectConfigPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.projectConfigPath)]
            }
            cmd.projects    = require( cmd.projectConfigPath );

            // bundles passed to the CMD
            cmd.bundles = ( typeof(cmd.bundles) == 'undefined' ) ? [] : cmd.bundles;

            var i           = 3 // usual the index start position for CMD task argument
                , argv      = process.argv
                , len       = argv.length
                , folder    = null
            ;

            cmd.task = argv[2];

            // getting CMD params
            getParams();

            var mightBeASomeBundle = true;
            for (; i < len; ++i) {

                if ( typeof(argv[i]) == 'undefined' )
                    break;

                // detection for project name
                if ( /^\@[a-z0-9_.]/.test(argv[i]) ) {

                    mightBeASomeBundle = false;

                    if ( !isValidName(argv[i]) ) {
                        errMsg = '[ '+ argv[i] +' ] is not a valid project name. Please, try something else: @[a-z0-9_.]';
                        console.error(errMsg);
                        exit(errMsg);
                        return false;
                    } else {
                        // only take the first one
                        if ( !cmd.projectArgvList.length )
                            cmd.projectName = argv[i].replace('@', '');
                    }

                    // only take the first one
                    if ( !cmd.projectArgvList.length ) {
                        // if path is set through CMD argv
                        // --path
                        if ( typeof(cmd.params.path) != 'undefined' ) {
                            folder = new _( cmd.params.path, true );


                        } else if ( typeof(cmd.params.path) == 'undefined' ) {
                            // getting the current path
                            folder = new _( process.cwd(), true );
                        }

                        if ( folder.isValidPath() ) {

                            if ( folder.toArray().last() == cmd.projectName ) {
                                cmd.projectLocation = _( folder.toString(), true );
                            } else {
                                cmd.projectLocation = _( folder.toString(), true );
                            }

                        } else {
                            errMsg = 'Argument `--path=`' +cmd.params.path + ' is not valid';
                            console.error(errMsg);
                            exit(errMsg);
                            return false;
                        }
                    }

                    cmd.projectArgvList.push( argv[i].replace('@', '') )

                } else if (mightBeASomeBundle && !/^\@/.test(argv[i]) && isValidName(argv[i]) ) { // bundles list
                    cmd.bundles.push( argv[i] )
                }
            }

            if (cmd.bundles.length == 1 ) {
                if  ( isValidName(cmd.bundles[0]) ) {
                    cmd.name = cmd.bundles[0]
                } else {
                    console.error('[ ' + cmd.name + ' ] is not a valid bundle name.');
                    process.exit(1)
                }                
            }


            // project name : passed or using the current folder as project name by default
            if ( cmd.projectName == null || typeof(cmd.projectName) == 'undefined' || cmd.projectName == '' ) {

                if (!/\:list$/.test(cmd.task)) {// ignore this cases
                    var folder = new _(process.cwd()).toArray().last();

                    if (isDefined('project', folder)) {

                        cmd.projectName = folder;
                        cmd.projectLocation = _(process.cwd(), true);
                    } else if (!/\:help$/.test(cmd.task)) {

                        errMsg = 'No project name found: make sure it starts with `@` as `@<project_name>`';
                        console.error(errMsg);
                        exit(errMsg);
                        return false;
                    }
                }                
            }

            // only when adding a project
            if (cmd.projectName != null) {
                // valid name but not in projects and task != :add, :remove or :import
                if ( typeof(cmd.projects[cmd.projectName]) == 'undefined' && !/\:(add|import|remove)$/.test(cmd.task) ) {
                    errMsg = 'Project name `@'+ cmd.projectName +'` not found in your projects';
                    console.error(errMsg);
                    exit(errMsg);
                    return false;
                }
                
                if ( typeof(cmd.projects[cmd.projectName]) == 'undefined') {                    
                    cmd.projectPath = _(cmd.projectLocation + '/project.json', true)
                }
                
                cmd.projectPath = (!cmd.projectPath) ? _(cmd.projects[cmd.projectName].path + '/project.json', true) : cmd.projectPath;

                if (typeof (cmd.projects[cmd.projectName]) != 'undefined') // ignore when adding project
                    cmd.envPath = _(cmd.projects[cmd.projectName].path + '/env.json'), true;
            }
           

            
            cmd.portsPath          = _(GINA_HOMEDIR + '/ports.json', true);
            cmd.portsReversePath   = _(GINA_HOMEDIR + '/ports.reverse.json', true);


            loadAssets();
            cmd.configured = true;

            return true; // completed configuration

        } catch (err) {

            console.emerg(err.stack);
            exit(err.stack);
            return false; // configuration failed
        }
    }

    /**
     * loadAssets
     * Will load files & content without cache
     * Use before require()
     *
     * @param {object} [usercmd]
     * */
    loadAssets = function () {

        var ports = null;

        if (cmd.projectName != null && typeof(cmd.projects[cmd.projectName]) != 'undefined') { // ignore when adding project
            
            
            
            if ( typeof(require.cache[cmd.projectPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.projectPath)]
            }
            cmd.projectData         = require(cmd.projectPath);
            cmd.projectLocation     = cmd.projects[cmd.projectName].path;
            cmd.bundlesLocation     = _(cmd.projects[cmd.projectName].path +'/src', true);

            if (fs.existsSync(cmd.projectLocation) ) {
                cmd.projects[cmd.projectName].exists = true;
            } else {
                cmd.projects[cmd.projectName].exists = false;
                return;
            }
           

            if (typeof(require.cache[cmd.envPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.envPath)]
            }
            cmd.envData = require(cmd.envPath);

            // updating envs list
            cmd.envs = [];
            for (var e in cmd.projects[cmd.projectName].envs) {
                cmd.envs.push(cmd.projects[cmd.projectName].envs[e])
            }
            cmd.envs.sort();

            if ( typeof(require.cache[cmd.portsPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.portsPath)]
            }
            cmd.portsData          = require(cmd.portsPath);

            if ( typeof(require.cache[cmd.portsReversePath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.portsReversePath)]
            }
            cmd.portsReverseData   = require(cmd.portsReversePath);


            
            ports = JSON.parse(JSON.stringify(cmd.portsData)); 
            cmd.protocols = [];
            cmd.portsData = {};
            var re = null;
            
            // // protocols list: for the bundle
            if (cmd.bundles.length > 0 && typeof (cmd.projects[cmd.projectName]) != 'undefined') { 
                
                for (var b = 0, bLen = cmd.bundles.length; b < bLen; ++b) {
                    
                    re = new RegExp('^' + cmd.bundles[b] +'\@', '');
                    
                    for (var protocol in ports) {
                        cmd.portsData[protocol] = {}
                        for (var port in ports[protocol]) {
                            // updating protocols list
                            if (cmd.protocols.indexOf(protocol) < 0 && re.test(ports[protocol][port])) {
                                cmd.protocols.push(protocol);
                                cmd.portsData[protocol][port] = {}
                            }

                            // updating port list
                            if (cmd.portsList.indexOf(protocol) < 0 && re.test(ports[protocol][port])) {
                                cmd.portsList.push(~~port);
                                cmd.portsData[protocol][port] = ports[protocol][port]
                            }
                        }
                    }
                }



            } else {
                // protocols list: for the project
                re = new RegExp('\@' + cmd.projectName, '');

                for (var protocol in ports) {
                    cmd.portsData[protocol] = {}
                    for (var port in ports[protocol]) {
                        // updating protocols list
                        if (cmd.protocols.indexOf(protocol) < 0 && re.test(ports[protocol][port])) {
                            cmd.protocols.push(protocol);
                            cmd.portsData[protocol][port] = {}
                        }

                        // updating port list
                        if (cmd.portsList.indexOf(protocol) < 0 && re.test(ports[protocol][port])) {
                            cmd.portsList.push(~~port);
                            cmd.portsData[protocol][port] = ports[protocol][port]
                        }


                    }
                }
            }
            
            // sorting
            cmd.protocols.sort();


        }

        // getting defautl envs list
        cmd.envs = (cmd.projectName != null && typeof(cmd.projects[cmd.projectName]) != 'undefined') ? cmd.projects[cmd.projectName]['envs'] : cmd.mainConfig['envs'][ GINA_SHORT_VERSION ];
        // getting default env
        cmd.defaultEnv = (cmd.projectName != null && typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['def_env'] : cmd.mainConfig['def_env'][ GINA_SHORT_VERSION ];
        // getting dev env
        cmd.devEnv = (cmd.projectName != null &&typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['dev_env'] : cmd.mainConfig['dev_env'][ GINA_SHORT_VERSION ];
        // available protocols
        cmd.protocolsAvailable = cmd.mainConfig.protocols[GINA_SHORT_VERSION];
        // getting default protocol
        cmd.defaultProtocol = (cmd.projectName != null && typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['def_protocol'] : cmd.mainConfig['def_protocol'][ GINA_SHORT_VERSION ];

        // global & currnet project ports list
        if (typeof (require.cache[cmd.portsPath]) != 'undefined') {
            delete require.cache[require.resolve(cmd.portsPath)]
        }

        ports = require(cmd.portsPath);
                    
        // protocols list
        if (cmd.protocols.length == 0)
            cmd.protocols = [];
        // setting port list
        var hasProject = false, re = null;
        if ( cmd.projectName != null && typeof(cmd.projects[cmd.projectName]) != 'undefined' ) {
            hasProject = true;
            re = new RegExp('\@'+ cmd.projectName +'\/', '');
        }
        
        for (var protocol in ports) {

            if (cmd.protocols.indexOf(protocol) < 0)
                cmd.protocols.push(protocol); // updating protocols list

            for (var port in ports[protocol]) {
                
                cmd.portsGlobalList.push(~~port); // updating global ports list
                
                if ( hasProject && re.test(ports[protocol][port]) ) {
                    cmd.portsList.push(~~port) // updating contextual ports list
                }
                
            }
        }

        if ( !cmd.portsData.count() )
            cmd.portsData = ports;
            
        if (cmd.protocols.length > 0)
            cmd.protocols.sort();
            
            
        // supplementing projects with bundles collection            
        var projectPropertiesPath = null;
        for (var project in cmd.projects) {

            projectPropertiesPath = _(cmd.projects[project].path + '/project.json', true);
            if (typeof (require.cache[projectPropertiesPath]) != 'undefined') {
                delete require.cache[require.resolve(projectPropertiesPath)]
            }
            cmd.bundlesByProject[project] = {};
            if (fs.existsSync(cmd.projects[project].path) ) {
                cmd.projects[project].exists    = true;
                cmd.bundlesByProject[project]   = require(projectPropertiesPath).bundles;
            } else {
                cmd.projects[project].exists    = false;
            }
        }
        
        
        var bundleConfigPath = null;
        for (var project in cmd.bundlesByProject) { // for each project
            
            for (var bundle in cmd.bundlesByProject[project]) { // for each bundle
                // bundles array list
                if ( cmd.bundles.indexOf(bundle) < 0 && cmd.projectName != null && project == cmd.projectName) { 
                    cmd.bundles.push(bundle);
                }            
                
                // bundle default environment inherits project's default environement
                cmd.bundlesByProject[project][bundle].defaultEnv = cmd.projects[cmd.projectName].def_env;
                
                if ( fs.existsSync(_(cmd.projectLocation + '/'+ cmd.bundlesByProject[project][bundle].src )) ) {
                    cmd.bundlesByProject[project][bundle].exists = true;                    
                    // adding configurations
                    // settings cmd.projects[cmd.projectName].def_env
                    bundleConfigPath = _(cmd.projectLocation + '/'+ cmd.bundlesByProject[project][bundle].src +'/config' );
                    cmd.bundlesByProject[project][bundle].configPaths = {
                        settings: _(bundleConfigPath +'/settings.json')
                    };
                    
                } else {
                    cmd.bundlesByProject[project][bundle].exists = false;
                }
            }                   
        }
        
        // control the bundle name
        if ( cmd.projectName != null && cmd.name != null && typeof(cmd.bundlesByProject[cmd.projectName][cmd.name]) == 'undefined' ) { 
            errMsg = 'Bundle name `'+ cmd.name +'` not found in your project `@'+ cmd.projectName +'`';
            console.error(errMsg);
            exit(errMsg);
            return false;
        }  

    }


    /**
     * isDefined
     *
     * @param {string} type [ project | bundle | env ]
     * @param {string} name
     *
     * @return {boolean} exists
     * */
    isDefined = function(type, name) {

        if (
            typeof(name) == 'undefined'
            || typeof(name) != 'undefined' && name == ''
            || typeof(name) != 'undefined' && name == null
        ) {
            throw new Error('isDefined Error : name cannot be undefined, null or blank !')
        }

        switch (type) {

            case 'project':
                return ( typeof(cmd.projects) != 'undefined' && typeof(cmd.projects[name]) != 'undefined' && cmd.projects[name] != null && cmd.projects[name] != '' ) ? true : false;
            break;

            case 'bundle':
                return ( typeof(cmd.portsReverseData) != 'undefined' &&  typeof(cmd.portsReverseData[ name +'@'+ cmd.projectName ]) != 'undefined' ) ? true : false;
            break;

            case 'env':
                return ( typeof(cmd.envs) != 'undefined' && cmd.envs.indexOf(name) > -1 ) ? true : false;
            break;

            default:
                return false;
        }
    }

    /**
     * isValidName
     * test if a given [ project | bundle | env] name is valid or not
     * */
    isValidName = function(name) {

        if ( typeof(name) == 'undefined' || name == null || name == '')
            return false;

        return /^[a-z0-9_.]/.test( name.replace('@', '') )
    }

    /**
     * getHelp
     *
     * Output current help.txt
     * */
    getHelp = function () {

        var taskGroup   = cmd.task.split(/:/)[0]
            , file      = _( __dirname +'/'+ taskGroup +'/help.txt', true )
            , errMsg    = 'No help available for `'+ taskGroup +'` command line at the moment. Please try again on the next release';

        console.log('file ', file);
        if ( !fs.existsSync(file) ) {

            console.error(errMsg);
            exit(errMsg);
            return false;
        }

        try {
            console.log( '\n' + fs.readFileSync( file ) )
        } catch(err) {
            console.error( err.stack )
        }
    }


    exit = function(errorMessage) {
        
        if ( typeof(errorMessage) != 'undefined' ) {
            client.write(errorMessage + '\n');
        }

        // CMD exit
        process.exit(0)
    }
};

module.exports = CmdHelper;