/* Gina.utils.Proc
 *
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 *
 * { name: 'SIGABRT', action: 'A', desc: 'Process abort signal.' },
 * { name: 'SIGALRM', action: 'T', desc: 'Alarm clock.' },
 * { name: 'SIGBUS', action: 'A', desc: 'Access to an undefined portion of a memory object.' },
 * { name: 'SIGCHLD', action: 'I', desc: 'Child process terminated, stopped, or continued. ' },
 * { name: 'SIGCONT', action: 'C', desc: 'Continue executing, if stopped.' },
 * { name: 'SIGFPE', action: 'A', desc: 'Erroneous arithmetic operation.' },
 * { name: 'SIGHUP', action: 'T', desc: 'Hangup.' },
 * { name: 'SIGILL', action: 'A', desc: 'Illegal instruction.' },
 * { name: 'SIGINT', action: 'T', desc: 'Terminal interrupt signal.' },
 * { name: 'SIGKILL', action: 'T', desc: 'Kill (cannot be caught or ignored).' },
 * { name: 'SIGPIPE', action: 'T', desc: 'Write on a pipe with no one to read it.' },
 * { name: 'SIGQUIT', action: 'A', desc: 'Terminal quit signal.' },
 * { name: 'SIGSEGV', action: 'A', desc: 'Invalid memory reference.' },
 * { name: 'SIGSTOP', action: 'S', desc: 'Stop executing (cannot be caught or ignored).' },
 * { name: 'SIGTERM', action: 'T', desc: 'Termination signal.' },
 * { name: 'SIGTSTP', action: 'S', desc: 'Terminal stop signal.' },
 * { name: 'SIGTTIN', action: 'S', desc: 'Background process attempting read.' },
 * { name: 'SIGTTOU', action: 'S', desc: 'Background process attempting write.' },
 * { name: 'SIGUSR1', action: 'T', desc: 'User-defined signal 1.' },
 * { name: 'SIGUSR2', action: 'T', desc: 'User-defined signal 2.' },
 * { name: 'SIGPOLL', action: 'T', desc: 'Pollable event. ' },
 * { name: 'SIGPROF', action: 'T', desc: 'Profiling timer expired. ' },
 * { name: 'SIGSYS', action: 'A', desc: 'Bad system call.' },
 * { name: 'SIGTRAP', action: 'A', desc: 'Trace/breakpoint trap. ' },
 * { name: 'SIGURG', action: 'I', desc: 'High bandwidth data is available at a socket.' },
 * { name: 'SIGVTALRM', action: 'T', desc: 'Virtual timer expired.' },
 * { name: 'SIGXCPU', action: 'A', desc: 'CPU time limit exceeded.' },
 * { name: 'SIGXFSZ', action: 'A', desc: 'File size limit exceeded. ' }
 * */


//Imports
var fs          = require('fs');
var Emitter     = require('events').EventEmitter;
var spawn       = require('child_process').spawn;
var UtilsConfig = require( _(__dirname + '/config') );
var inherits    = require( _(__dirname + '/inherits') );
var console     = require( _(__dirname + '/logger') );
//var helpers     = require( _(__dirname + '/helpers') );

//console.debug('[ FRAMEWORK ][ PROC ] path ? ', getPaths());

/**
 * @constructor
 *
 * @param {string} bundle
 *
 * */
function Proc(bundle, proc, usePidFile){

    var e       = new Emitter();

    if ( typeof(usePidFile) == 'undefined') {
        var usePidFile = true
    }

    //default path to store pid files.
    var pathObj = new _( GINA_RUNDIR + '/gina' );

    var self    = {
        usePidFile  : usePidFile || false,
        PID         : null,
        path        : null,
        master      : false, //used only by master.
        bundle      : bundle,
        bundles     : [],
        proc        : proc

    };

    /**
     * Init process handler
     * */
    var init = function() {

        process.list = (process.list == undefined) ? [] : process.list;
        process.pids = (process.pids == undefined) ? {} : process.pids;

        self.register(self.bundle, self.proc.pid);
    };

    var isMaster = function() {
        return (self.master) ? true : false;
    };

    // var getShutdownConnectorSync = function(bundle) {
    //     var bundlesPath = getPath('bundlesPath');
    //     var connPath = _(bundlesPath +'/'+ bundle + '/config/connector.json');
    //     try {
    //         console.debug('[ FRAMEWORK ][ PROC ] Reading connPath: ', connPath);
    //         var content = fs.readFileSync(connPath);
    //         return JSON.parse(content).httpClient.shutdown
    //     } catch (err) {
    //         return undefined
    //     }
    // }
    /**
     * Going to force restart by third party (kill 9).
     *
     * @param {string} bundle
     * @param {string} env
     * @param {number} pid
     *
     * @callback callback
     * @param {boolean|string} err
     * */
    var respawn = function(bundle, env, pid, callback) {
        //var loggerInstance = getContext('logger');
        //loggerInstance["trace"]('Fatal error !');
        //console.debug('[ FRAMEWORK ][ PROC ] Exiting and re spawning : ', bundle, env);
        // TODO - Count the restarts and prevent unilimited loop
        // TODO - Send notification to admin or/and root to the Fatal Error Page.

        try {
            var version = process.getVersion(bundle);
        } catch (err) {
            var bundle = process.argv[3];
            //var port = self.getBundlePortByBundleName(bundle);
            //console.debug('[ FRAMEWORK ][ PROC ] Bundle ', bundle,' already running or port[ '+port+' ] is taken by another process...');
            //loggerInstance["trace"]("Bundle [ "+ bundle +" ] already running or [ "+env+" ] port is use by another process...");
            console.debug('[ FRAMEWORK ][ PROC ] Bundle [ '+ bundle +' ] already running or [ '+env+' ] port is use by another process');
            dismiss(process.pid);
        }


        var outPath = _(GINA_LOGDIR + '/gina/out.'+bundle+'.'+version+'.log');
        var errPath = _(GINA_LOGDIR + '/gina/out.'+bundle+'.'+version+'.log');
        //var nodePath = getPath('node');
        //var ginaPath = _(root + '/gina');

        // if (env == 'prod') { //won't loop forever for others env.
        //
        //     //var opt = process.getShutdownConnectorSync();
        //     var opt = getShutdownConnectorSync(bundle);
        //     //Should kill existing one..
        //     opt.path = '/' + bundle + '/restart/' + pid + '/' + env;
        //
        //     var HttpClient = require('gina.com').Http;
        //     var httpClient = new HttpClient();
        //
        //     if (httpClient) {
        //         //httpClient.query(opt);
        //         //We are not waiting for anything particular...do we ?
        //         httpClient.query(opt, function (err, msg) {
        //             //Now start new bundle.
        //             callback(err);
        //         });
        //     } else {
        //         var err = new Error('No shutdown connector found.');
        //         console.error(err);
        //         callback(err);
        //     }
        //
        // } else {
            callback(false);
        //}
    };

    var setPID = function(bundle, PID, proc) {

        if (bundle != 'gina') {
            proc.title = 'gina: '+ bundle;
        } else {
            proc.title = bundle;
        }

        //Set event.
        setDefaultEvents(bundle, PID, proc);
    };

    var setDefaultEvents = function(bundle, PID, proc) {


        if ( typeof(PID) != 'undefined' && typeof(PID) == 'number' ) {
            console.debug('[ FRAMEWORK ][ PROC ] Setting listeners for ', PID, ':', bundle);

            proc.dismiss = dismiss;
            proc.isMaster = isMaster;


            proc.on('SIGTERM', function(code){

                if ( typeof(code) == 'undefined')
                    var code = 0;

                proc.exit(code);
            });

            proc.on('SIGINT', function(code){

                if (code == undefined)
                    var code = 0;

                console.info('[ FRAMEWORK ][ PROC ] Got exit code. Now killing: ', code);
                proc.exit(code);//tigger exit event.
            });

            //Will prevent the server from stopping.
            proc.on('uncaughtException', function(err) {
                
                if ( /ERR\_HTTP\_HEADERS\_SENT/.test(err.stack) ) {
                    console.error('[ SERVER ][ HTTP UNCAUGHT EXCEPTION ]', err.stack);
                    return false;
                }
                
                if ( /ERR\_HTTP2/.test(err.stack) ) {
                    console.warn('[ SERVER ][ HTTP2 UNCAUGHT EXCEPTION ]', err.stack);
                    return false;
                }
                
                console.emerg('[ FRAMEWORK ][ uncaughtException ] ', err.stack);

                //console.debug("[ FRAMEWORK ][ PROC ] @=>", self.args);
                //var env =  process.env.NODE_ENV || 'prod';
                var bundle = self.bundle;
                var pid = self.getPidByBundleName(bundle);

                dismiss(pid, 'SIGKILL');


                // TODO - Wake up buddy !.
                //respawn(bundle, env, pid, function(err) {
                    //TODO - Send an email to the administrator/dev
                    //TODO - Have a delegate handler to allow the dev to do its stuff. Maybe it's already there if any dev can override.
                    //proc.exit(1) // don't kill !!! It will stop the server
                //})
            });

            proc.on('exit', function(code){

                if ( typeof(code) == 'undefined') {
                    code = 0;
                }

                var bundle = self.bundle;
                var env =  process.env.NODE_ENV || 'prod';
                var pid = self.getPidByBundleName(bundle);


                dismiss(process.list[process.list.count()-1].pid, "SIGKILL")
            });

            proc.on('SIGHUP', function(code){
                console.debug('[ FRAMEWORK ] Hanging up ! Code: '+ code +'\n'+ process.argv);

                var bundle = self.bundle;
                var env =  process.env.NODE_ENV || 'prod';
                var pid = self.getPidByBundleName(bundle);

                dismiss(process.pid, "SIGINT");
                dismiss(pid, "SIGINT");
            })
        }
    };


    var dismiss = function(pid, signal){
        if (pid == undefined) {
            var pid = self.PID;
        }

        try {
            //console.debug('[ FRAMEWORK ][ PROC ] => '+ JSON.stringify(process.list, null, 4));
            var index       = null
                , mountPath = null
                , pidPath   = null
            ;

            for (var p in process.list) {
                if ( process.list[p].pid == pid && process.list[p].name != 'gina' ) {
                    index       = p;
                    pidPath     = _(GINA_RUNDIR + '/gina/' + process.list[p].pid);
                    mountPath   =  _(getPath('mountPath') + '/' + process.list[p].name);

                    if ( fs.existsSync(pidPath) )
                        fs.unlinkSync( pidPath );

                    if ( fs.existsSync(mountPath) )
                        fs.unlinkSync( mountPath );

                    // soft kill..
                    process.kill(pid, signal);
                } else if ( process.list[p].pid == pid && process.list[p].name == 'gina' ) {
                    index       = p;
                    pidPath     = _(GINA_RUNDIR + '/gina/' + process.list[p].pid);

                    if ( fs.existsSync(pidPath) )
                        fs.unlinkSync( pidPath );
                }
            }
        } catch (err) {
            //Means that it does not exists anymore.
            console.debug('[ FRAMEWORK ][ PROC ] ', err.stack)
        }

        if (index != null)
            delete process.list[index];

        // handles only signals that cannot be cannot be caught or ignored
        if ( /(SIGKILL|SIGSTOP)/i.test(signal) ) {
            pidPath     = _(GINA_RUNDIR + '/gina/' + pid);

            if ( fs.existsSync(pidPath) )
                fs.unlinkSync( pidPath );
        }

        console.debug('[ FRAMEWORK ][ PROC ] Received '+ signal +' signal to end process [ '+ pid +' ]');
    };

    /**
     * Save PID file
     * @param {string} bundle
     * @param {integer} PID Id of the PID to save
     *
     * @private
     * */
    var save = function(){
        var bundle  = self.bundle
            , PID   = self.PID
            , proc  = self.proc
            , path  = self.path
        ;

        //Get PID path.
        if (
            typeof(bundle) != "undefined" && bundle != ''
            && typeof(PID) != "undefined" && PID != '' && PID != null
            && typeof(proc) != "undefined" && proc != '' && proc != null
        ) {
            try {
                var fileStream = fs.createWriteStream(path + PID);
                fileStream.once('open', function(fd) {
                    fileStream.write(bundle);
                    fileStream.end();
                    e.emit('proc#complete', false, PID)
                });
            } catch (err) {
                e.emit('proc#complete', err)
            }

        } else {
            e.emit('proc#complete', new Error('encountered troubles while trying to save Process [ '+ PID +' ] file'))
        }
    };


    /**
     * Get PID
     * @param {string} bundle
     * @return {number} PID
     * */
    self.getPID = function(){

        try{
            return self.PID;
        } catch (err) {
            console.error('[ FRAMEWORK ][ PROC ] Could not get PID for bundle: '+ self.bundle + (err.stack||err.message));
            return null;
        }
    };

    self.getBundleNameByPid = function(pid){

        var list = process.list;

        for (var i=0; i<list.length; ++i) {
            if ( typeof(list[i][pid]) != 'undefined' )
                return list[i][pid]
        }
        return undefined
    };


    self.getPidByBundleName = function(bundle){

        var list = process.pids;

        if ( typeof(list[bundle]) != 'undefined')
            return list[bundle]
        else
            return undefined
    };

    self.setMaster = function(bool){

        if ( typeof(bool) == 'undefined' || bool == true) {
            self.master = true;
        } else {
            self.master = false;
        }
    };

    self.register = function(bundle, pid) {

        if ( bundle == 'gina' || bundle != 'gina' && self.bundles.indexOf(bundle) == -1 ) {

            var list = {};

            var processRegistration = function () {

                if (bundle != 'gina') {
                    self.bundles.push(bundle);
                }


                list['pid']     = pid;
                list['name']    = bundle;

                process.list.push(list);//Running bundles.
                setContext('process.list', process.list);
                process.pids[bundle] = pid;

                list = null;
            };

            if (self.usePidFile) {
                //var path    = pathObj.toString();

                pathObj.mkdir( function(err, path){
                    console.debug('[ FRAMEWORK ][ PROC ] Path created ('+ path +') now saving PID ' + bundle);
                    //save file
                    if (err)
                        console.debug('[ FRAMEWORK ][ PROC ] Found '+ path +': not replacing');

                    if (!err) {
                        self.PID    = self.proc.pid;
                        self.path   = path + pathObj.sep;

                        //Add PID file.
                        setPID(bundle, self.PID, self.proc);
                        save(bundle, self.PID, self.proc);

                        processRegistration()
                    }
                })
            } else {
                processRegistration()
            }
        }
    };

    self.dismiss = dismiss;

    self.onReady = function(cb) {
        e.once('proc#complete', function(err, pid){
            cb(err, pid)
        })
    }

    //init
    if ( typeof(self.bundle) == "undefined" ) {
        console.error('[ FRAMEWORK ][ PROC ] Invalid or undefined proc name . Proc naming Aborted');
        process.exit(1)
    } else {
        init()
    }

    return self
};

module.exports = Proc;