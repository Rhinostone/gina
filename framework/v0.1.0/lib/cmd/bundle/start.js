const { debug } = require('console');
var fs          = require('fs');
const { spawn } = require('child_process');

var CmdHelper   = require('./../helper');
var console     = lib.logger;
/**
 * Start a given bundle or start all bundles at once
 *
 * e.g.
 *  gina bundle:start <bundle_name> @<project_name>
 *  
 * // start all bundles within the project
 *  gina bundle:start @<project_name>
 *
 * */
function Start(opt, cmd) {
    var self    = {};
    

    var init = function(opt, cmd) {
        
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
                        
        // check CMD configuration
        if (!isCmdConfigured()) return false;
        
                      
        // start all bundles   
        opt.onlineCount = 0;   
        opt.notStarted = [];
        
        if (!self.name) {
            start(opt, cmd, 0);
        } else {
            start(opt, cmd);
        }        
    }
    
    var start = function(opt, cmd, bundleIndex) {
        // getting the debug port
        var debugStr = null;
        if ( /\-\-(inspect|debug)/.test(opt.argv.join(',')) ) {
            var pArr = null;
            for (let i = 0, len = opt.argv.length; i<len; i++) {
                if ( /\-\-(inspect|debug)/.test(opt.argv[i]) ) {
                    pArr = opt.argv[i].replace(/\s+/g, '').split(/=/);
                    opt.debugBrkEnabled = /\-brk/.test(pArr[0]);
                    opt.debugPort = pArr[1];  
                    debugStr = opt.argv[i];
                    break;
                }
            }            
        }
        
        
        var isBulkStart = (typeof(bundleIndex) != 'undefined') ? true : false;
        
        var bundle = (isBulkStart) ? self.bundles[bundleIndex] : self.name;
        // console.debug('bundle -> ', bundle);
        var env = ( typeof(self.bundlesByProject[self.projectName][bundle].def_env) != 'undefined') ? self.bundlesByProject[self.projectName][bundle].def_env : self.defaultEnv;
        // console.debug('env -> ', env);
        var protocol = self.bundlesByProject[self.projectName][bundle].def_protocol;
        // console.debug('protocol -> ', protocol);
        var scheme = self.bundlesByProject[self.projectName][bundle].def_scheme;
        // console.debug('scheme -> ', scheme);
        var bundlePort = self.portsReverseData[bundle + '@' + self.projectName][env][protocol][scheme];        
        // console.debug('port -> ', bundlePort);
                
        var msg = null;
        if ( !isBulkStart && !isDefined('bundle', bundle) ) {
            msg = 'Bundle [ '+ bundle +' ] is not registered inside `@'+ self.projectName +'`';
            console.error(msg);
            opt.client.write(msg);
            // CMD exit
            opt.client.emit('end');
        } else {

            var isStarting  = false
                , params    = null
                , index     = null
                , i         = null
                , len       = null
            ;
              
            isRealApp(bundle, function(err, appPath){   
                if (err) {
                    console.error(err.stack||err.message)
                } else {   
                    if (isStarting)
                        return;
                    
                    msg = 'Trying to start bundle [ ' + bundle + '@' + self.projectName + ' ]';
                    if (opt.debugPort) {
                        msg += ' (debug port: '+ opt.debugPort +')'
                    }
                    // To gina log
                    console.info(msg);
                    // to the terminal stdout
                    opt.client.write('\n\r'+msg);
                                        
                    process.list = (process.list == undefined) ? [] : process.list;
                    setContext('processList', process.list);
                    setContext('ginaProcess', process.pid);
                    setContext('debugPort', opt.debugPort);
                    setContext('debugBrkEnabled', opt.debugBrkEnabled);

                    params = [
                        // node arguments will be passed by gina
                        appPath,
                        JSON.stringify(getContext()), //Passing context to child.
                        self.projectName, // project name
                        bundle // bundle name
                    ];

                    // injecting node arguments
                    index = 0; i = 0; len = self.nodeParams.length;
                    if (len > 0) {
                        for (; i < len; ++i) {
                            params.splice(index, 0, self.nodeParams[i]);
                            ++index
                        }
                    }

                    i = 0; len = params.length;
                    for (; i < len; ++i) {
                        if (params[i] == '') {
                            params.splice(i, 1);
                        }
                    }
                    
                    
                    
                    var child = spawn(opt.argv[0], params,
                        {
                            detached: true
                        }
                    );

                    child.stdout.setEncoding('utf8');//Set encoding.
                    
                    // CMD Auto Exit
                    var retry = 0, maxRetry = 15, maxTimeout = (self.debugBrkEnabled) ? 1200000 : 4000;
                    var timerId = setInterval(function() {
                        if (!isStarting ) {
                            ++retry;
                            //opt.client.write('what is wrong ? '+ retry);
                        } else {
                            clearInterval(timerId);
                        }
                         
                        if (retry > maxRetry) {
                            clearInterval(timerId);
                            opt.client.write('Sorry my friend, this is taking too long ! Terminating. Check your logs.');
                            child.kill('SIGKILL'); 
                            if (!opt.client.destroyed) {
                                opt.client.emit('exit');
                                opt.client.emit('end');
                            }
                                

                            //end(opt, cmd, isBulkStart, bundleIndex);
                        }
                    }, maxTimeout);
                    
                    var checkCaseCount = 2
                        // The 2 flags we need to free the child.stdout if we do not want the command to wait for a timeout
                        // NB.: you can place flag by using console.notice
                        , checkCaseRe = new RegExp('('+bundle + '@' + self.projectName + ' mounted !|Bundle started !)', 'i')
                        , url = null
                        , debuggerOn = null
                    ;
                    var port = '', errorFound = false;                    
                    child.stdout.on('data', function(data) {
                        
                        console.log(data);
                        // handle errors
                        if ( /EADDRINUSE.*port/i.test(data) && !errorFound ) {
                            // kill the bundle starting process first
                            child.kill('SIGKILL');
                            
                            errorFound = true;
                            //opt.client.write(data);                              
                            try {
                                port = ' #'+ data.match(/port\":\s+\d+/)[0].split(/\:/)[1].trim() +' ';                                
                                opt.client.write('  [ ' + bundle + '@' + self.projectName + ' ] has already been started, or port'+ port+'might be busy'); 
                                                                
                            } catch(_err) {
                                opt.client.write(_err);                                
                            }  
                            
                            
                            ++opt.onlineCount;                            
                            end(opt, cmd, isBulkStart, bundleIndex);   
                            clearInterval(timerId);
                            return;
                        }
                        
                        // catch fatal errors to exit                        
                        if ( /(\[|\[\s+)emerg/.test(data) ) {
                            // kill the bundle starting process first
                            child.kill('SIGKILL');
                            
                            opt.notStarted.push(bundle + '@' + self.projectName);
                            opt.client.write('  [ ' + bundle + '@' + self.projectName + ' ] aborted :( \n  => Check your logs to see why.');
                            
                            ++opt.onlineCount;
                            end(opt, cmd, isBulkStart, bundleIndex);   
                            clearInterval(timerId);                            
                            return;
                        }
                        
                        // Expecting 2 flags (checkCaseCount) to free the child stdout !!
                        if ( checkCaseRe.test(data) ) {                            
                            --checkCaseCount;
                        }
                        
                        // cache bundle state info given by the server while starting
                        if ( !debuggerOn && new RegExp('Debugger listening on','gmi').test(data)) {
                            debuggerOn = '\n   ' + data.match(new RegExp('Debugger listening on .*','gmi'));
                        }
                        if ( !url && new RegExp('This way please','gmi').test(data)) {
                            url = '\n   ' + data.match(new RegExp('This way please -> .*','gmi'));
                        }
                        
                        
                        
                        if (!opt.client.destroyed && !isStarting && !checkCaseCount) {                            
                            isStarting = true;
                            clearInterval(timerId);
                            ++opt.onlineCount;
                            
                            if (!debuggerOn) {
                                debuggerOn = ''
                            }
                            opt.client.write('  [ ' + bundle + '@' + self.projectName + ' ] started V(-.o)V'+ url + debuggerOn);
                            
                            
                            end(opt, cmd, isBulkStart, bundleIndex);
                            return;
                        }
                        
                        return;
                        
                    });

                    //when an exception is thrown, it is sent to the client
                    child.stderr.setEncoding('utf8');
                    var error = null;
                    child.stderr.on('data', function(err) {  
                        error = err.toString();                        
                        
                        if (/Debugger listening|Debugger attached|Warning|address already in use/i.test(error)) {
                            console.warn(error);

                            if (!opt.client.destroyed) {
                                opt.client.write(error);
                            }

                        } else {
                            console.error(error);
                        }
                    });

                    child.on('exit', function(code, signal) {                   
                        // handles only signals that cannot be cannot be caught or ignored
                        // ref.: `framework/<version>/lib/proc.js`
                        if (/(SIGKILL|SIGSTOP)/i.test(signal)) {
                            console.emerg('[' + this.pid + '] exiting with signal: ', signal);
                            cmd.proc.dismiss(this.pid, signal);
                        }
                    });

                    
                }
                
            });//EO isRealApp
            
        }
    }
    
    
    var end = function (opt, cmd, isBulkStart, i) {
        if (isBulkStart) {            
            ++i;            
            if ( typeof(self.bundles[i]) != 'undefined' ) {
                start(opt, cmd, i)
            } else {
                opt.client.write('\n\r[ Online ] '+ opt.onlineCount +'/'+ self.bundles.length);
                var notStartedMsg = '\nCould not start: \n  - '+ opt.notStarted.join('\n');
                opt.client.write(notStartedMsg);
                if (!opt.client.destroyed)
                    opt.client.emit('end');
            }
            return;
        }
        
        if (!opt.client.destroyed)
            opt.client.emit('end');
        // Force exit in case process is stuck
        setTimeout(() => {
            if (!opt.client.destroyed) {
                opt.client.emit('exit');
            }
        }, 150);
    }



    var isRealApp = function(bundle, callback) { 
        var p               = null
            , d             = null
            , env           = self.projects[self.projectName]['def_env']
            , isDev         = ( self.projects[self.projectName]['dev_env'] == env ) ? true : false
            , root          = self.projectLocation
            , bundleDir     = null
            , bundlesPath   = null
            , bundleInit    = null
        ;

        try {
            //This is mostly for dev.                        
            var pkg = requireJSON( _(root+ '/manifest.json', true) ).bundles;
            if ( typeof(pkg[bundle].version) == 'undefined' && typeof(pkg[bundle].tag) != 'undefined') {
                pkg[bundle].version = pkg[bundle].tag
            }
            
            var path = null, version = null;
            if (
                pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && isDev
            ) {
                path = pkg[bundle].src;

                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir   = path.replace('/' + bundle, '');
                setContext('bundle_dir', bundleDir);
                bundlesPath =  _( root +'/'+ bundleDir );
                bundleInit  = d;

            } else {
                //Others releases.
                path    = 'releases/'+ bundle +'/' + env +'/'+ pkg[bundle].version;
                version = pkg[bundle].version;
                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir   = path;
                bundlesPath = _(root + '/'+ bundleDir);
                bundleInit  = d;
            }

        } catch (err) {
            // default bundlesPath.
            // TODO - log warn ?
            console.warn(err.stack||err.message);
            bundleDir   = 'bundles';
            bundlesPath = _(root +'/'+ bundleDir);
            p = _(root +'/'+ bundleDir +'/'+ bundle);
            d = _(root + '/'+ bundleDir +'/'+ bundle + '/index.js');
            bundleInit = d;
        }
         
        //Checking root.
        if ( new _(d, true).existsSync() ) {
            //checking bundle directory.
            fs.stat(p, function(err, stats) {
                if (err) {
                    callback(err)
                } else {

                    if (stats.isDirectory()) {
                        callback(false, d)
                    } else {
                        callback(new Error('[ ' + d + ' ] is not a directory'))
                    }
                }
            })
        }
        else {
            callback(new Error('[ ' + d + ' ] does not exists'))
        }
    }
    

    init(opt, cmd)
}
module.exports = Start;