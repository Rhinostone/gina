/* Geena.Utils.Logger
 *
 * This file is part of the geena package.
 * Copyright (c) 2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * TODO
 * Log module name, function name and line of th call
 * */

var fs      = require('fs'),
    Winston = require('winston'),
    Logger  = {
    location : null,
    paths : [],
    ext: 'log',
    custom : {
        //Must always be the first. Sadly, it's a bug.
        levels : {
            info    : 0,
            emerg   : 1,
            alert   : 2,
            crit    : 3,
            err     : 4,
            warn    : 5,
            notice  : 6,
            debug   : 7,
            trace   : 8
        },
        colors : {
            info    : 'blue',
            emerg   : 'magenta',
            alert   : 'red',
            crit    : 'magenta',
            err     : 'orange',
            warn    : 'yellow',
            notice  : 'black',
            debug   : 'cyan',
            trace   : 'yellow'
        }
    },
    init : function(){

        var _this = this;
        var paths = arguments[0];
        if (paths != undefined && paths != '') {
            this.paths = paths;
            //console.log("paths & core :\n",  paths, paths.core);
            try {
                var conf = require(paths.core + '/template/conf/env.json');
                this.defConf = conf;
            } catch (err) {
                this.error('geena', 'LOGGER:ERR:1', err.Error);
                return false;
            }

            if( typeof(this.env) == "undefined" ) {
                this.setEnv(this.defConf.registeredEnvs[3]);//Supposed to be prod.
            } else if (!this.isRegisteredEnv(this.env)) {
                console.log("Env not registered : " + this.env);
                console.log("Try one of these : ",
                    this.defConf.registeredEnvs.toString().replace(/,/g,", ")
                );
                process.exit(1);//If no valid env.
                //process.stdin.write('SIGINT');
            }

            this.levels = this.defConf.logLevels;
        } else {
            this.paths['logs'] = './logs';
        }

        //Creating env folder.
        var loggerCreate = new _(this.paths.logs +'/'+ this.env);
        console.log("MKDIR loggerCreate");
        loggerCreate.mkdir( function(err, path){
            if (err) {
                _this.error('geena', 'LOGGER:ERR:8', err, __stack);
            }
        });
    },
    setEnv : function(env){
        this.env = env;
    },
    getEnv : function(){
        return this.env;
    },
    isRegisteredEnv : function(env){
        return (this.defConf.registeredEnvs.inArray(env)) ? true : false;
    },
    debug : function(){//logger, label, msg, explicit.
        var env = this.getEnv(), _this = this;

        if (env == "debug") {
            this.getMsg("debug", arguments, function(err, msg){
                if (err)
                    _this.error('geena', 'LOGGER:ERR:5', msg, __stack);

                _this.save(msg);
            });
        }
    },
    info : function(){//logger, label, msg, explicit.
        var env = this.getEnv(), _this =  this;
        if (env == "dev" || env == "debug") {

            this.getMsg("info", arguments, function(err, msg){
                if (err)
                    _this.error('geena', 'LOGGER:ERR:2', msg);

                _this.save(msg);
            });
        }
    },
    notice : function(){//logger, label, msg, explicit.
        var env = this.getEnv(),_this =  this;
        if (env == "dev" || env == "debug") {
            this.getMsg("notice", arguments, function(err, msg){
                if (err)
                    _this.error('geena', 'LOGGER:ERR:7', msg);

                _this.save(msg);
            });
        }
    },
    warn : function(){
        var _this =  this;
        this.getMsg("warn", arguments, function(err, msg){
            if (err)
                _this.error('geena', 'LOGGER:ERR:3', msg);

            _this.save(msg);
        });
    },
    error : function(){
        var _this =  this;
        this.getMsg("err", arguments, function(err, msg){
            if (err)
                _this.error('geena', 'LOGGER:ERR:4', msg);

            _this.save(msg);
        });
    },
    exception : function(){
        var _this = this;
        for (a in arguments) {
            if ( typeof(arguments[a]) == 'function' ) {
                var callback = arguments[a];
            }
        }
        this.getMsg("exception", arguments, function(err, msg){
            if (err)
                _this.error('geena', 'LOGGER:ERR:6', msg);
            if ( typeof(callback) != 'undefined') {
                _this.save(msg, callback);
            } else {
                _this.save(msg);
            }
        });

    },
    emerg : function(){
        var _this = this;
        this.getMsg("emerg", arguments, function(err, msg){
            if (err)
                _this.error('geena', 'LOGGER:ERR:7', msg);
            else
                _this.save(msg);

        });
    },
    getMsg : function(level, args, callback){
        var level       = level,
            msg         = {},
            logger      = args[0],
            label       = args[1],
            explicit    = (typeof(args[2]) != undefined) ? args[2] : null,
            stack       = (typeof(args[3]) != undefined) ? '\n[STACK] :\n'+  args[3] : null
        ;
        //If you have: TypeError: Converting circular structure to JSON
        //Means that the caller method method did not properly set arguments.
        try {

            explicit = JSON.stringify(args[2]).replace(/{/g , '[').replace(/}/g, ']');

        } catch (err) {
            explicit = args[2] + err;
        }

        //console.log("explicite message over ", stack);
        msg = {
            "logger" : logger,
            "label" : label,
            "level" : level,
            "profile" : this.getEnv(),
            "message" : label,
            //"explicit" : explicit
            "explicit" : (this.env == "debug" || this.env == "dev" && level == 'error') ? explicit + stack.replace(/,/g, "\n") + "\n" : explicit
        };

        if (logger != undefined && label != undefined) {
            callback(false, msg);
        } else {
            callback(true, "Missing logger or label");
        }

    },
    getIdByLevel : function(level){
        return this.level[level].length;
    },
    /**
     * Set logs path
     * @param {string} logger Logger application
     * @return {string} path Return logger path
     * */
    getPath : function(logger, callback){

        var loggerCreate = new _(this.paths.logs +'/'+ this.env +'/'+ logger);
        //if exists, return.
        loggerCreate.mkdir( function(err, path){
            if (!err) {
                callback(false, path);
            } else {
                callback("Could not create folder: " + path, path);
            }
        });
    },

    /**
     * Get filename
     * @param {string} alias - Application name
     * @return {string} filename - Return logger filename
     * */
    getFilename : function(alias){
        return alias + '.' + this.ext;
    },

    /**
     * Save log message
     * @param {object} msg Json Object
     *
     * @callback [callback]
     * @param {boolean|string} err
     * */
    save : function(msg, callback){

        var _this = this;
        //Will also create if do not exists.
        this.getPath(msg.logger, function(err, path){

            if (err) {
                console.error(err.stack||err.message);
            } else {
                // console.log("level ", msg.level);

                //Sudden exit.
                if (msg != undefined && msg.logger != undefined) {
                    //console.log("writting error now ", msg.logger);
                    //Winston will create it if absent.
                    var filename =  path +'/'+ _this.getFilename(msg.logger);

                    if (msg.label == 'UTILS:PATH:DEBUG:1') msg.explicit = 'null';

                    //console.log('\ngoing once ['+ msg.label+']: ', msg.explicit);
                    //Sending message.

//                    process.stdout.write(
//                        '[LOG]' + JSON.stringify({
//                            "filename" : filename,
//                            "env" : _this.getEnv(),
//                            "msg" : msg
//                        }) + "\n",
//                        'utf8'
//                    );

                    log(msg.explicit + "\n");

                    //Important !
                    msg = {};
                }

                if ( typeof(callback) == 'function') {
                    callback(false)
                }
            }
        });


    },//EO Save.

    onMessage : function(data, callback){
        //console.log("spreading once ", data);
        var prefix = null,
            _this = this,
            str = (data instanceof String)
                ? data
                : data.toString();
        //Define your cases.
        var logStr = str.match(/\[LOG/g);
        if (logStr) prefix = "[LOG]";


        if (!prefix) {
            //You should write here.
            var str = data.toString();
            var lines = str.split(/(\r?\n)/);
            callback(lines.join("") + '\r\n');
        }

        switch (prefix) {

            case '[LOG]':
                var trace = null, lg = str.split(/\[LOG\]/);
                //console.log("tracing ", lg);

                for (var i =0; i<lg.length; ++i) {
                    //Avoid empty or non-json string.
                    if (lg[i] && lg[i].match(/{"filename"/) ) {

                        var found = lg[i].match(/"}}/g).length;
                        var f = lg[i].substring(lg[i].indexOf('{"filename"'), lg[i].indexOf("\"}}") + 3);
                        //Just trace the res of it !.
                        //console.log(f.length +" VS "+ lg[i].length);
                        if (f.length != lg[i].length && f.length >0) {
                            //console.log("FOUND TRACE IN ["+ lg[i] + "]");
                            trace = lg[i].substring(f.length);
                            lg[i] = f;
                            //found = 1;
                            //console.log("=====> "+ trace);
                        } else {
                            lg[i] = lg[i].substring(lg[i].indexOf('{"filename"'));
                        }
                        //console.log("LEN: ", lg[i].length, " VS ", f.length);
                        //console.log("STRING ", lg[i]);
                        if (found == 1) {
                            //lg[i] = lg[i].substring(lg[i].indexOf('{'), lg[i].lastIndexOf('"}}') + 3);
                            //console.log("=====> "+ JSON.parse(lg[i]) );
                            try {

                                var obj = JSON.parse(lg[i]);

                                var filename = obj.filename,
                                    env = obj.env,
                                    msg = obj.msg,
                                    out = "";


                                out = ( typeof(msg.explicit) != 'undefined'
                                        && msg.explicit != '')
                                    ? msg.explicit
                                    : msg.message;

                                var logger = getContext('geena.utils.logger');


                                //F...ing Winston....
                                msg.level = (msg.level == "err")
                                            ? "crit"
                                            : msg.level;

                                //Write now.

                                //Output the trace.
                                if (trace != null && trace != "") {
                                    //console.log("out ?? ", out);
                                    //logger["trace"](trace);
                                    logger[msg.level](out);
                                    trace = null;
                                } else if (msg.level == "emerg") {
                                    logger[msg.level](out);
                                    process.exit(1);
                                } else {
                                    //logger[msg.level](out);
                                    log(out);
                                }
                            } catch(err) {
                                //Check if level exists.
                                callback('WEIRD CASE' + lg[i] + "\n" + err.stack);//for the console print out.
                                process.exit(1);
                            }
                        } else {
                            //Migth be useless now...
                            try {
                                //console.log("trying ", lg[i]);
                                var out = JSON.parse(lg[i]).msg.explicit;
                                callback(out);
                            } catch (err) {
                                callback("BIG FAILURE... wachtout for your json output thru console.log during Runtime: " + err);
                            }

                        }
                    } else {
                        //Would be console.log() calls most of the time.
                        var c = str.split(/\[LOG\]/),
                            p = "",
                            r = {};

                        //Sometimes, you can get grouped infos.
                        for (var s=0; s<c.length; ++s) {
                            p = c[s].substring(c[s].lastIndexOf('}') + 1);
                            r = p.split(/(\r?\n)/);

                            for (var m=0; m<r.length; ++m) {
                                if (typeof(r[m]) != 'undefined' && r[m] != '' && r[m] != '\n' && r[m] != '\r' && r[m] != '\r\n') {
                                    p[m] = p[m].trim();
                                    //console.log("\r\n opps rool back quick [."+ r[m] + ".]", typeof(r[m]), ' surprise : ', r[m]);
                                    callback(r[m]);
                                    //break;
                                }
                            }

                        }//EO for.
                    }
                }

                break;

        }//EO Switch.
    }
};
module.exports = Logger;