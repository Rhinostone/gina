'use strict';
// Imports
const fs      = require('fs');
// const util                = require('util');
const net     = require('net');
const uuid    = require('uuid');

function MQListener(opt, cb) {
    var self = {
        name: 'MQListener'
    };
    var sessions        = {};
    // tels to the listener when and to whom forward payloads
    var forwardList     = [];
    // will be in memory until the framework is stopped
    // TODO - remove specific `bundle` or `CLI` config when the process is terminated
    var sharedConfig    = { loggers: {}};
    var homedir         = getEnvVar('GINA_HOMEDIR');
    var isLoggedByFile  = false; // by default
    var fileLogsList    = {};
    
        
    function init(opt, cb) {
        setup();
        startMQListener(opt.port, cb);
    }
    
    function setup() {        
        var mainConfigPath  = _(homedir +'/user/extensions/logger/default/config.json', true);
        if ( !new _(mainConfigPath, true).existsSync() ) {
            //throw new Error('Required file not found: '+ mainConfigPath);
            return;
        }
        var mainConfig = requireJSON(mainConfigPath);
        if ( mainConfig.flows.indexOf('file') > -1 ) {
            isLoggedByFile = true;
        }
    }
    
    /**
     * startLogRotator
     * 
     * @param {string} name - `project name` or `hostname`
     * 
     * @returns 
     */
    function startLogRotator(name) {
        
        if ( typeof(fileLogsList[name]) == 'undefined' ) {
            
            fileLogsList[name] = {
                started: false
            }
        }
        
        if (fileLogsList[name].started) {
            return;
        }
        
        //homedir
        var file = name; // by default
        if ( !/^gina$/.test(name) && /\@/.test(name) ) {
            name     = opt.name.split(/\@/)[1];
            file = name;        
        }
        file += '.log';        
        var filename = _(GINA_LOGDIR +'/'+ file);
        var filenameObj = new _(filename);
        if ( !filenameObj.existsSync() ) {
            // create an empty file
            try {
                fs.openSync(filename, 'w')
            } catch (fileErr) {
                throw fileErr
            }
        }
        // default options
        var rotatorOptions = {
            schedule: '5m',
            size: '10m',
            compress: true,
            count: 3
        };
        var rotatorOptionsPath = _(homedir +'/user/extensions/logger/file.json', true);
        if ( new _(rotatorOptionsPath).existsSync() ) {
            try {
                rotatorOptions = merge( requireJSON(rotatorOptionsPath), rotatorOptions );
            } catch (userConfigErr) {
                throw userConfigErr
            }            
        }
        
        
        var rotator = require(__dirname + './../lib/logrotator').rotator;
        // check file rotation every 5 minutes, and rotate the file if its size exceeds 10 mb.
        // keep only 3 rotated files and compress (gzip) them.
        rotator.register(filename, rotatorOptions);

        rotator.on('error', function(err) {
            console.error('[MQListener] log rotation failed: '+ err.stack);
        });

        // 'rotate' event is invoked whenever a registered file gets rotated
        rotator.on('rotate', function(file) {
            console.debug('[MQListener] file ' + file + ' was rotated!');
        });
        
        fileLogsList[name].started = true;
    }
    
    self.report = function(sessionId, payload) {
        //process.stdout.write(  '[MQListener] sending MQSpeaker to `'+ sessionId +'` '+ JSON.stringify(payload) +'\n' );   
        sessions[sessionId].write( JSON.stringify(payload) +'\r\n');
        if ( forwardList.length > 0) {
            var i = -1;
            while ( i < forwardList.length) {
                i++;
                let tailSessionId = forwardList[i];
                if (sessions[tailSessionId]) {
                    if (payload.loggers) {
                        self.tail(tailSessionId, sharedConfig);
                        continue;
                    }
                    self.tail(tailSessionId, payload);
                }   
            }
        }
    }
    
    self.tail = function(sessionId, payload) {
        //process.stdout.write(  '[MQListener] sending tail to `'+ sessionId +'` '+ JSON.stringify(payload) +'\n' );        
        sessions[sessionId].write( JSON.stringify(payload) +'\r\n')
    }
    
    function startMQListener(port, cb) {
        // AbortController is a global object
        const controller = new AbortController();// jshint ignore:line
        var server = net.createServer( function(conn) {//'connection' listener
            
            conn.sessionId = uuid.v4();
            // conn.request = 'report'; // by default
            sessions[conn.sessionId] = conn;
            conn.write(JSON.stringify({ sessionId: conn.sessionId }) +'\r\n' );
            
            //feedback.
            var forwardId = null;
            conn.on('end', function() {
                delete sessions[this.sessionId];
                forwardId = forwardList.indexOf(this.sessionId);
                if ( forwardId > -1 ) {
                    forwardList.splice(forwardId, 1);
                }
                console.debug('[MQListener] (end) client disconected');                
                //process.stdout.write('[MQListener] (end) client disconected\n');
                //conn.end();
            });
            // force exit
            conn.on('exit', function() {
                delete sessions[this.sessionId];
                forwardId = forwardList.indexOf(this.sessionId);
                if ( forwardId > -1 ) {
                    forwardList.splice(forwardId, 1);
                }
                console.info('[MQListener] (exit) client forced to exit');
                //process.stdout.write('[MQListener] (exit) client forced to exit\n');
                //conn.end();
            });

            //Receiving.
            var payloads = null, i = null;
            // do not use console to send data to clients
            conn.on('data', function(data) {
                payloads = data.toString();
                
                // from speakers & tail
                if ( /^(\{\"|\[\{\")/.test(payloads) ) {
                    payloads = payloads.split(/\r\n/g);
                    //console.log(payloads);
                    i = -1; 
                    while(i < payloads.length) { 
                        i++;
                        let payload = payloads[i];
                        if ( /^\{/.test(payload) && /\}$/.test(payload)) {
                            let pl = JSON.parse(payload);
                            
                                                        
                            // mostly after client that acknowledeged sessionId
                            if (!pl.content) {
                                process.stdout.write(  '[MQListener] (undefined content) '+ JSON.stringify(pl, null) +'\n' );
                            }
                            
                            if (pl.loggers) {
                                sharedConfig.loggers = merge(sharedConfig.loggers, pl.loggers);// jshint ignore:line
                            }
                            
                            if (pl.request && !this.request) {
                                this.request = pl.request;
                                if ( this.request == 'tail' && forwardList.indexOf(this.sessionId) < 0 ) {
                                    forwardList.push(this.sessionId)
                                }
                            }
                            else if (!this.request) {
                                // by default
                                this.request = 'report';
                            }
                            
                            
                            
                            if ( this.request && this.sessionId ) {
                                self[this.request](this.sessionId, pl);
                                continue;
                            }
                            
                            // uncatched sessionId - not supposed to get there
                            process.stdout.write(  '[MQListener] '+ pl.content +'\n' );
                        }                        
                    }
                    
                    return
                }
                
                // regular messages
                process.stdout.write(  '[MQListener] '+ payloads +'\n'  );
            });            
            
            conn.on('connect', function(data) {
                console.info( '[MQListener] connect received "'+ data.toString()  +'"' );                
            });
        });


        server.on('error', function(err) {
            if (err.code === 'EADDRINUSE') {
                console.warn('[MQListener] is already running on port [ '+ (err.port || port) +' ]');
            } else {
                console.emerg('[MQListener] Could not start', err.stack)
            }
            
            if (cb) {
                cb(err);
            }
        });
        
        server.listen({
            host: '127.0.0.1',
            port: port,
            signal: controller.signal
          }, function() {
            // Server started.
            console.info('[MQListener] is waitting for speakers on port `'+ port +'`');
            if (cb) {
                cb(false);
            }
        });
    }
    
    init(opt, cb);
}
module.exports = MQListener;