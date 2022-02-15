'use strict';
/**
 * Gina.Utils.cmd
 * Copyright (c) 2009-2022 Rhinostone <gina@rhinostone.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, extend, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
var cmd = {};
// cmd options
cmd.option = [];


/**
 * Set option
 *
 * @param {array|string} option
 * */
cmd.setOption = function(option) {
    if (option instanceof Array) {
        for (var i=0; i<option.length; ++i) {
            cmd.option[option[i].name] = option[i].content
        }
    } else {
        cmd.option[options.name] = option.content
    }
}

cmd.getString = function() {
    var cmd = process.argv
        .toString()
        .replace(/,/g,' ')
        .replace(/node\s/g, 'gina ');
        //.replace(/node/g, 'gina');    
    
    var cmdArr = cmd.split('/');
    cmd = cmdArr[cmdArr.length-1];
    return cmd
}


/**
 * Get option by name
 *
 * @param {string} name
 *
 * @return {string|object} content
 * */
cmd.getOption = function(name) {
    return cmd.option[name]
}

cmd.getOptions = function() {
    return cmd.option
}


cmd.onExec = function(client, isFromFramework, opt) {
    
    var console = lib.logger;
    cmd.option = opt;
        
    var Proc = require( getPath('gina').lib + '/proc');
    var self = {};

    cmd.msg = require( _(__dirname + '/framework/msg.json') );
    self.isFromFramework = opt.isFromFramework || isFromFramework || false;
    self.isOnlineCommand = opt.isOnlineCommand || false;

    var ignore = function() {

        if (!self.isFromFramework) {
            var m = cmd.msg.default[0].replace("%command%", cmd.getString());
            client.write(m)
        }
    };



    if (self.isFromFramework) {
        
        var init = require('./framework/init')(opt);
        //Framework CMD.
        if (opt.task.action == 'start') {
            init.onComplete( function done(err, run){
                console.debug('loading task ',  opt.task.action);
                
                //Setting master process with its own PID file.                
                cmd.proc = new Proc('gina', process);
                cmd.proc.setMaster(process.pid);

                cmd.proc.onReady( function(err, pid){ //starting others

                    if (!err) {
                        console.debug('[ '+ pid +' ] registered');

                        opt.pid = process.pid;
                        run(opt)
                    } else {
                        console.error(err.stack)
                    }

                })
            })
        } else { // Offline CMD
            init.onComplete( function done(err, run, opt){                
                run(opt)
            })
        }

    } else if (self.isOnlineCommand) {
        var arr = opt.argv[2].split(':');
        if ( typeof(opt.task) == 'undefined' ) {
            opt.task = {}
        }
        opt.task.topic  = arr[0];
        opt.task.action = arr[1];
        
        console.debug('[ FRAMEWORK ] is starting online CLI '+ arr[0] +':'+arr[1]);
        // var hasCmdStarted = false;                    
        // var interval = 1000; // will abort after 5 sec timeout

        // var taskTimeoutId = setInterval(function onTimeout(){
        //     console.debug('[ FRAMEWORK ] has `'+ arr[0] +':'+arr[1] +'` started ? '+ hasCmdStarted);
        //     // if (!gna.started) {
        //     //     abort(new Error('[ FRAMEWORK ] Gina encountered an error when trying to start `'+ (appName || getContext('bunlde')) +'`'))
        //     // }
        // }, interval);  
        // console.debug('[ FRAMEWORK ] starting `'+ arr[0] +':'+arr[1] +'` interval check: #'+ taskTimeoutId);
        
        var init = require('./framework/init')(opt);
        init.onListen( function done(err, run, opt){            
            run(opt, cmd)
        })

    } else {
        ignore()
    }
};

module.exports = cmd