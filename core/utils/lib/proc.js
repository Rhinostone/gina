/* Geena.utils.Proc
 *
 * This file is part of the geena package.
 * Copyright (c) 2013 Rhinostone <geena@rhinostone.com>
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
var logger  = require( _(__dirname + '/logger.js') );

/**
 * @constructor
 *
 * @param {string} bundle
 *
 * */
Proc = function(bundle, proc){

    var _this   = this;
    this.PID    = null;
    this.path   = null;
    this.master = false;
    this.bundle = bundle;
    this.proc   = proc;



    /**
     * Check target path
     * @param {string} path
     * @param {integer} PID Id of the PID to save
     * */

    var init = function(){
        //Default.
        var pathObj = new _(getPath('root') + '/tmp/pid/');
        var path = pathObj.toString();
//        console.log('looking for path ', getPath('root') + "/tmp/pid/" );
//        console.log("init with path ...", path, " - BUNDLE : ", bundle );
//        console.log("about to create PID file under ", path, "["+bundle+"]");
        //Create dir if needed.
        console.log("MKDIR  pathObj (pid:"+_this.proc.pid+") - ", _this.bundle);
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
    };

    var isMaster = function(){
        return (_this.master) ? true : false;
    };

    var setPID = function(bundle, PID, proc){

        if (bundle != 'geena') {
            proc.title = 'geena: '+ bundle;
        } else {
            proc.title = bundle;
        }
        //_this.proc = proc;
        //Set event.
        setDefaultEvents(bundle, PID, proc);
    };

    var setDefaultEvents = function(bundle, PID, proc){


        if ( typeof(PID) != "undefined" && typeof(PID) == "number" ) {
            console.log("setting listeners for ", PID, ':', bundle);

            proc.dismiss = dismiss;
            proc.isMaster = isMaster;

            //proc.stdin.resume();
            proc.stdout.setEncoding('utf8');

            proc.on('SIGTERM', function (){
                console.log("you'r damn right ", PID);
                var path = _(_this.path + PID);
                fs.unlink( path, function(err){
                    //Force when stuck.
                    proc.kill(PID, "SIGKILL");
                });
            });

            proc.on('SIGINT', function (){
                console.log("got exit code ", PID);
                var path = _(_this.path + PID);
                fs.unlink( path, function(err){
                    //Force when stuck.
                    proc.kill(PID, "SIGKILL");
                });
            });

            //Will prevent the server from stopping.
            proc.on('uncaughtException', function(err){
                logger.error('geena', 'FATAL_EXCEPTION:1', 'Special care needed !! ' + err + err.stack);
                //TODO - Send an email to the administrator/dev
            });

            proc.on('exit', function(code){
                console.log("got exit code ", code, PID, " VS ", process.pid);
                var obj = logger.emerg('geena', 'UTILS:EMERG1', 'process exit code ' + code);
                if (_this.env != "debug" /**&& _this.env != "dev" && code != 0*/) {
                    //var cmd = require('geena.utils').Cmd;
                    //cmd.start(opt);
                    //Respawn cmd
                    console.log("Exiting and re spawning !!!");
                }
                dismiss(PID, proc);
            });

            proc.stderr.resume();
            proc.stderr.setEncoding('utf8');//Set encoding.
            proc.stderr.on('data', function(err){
                console.error("found err ", err);
            });
        }
    };

    var dismiss = function(PID, proc){
        var path = _(_this.path + PID);
        fs.unlinkSync(path);
        proc.kill(PID, "SIGKILL");
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

    this.setMaster = function(bool){
        if ( typeof(bool) == 'undefined' || bool == true) {
            _this.master = true;
        } else {
            _this.master = false;
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