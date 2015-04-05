'use strict';
/**
 * Gina.Utils.cmd
 * Copyright (c) 2014 Rhinostone <gina@rhinostone.com>
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
        .replace(/node/g, 'gina');

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
    cmd.option = opt;
    var Proc = require( getPath('gina.lib') + '/proc');
    var self = this;
    var ignore = function() {

        if (!self.isFromFramework) {
            var m = self.msg.default[0].replace("%command%", cmd.getString());
            client.write(m)
        }
    };

    cmd.msg = require( _(__dirname + '/msg.json') );
    this.isFromFramework = isFromFramework;


    if (self.isFromFramework) {
        var init = require('./framework/init')(opt);

        //Starting framework and default services.
        if (opt.task.action == 'start') {
            init.onComplete( function done(err, run){
                console.debug('loading opt ',  opt.task.action);
                //Setting master process and starting with PID file.
                cmd.proc = new Proc('gina', process);
                cmd.proc.setMaster(process.pid);
                cmd.proc.onReady( function(){
                    run(opt)
                })
            })
        } else { // CMD
            init.onComplete( function done(err, run, opt){
                //Starts without PID file.
                //cmd.proc = new Proc('cmd', process, false);
                //cmd.proc.onReady( function(){

                    run(opt)
                //})
            })
        }

    } else {
        ignore()
    }
};

module.exports = cmd