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

    // cmd properties list
    var self = {
        task: null,
        // framework main config {object}
        mainConfig : null,
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
        projectPath : null, // path to project.json - defined by filterArgs()
        projectData: {},
        // current project bundles list {array}
        bundles : [], // defined by filterArgs()
        bundlesLocation : null,

        // current project env.json path
        envPath : null, // path to env.json - defined by filterArgs()
        // current env {object}
        envData : {}, // defined by loadAssets()
        envs : [], // defined by loadAssets()
        defaultEnv : null, // defined by loadAssets()
        devEnv : null, // defined by loadAssets()
        protocols : [], // defined by loadAssets()
        defaultProtocol : null, // defined by loadAssets()
        portsPath : null, // defined by filterArgs()
        portsData : {}, // defined by loadAssets()
        portsList : [],
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
            if ( typeof(require.cache[_(GINA_HOMEDIR + '/main.json', true)]) != 'undefined') {
                delete require.cache[require.resolve(_(GINA_HOMEDIR + '/main.json', true))]
            }
            cmd.mainConfig  = require( _(GINA_HOMEDIR + '/main.json', true) );

            // projects
            if ( typeof(require.cache[_(GINA_HOMEDIR + '/projects.json', true)]) != 'undefined') {
                delete require.cache[require.resolve(_(GINA_HOMEDIR + '/projects.json', true))]
            }
            cmd.projects    = require( _(GINA_HOMEDIR + '/projects.json', true) );

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

            for (; i < len; ++i) {

                if ( typeof(argv[i]) == 'undefined' )
                    break;

                // detection for project name
                if ( /^\@[a-z0-9_.]/.test(argv[i]) ) {

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

                } else if ( isValidName(argv[i]) ) { // bundles list
                    cmd.bundles.push( argv[i] )
                }
            }


            // project name : passed or using the current folder as project name by default
            if ( cmd.projectName == null || typeof(cmd.projectName) == 'undefined' || cmd.projectName == '' ) {

                if (/\:list$/.test(cmd.task)) // ignore this cases
                    return;

                var folder = new _(process.cwd()).toArray().last();

                if ( isDefined('project', folder) ) {

                    cmd.projectName = folder;
                    cmd.projectLocation = _( process.cwd(), true );
                } else if ( !/\:help$/.test(cmd.task) ) {

                    errMsg = 'No project name found: make sure it starts with `@` as `@<project_name>`';
                    console.error(errMsg);
                    exit(errMsg);
                    return false;
                }
            }

            // only when adding a project
            if ( typeof(cmd.projects[cmd.projectName]) == 'undefined' ) {
                cmd.projectPath = _(cmd.projectLocation +'/project.json', true)
            }

            cmd.projectPath        = ( !cmd.projectPath ) ? _(cmd.projects[cmd.projectName].path + '/project.json', true) : cmd.projectPath;

            if ( typeof(cmd.projects[cmd.projectName]) != 'undefined') // ignore when adding project
                cmd.envPath        = _(cmd.projects[cmd.projectName].path + '/env.json'), true;


            cmd.portsPath          = _(GINA_HOMEDIR + '/ports.json', true);
            cmd.portsReversePath   = _(GINA_HOMEDIR + '/ports.reverse.json', true);


            loadAssets();

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

        if ( typeof(cmd.projects[cmd.projectName]) != 'undefined') { // ignore when adding project

            if ( typeof(require.cache[cmd.projectPath]) != 'undefined') {
                delete require.cache[require.resolve(cmd.projectPath)]
            }
            cmd.projectData         = require(cmd.projectPath);
            cmd.projectLocation     = cmd.projects[cmd.projectName].path;
            cmd.bundlesLocation     = _(cmd.projects[cmd.projectName].path +'/src', true);


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


            // updating protocols list
            cmd.protocols = [];
            for (var p in cmd.projects[cmd.projectName].protocols) {
                cmd.protocols.push(cmd.projects[cmd.projectName].protocols[p]);

            }
            cmd.protocols.sort();

            // setting port list
            for ( var protocol in cmd.portsData ) {
                for ( var port in cmd.portsData[protocol] ) {
                    cmd.portsList.push( ~~port )
                }
            }

        }

        // getting defautl envs list
        cmd.envs = ( typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['envs'] : cmd.mainConfig['envs'][ GINA_SHORT_VERSION ];
        // getting default env
        cmd.defaultEnv = ( typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['def_env'] : cmd.mainConfig['def_env'][ GINA_SHORT_VERSION ];
        // getting dev env
        cmd.devEnv = ( typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['dev_env'] : cmd.mainConfig['dev_env'][ GINA_SHORT_VERSION ];
        // getting default protocol
        cmd.defaultProtocol = ( typeof(cmd.projects[cmd.projectName]) != 'undefined' ) ? cmd.projects[cmd.projectName]['def_protocol'] : cmd.mainConfig['def_protocol'][ GINA_SHORT_VERSION ];

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

            client.write(errorMessage);
        }

        // CMD exit
        client.emit('end');

    }
};

module.exports = CmdHelper;