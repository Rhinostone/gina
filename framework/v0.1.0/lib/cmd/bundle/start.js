var fs          = require('fs');
var spawn       = require('child_process').spawn;

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
    var self    = {}
    , local     = {
        bundle      : null        
    };
    

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
            for (var i = 0, len = opt.argv.length; i<len; i++) {
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

        var msg = null;
        if ( !isDefined('bundle', bundle) ) {
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
                , msg       = null
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
                    console.info(msg);
                    opt.client.write(msg);
                    
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
                            if (!opt.client.destroyed)
                                opt.client.emit('end');                                                        
                        }
                    }, maxTimeout);
                    
                    var checkCaseCount = 2, checkCaseRe = new RegExp('('+bundle + '@' + self.projectName + ' mounted !|Bundle started !)', 'i');
                    var port = '', errorFound = false;                    
                    child.stdout.on('data', function(data) {
                        
                        console.log(data);
                        // handle errors
                        if (/EADDRINUSE.*port/i.test(data) && !errorFound ) {
                            errorFound = true;
                            //opt.client.write(data);                              
                            try {
                                port = ' #'+ data.match(/port\":\s+\d+/)[0].split(/\:/)[1].trim() +' ';                                
                                opt.client.write('  => bundle [ ' + bundle + '@' + self.projectName + ' ] has already been started, or port'+ port+'might be busy'); 
                                                                
                            } catch(_err) {
                                opt.client.write(_err);                                
                            }  
                            
                            ++opt.onlineCount;
                            end(opt, cmd, isBulkStart, bundleIndex);   
                            clearInterval(timerId);
                            child.kill('SIGKILL'); 
                        }
                        
                        if (/\[ emerg \]/.test(data) ) {
                            
                            
                            opt.notStarted.push(bundle + '@' + self.projectName);
                            opt.client.write('  => bundle [ ' + bundle + '@' + self.projectName + ' ] aborted :( \n  => Check your logs to see why.');
                            // var msg = null;
                            // if ( /\[ error \]/.test(data) ) {
                            //     msg = data.substr(data.lastIndexOf('[ error ]'), 300) +'...';
                            //     opt.client.write(msg)
                            // }
                            end(opt, cmd, isBulkStart, bundleIndex);   
                            clearInterval(timerId);
                        }
                        
                        if ( checkCaseRe.test(data) ) {                            
                            --checkCaseCount;
                            //opt.client.write('bundle '+bundle+':'+ checkCaseCount);
                        }
                        
                        if (!opt.client.destroyed && !isStarting && !checkCaseCount) {                            
                            isStarting = true;
                            clearInterval(timerId);
                            ++opt.onlineCount;                            
                            opt.client.write('  => bundle [ ' + bundle + '@' + self.projectName + ' ] started :D');
                            
                            end(opt, cmd, isBulkStart, bundleIndex);
                            return;
                        }                        
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
                
            })//EO isRealApp
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
        } else {
            if (!opt.client.destroyed)
                opt.client.emit('end');                
        }
    }



    var isRealApp = function(bundle, callback) {

        var p               = null
            , d             = null
            , env           = self.projects[self.projectName]['def_env']
            , isDev         = GINA_ENV_IS_DEV
            , root          = self.projects[self.projectName].path
            , bundleDir     = null
            , bundlesPath   = null
            , bundleInit    = null
        ;

        try {
            //This is mostly for dev.
            var pkg = require( _(root + '/project.json') ).bundles;

            if ( typeof(pkg[bundle].release.version) == 'undefined' && typeof(pkg[bundle].tag) != 'undefined') {
                pkg[bundle].release.version = pkg[bundle].tag
            }
            if (
                pkg[bundle] != 'undefined' && pkg[bundle]['src'] != 'undefined' && isDev
            ) {
                var path = pkg[bundle].src;

                p = _( root +'/'+ path );//path.replace('/' + bundle, '')
                d = _( root +'/'+ path + '/index.js' );

                bundleDir   = path.replace('/' + bundle, '');
                setContext('bundle_dir', bundleDir);
                bundlesPath =  _( root +'/'+ bundleDir );
                bundleInit  = d;

            } else {
                //Others releases.
                var path    = 'releases/'+ bundle +'/' + env +'/'+ pkg[bundle].release.version;
                var version = pkg[bundle].release.version;
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
        fs.exists(d, function(exists) {
            if (exists) {
                //checking bundle directory.
                fs.stat(p, function(err, stats) {

                    if (err) {
                        callback(err)
                    } else {

                        if ( stats.isDirectory() ) {
                            callback(false, d)
                        } else {
                            callback(new Error('[ '+ d +' ] is not a directory'))
                        }
                    }
                })
            } else {
                callback(new Error('[ '+ d +' ] does not exists'))
            }
        })
    }
    

    init(opt, cmd)
};

module.exports = Start