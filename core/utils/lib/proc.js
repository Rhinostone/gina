/* Geena.utils.Proc
 *
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
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
var Proc;

//Imports
var fs      = require('fs');
var logger  = require( _(__dirname + '/logger') );
var spawn = require('child_process').spawn;

/**
 * @constructor
 *
 * @param {string} bundle
 *
 * */
Proc = function(bundle, proc, usePidFile){

    var _this   = this;
    this.PID    = null;
    this.path   = null;
    this.master = false;//used only by master.
    this.bundle = bundle;
    this.proc   = proc;
    this.bundles = [];

    if ( typeof(usePidFile) == 'undefined') {
        var usePidFile = true;
    }

    /**
     * Check target path
     * @param {string} path
     * @param {integer} PID Id of the PID to save
     * */

    var init = function(){
        //Default.
        var pathObj = new _( getPath('root') + '/tmp/pid/' );
        var path = pathObj.toString();
//        console.log('looking for path ', getPath('root') + "/tmp/pid/" );
//        console.log("init with path ...", path, " - BUNDLE : ", bundle );
//        console.log("about to create PID file under ", path, "["+bundle+"]");
        //Create dir if needed.
        console.log("MKDIR  pathObj (pid:"+_this.proc.pid+") - ", _this.bundle);

        process.list = (process.list == undefined) ? [] : process.list;
        process.pids = (process.pids == undefined) ? {} : process.pids;

        _this.register(_this.bundle, _this.proc.pid);
        console.log('registring ', _this.proc.pid);
        if (usePidFile) {
            pathObj.mkdir( function(err, path){
                console.log('path created ('+path+') now saving PID ' +  bundle);
                //logger.info('geena', 'PROC:INFO:1', 'path created ('+path+') now saving PID ' +  bundle, __stack);
                //Save file.
                if (!err) {
                    _this.PID = _this.proc.pid;
                    _this.path = path + pathObj.sep;
                    //Add PID file.
                    setPID(_this.bundle, _this.PID, _this.proc);
                    save(_this.bundle, _this.PID, _this.proc);
                }
            });
        }
    };

    var isMaster = function(){
        return (_this.master) ? true : false;
    };
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
    var respawn = function(bundle, env, pid, callback){
        console.log("Exiting and re spawning : ", bundle, env);
        if (env == 'prod') {//won't loop forever for others env.
            // TODO - Count the restarts and prevent unilimited loop
            // TODO - Send notification to admin or/and root to the Fatal Error Page.

            var root = getPath('root');
            try {
                var version = process.getVersion(bundle);
            } catch (err) {
                var bundle = process.argv[3];
                console.log("Bundle ", bundle," already running...");
                dismiss(process.pid);
            }


            var outPath = _(root + '/out.'+bundle+'.'+version+'.log');
            var errPath = _(root + '/out.'+bundle+'.'+version+'.log');
            var nodePath = getPath('node');
            var geenaPath = _(root + '/geena');


            var opt = process.getShutdownConnectorSync();
            //Should kill existing one..
            opt.path = '/'+bundle + '/restart/'+ pid +'/' + env;

            var HttpClient = require('geena.com').Http;
            var httpClient = new HttpClient();

            if (httpClient) {
                //httpClient.query(opt);
                //We are not waiting for anything particular...do we ?
                httpClient.query(opt, function(err, msg){
                    //Now start new bundle.
                    callback(err);
                });
            } else {
                var err = new Error('No shutdown connector found.');
                console.error(err);
                callback(err);
            }
        } else {
            callback(false);
        }
    };

    var setPID = function(bundle, PID, proc){

        if (bundle != 'geena') {
            proc.title = 'geena: '+ bundle;
        } else {
            proc.title = bundle;
        }

        //Set event.
        setDefaultEvents(bundle, PID, proc);
    };

    var setDefaultEvents = function(bundle, PID, proc){


        if ( typeof(PID) != "undefined" && typeof(PID) == "number" ) {
            console.log("setting listeners for ", PID, ':', bundle);

            proc.dismiss = dismiss;
            proc.isMaster = isMaster;


            proc.on('SIGTERM', function(code){
                proc.exit(code);
            });

            proc.on('SIGINT', function(code){

                if (code == undefined) var code = 0;
                console.log("got exit code ", code, process.list);
                proc.exit(code);//tigger exit event.
            });

            //Will prevent the server from stopping.
            proc.on('uncaughtException', function(err){

                logger.exception('geena', 'FATAL_EXCEPTION:1', 'Special care needed !! ' + err + err.stack, function(err){
                    //TODO - Send an email to the administrator/dev
                    //TODO - Have a delegate handler to allow the dev to do its stuff. Maybe it's already there if any dev can override.
                    console.log('Fix your shit...');
                });
                console.log(err.stack);
                var bundle = process.argv[3];
                var pid = _this.getPidByBundleName(bundle);

                var env =  process.env.NODE_ENV || 'prod';
                //Wake up buddy !.
                respawn(bundle, env, pid, function(err){
                    proc.exit(1);
                });

            });

            proc.on('exit', function(code){

                if ( typeof(code) == 'undefined') {
                    code = 0;
                }

                var bundle = process.argv[3];
                console.log("@=>", _this.args);
                var pid = _this.getPidByBundleName(bundle);
                var env =  process.env.NODE_ENV || 'prod';
                console.log('bundle ', bundle, ' vs ', pid, " => ", process.pid);

                //console.log("got exit code ", "("+code+")", pid, " VS ", pid, " <=> geena: ", process.pid);
                //code = code || 0;
                //var obj = logger.emerg('geena', 'UTILS:EMERG1', 'process exit code ' + code);
                //if (code == 0  && env != "debug" && env != "dev"/***/) {
                    // First child.
                    dismiss(pid);
                    // Then master.
                    dismiss(process.pid);
                //}
            });

            proc.on('SIGHUP', function(code){
                console.log("Hanging up !", process.argv);

                var bundle = process.argv[3];
                var env =  process.env.NODE_ENV || 'prod';
                var pid = _this.getPidByBundleName(bundle);

                dismiss(pid);
                dismiss(process.pid);
            });

//            proc.stderr.resume();
//            proc.stderr.setEncoding('utf8');//Set encoding.
//            proc.stderr.on('data', function(err){
//                console.error("found err ", err);
//            });
        }
    };




    var dismiss = function(pid){
        if (pid == undefined) {
            var pid = _this.PID;
        }
        var bundleName = _this.getBundleNameByPid(pid);
        var path = _(_this.path + pid);
        try {
            fs.unlinkSync(path);
        } catch (err) {
            console.log('Final : ', err.stack)
            //Means that it does not exists anymore.
        }
        try {
            if (bundleName != undefined) {
                fs.unlinkSync( _(getPath('mountPath') + '/' + bundleName) );
            }
        } catch (err) {
            console.log('Final : ', err.stack)
            //Means that it does not exists anymore.
        }

        process.kill(pid, "SIGKILL");
    };

    /**
     * Save PID file
     * @param {string} bundle
     * @param {integer} PID Id of the PID to save
     *
     * @private
     * */
    var save = function(){
        var bundle = _this.bundle;
        var PID = _this.PID;
        var proc = _this.proc;
        var path = _this.path
        //Get PID path.
        if (
            typeof(bundle) != "undefined" && bundle != ""
            && typeof(PID) != "undefined" && PID != "" && PID != null
            && typeof(proc) != "undefined" && proc != "" && proc != null
        ) {
            var fileStream = fs.createWriteStream(path + PID);
            fileStream.once('open', function(fd) {
                fileStream.write(bundle);
                fileStream.end();
            });
        }
    };


    /**
     * Get PID
     * @param {string} bundle
     * @return {number} PID
     * */
    this.getPID = function(){

        try{
            return _this.PID;
        } catch (err) {
            logger.error(
                'geena',
                'UTILS:PROC:ERR:2',
                'Could not get PID for bundle: '+ _this.bundle,
                __stack
            );
            return null;
        }
    };

    this.getBundleNameByPid = function(pid){
        var list = process.list;

        for (var i=0; i<list.length; ++i) {
            console.log("list ", list, ':',  list[i][pid]);
            if ( typeof(list[i][pid]) != "undefined")
                return list[i][pid]
        }
        return undefined
    };

    this.getPidByBundleName = function(bundle){
        var list = process.pids;
        console.log("list ", list, ':',  list[bundle]);
        if ( typeof(list[bundle]) != "undefined")
            return list[bundle]
        else
            return undefined
    };

    this.setMaster = function(bool){
        if ( typeof(bool) == 'undefined' || bool == true) {
            _this.master = true;
        } else {
            _this.master = false;
        }
    };

    this.register = function(bundle, pid) {
        if ( bundle == 'geena' || bundle != 'geena' && _this.bundles.indexOf(bundle) == -1 ) {
            if (bundle != 'geena') {
                _this.bundles.push(bundle);
            }

            var list = {};
            list[pid] = bundle;
            process.list.push(list);//Running bundles.
            process.pids[bundle] = pid;

            list = null;
        }
    };

    //Init.
    if ( typeof(this.bundle) == "undefined" ) {
        logger.warn(
            'geena',
            'UTILS:PROC:WARN:1',
            'Invalid or undefined proc name . Proc naming Aborted',
            __stack
        );
    } else {
        init();
    }
};

module.exports = Proc;