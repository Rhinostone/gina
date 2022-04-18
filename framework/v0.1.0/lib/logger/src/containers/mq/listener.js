'use strict';
// Imports
var net     = require('net');
var uuid    = require('uuid');
// var fs                  = require('fs');
// var util                = require('util');
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
    
    
    function init(opt, cb) {        
        startMQListener(opt.port, cb);
    }    
    
    self.report = function(sessionId, payload) {
        //process.stdout.write(  '[ MQListener ] sending MQSpeaker to `'+ sessionId +'` '+ JSON.stringify(payload) +'\n' );   
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
        //process.stdout.write(  '[ MQListener ] sending tail to `'+ sessionId +'` '+ JSON.stringify(payload) +'\n' );        
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
                console.debug('[ MQListener ] (end) client disconected');                
                //process.stdout.write('[ MQListener ] (end) client disconected\n');
                //conn.end();
            });
            // force exit
            conn.on('exit', function() {
                delete sessions[this.sessionId];
                forwardId = forwardList.indexOf(this.sessionId);
                if ( forwardId > -1 ) {
                    forwardList.splice(forwardId, 1);
                }
                console.info('[ MQListener ] (exit) client forced to exit');
                //process.stdout.write('[ MQListener ] (exit) client forced to exit\n');
                //conn.end();
            });

            //Receiving.
            var payloads = null, i = null;
            // do not use console to send data to clients
            conn.on('data', async function(data) {
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
                                process.stdout.write(  '[ MQListener ] (undefined content) '+ JSON.stringify(pl, null) +'\n' );
                            }
                            
                            if (pl.loggers) {
                                sharedConfig.loggers = await merge(sharedConfig.loggers, pl.loggers);
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
                            
                            
                            
                            if ( this.request && this.sessionId) {
                                self[this.request](this.sessionId, pl);
                                continue;
                            }
                            
                            // uncatched sessionId - not supposed to get there
                            process.stdout.write(  '[ MQListener ] '+ pl.content +'\n' );
                        }                        
                    }
                    
                    return
                }
                
                // regular messages
                process.stdout.write(  '[ MQListener ] '+ payloads +'\n'  );
            });            
            
            conn.on('connect', function(data) {
                console.info( '[ MQListener ] connect received "'+ data.toString()  +'"' );                
            });
        });


        server.on('error', function(err) {
            if (err.code === 'EADDRINUSE') {
                console.warn('[ MQListener ] is already running on port [ '+ (err.port || port) +' ]');
            } else {
                console.emerg('[ MQListener ] Could not start', err.stack)
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
            console.info('[ MQListener ] is waitting for speakers on port `'+ port +'`');
            if (cb) {
                cb(false);
            }
        });
    }
    
    init(opt, cb);
}
module.exports = MQListener;