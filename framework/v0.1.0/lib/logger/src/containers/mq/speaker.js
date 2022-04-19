'use strict';
// Imports
var net = require('net');
// var fs                  = require('fs');
// var util                = require('util');

function MQSpeaker(opt, loggers, cb) {
    var self = {
        name: 'MQSpeaker'
    };
    //var loggerHelper    = require(__dirname +'/../../helper.js')(opt, loggers);
    //var format          = loggerHelper.format;
    
    
    
    function init(opt, cb) {
        // var argv = process.argv;
        // for (let i = 0, len = argv.length; i < len; i++) {
        //     if (/(prepare|prepare_version|postgina\/\/bin\/\/gina)$/.test(process.argv[1])) {
                
        //         return;
        //     }
        // }            
        return startMQSpeaker(opt, cb);
        
    }
    
    
    function startMQSpeaker(opt, cb) {
        
        var clientOptions = {
            port    : opt.port,
            request : 'report'
        };
        var client = net.createConnection(clientOptions, () => {
            // 'connect' listener.            
            // send request            
            client.write( JSON.stringify(clientOptions) +'\r\n');
                        
            console.info('MQSpeaker connected to server :) ');
            
            if (cb) {
                cb(false, client)
            }
        });
        client.on('error', (data) => {
            var err = data.toString();            
            if (cb) {
                return cb(err)
            }
            console.debug(' => ', process.argv);
            console.error('[MQSpeaker]  (error): ' + err);
            
            // process.emit('logger#'+self.name, JSON.stringify({
            //     group       : opt.name,
            //     level       : 'error',
            //     // Raw content !
            //     content     : '[MQSpeaker]  (error): ' + err
            // }));
        });
        
        var payloads = null, i = null;
        client.on('data', (data) => {
            //console.log('[MQSpeaker]  (data): ' + data.toString());
            payloads = data.toString();
                
            // from speakers & tail
            if ( /^(\{\"|\[\{\")/.test(payloads) ) {
                payloads = payloads.split(/\r\n/g);
                //console.log(payloads);
                i = -1; 
                while(i < payloads.length) { 
                    i++;
                    let payload = payloads[i];
                    if ( 
                        /^\{/.test(payload) && /\}$/.test(payload)
                        || /^\[\{/.test(payload) && /\}\]$/.test(payload) 
                    ) {
                        let pl = null;
                        try {
                            pl = JSON.parse(payload);
                        } catch(plErr) {
                            process.stdout.write(  '[MQSpeaker] (exception) '+ payload +'\n' );
                            continue;
                        }
                        
                        
                        if ( pl.sessionId && !clientOptions.sessionId ) {
                            // configuring
                            clientOptions.sessionId = pl.sessionId;
                            clientOptions.loggers = loggers;
                            
                            // acknowledging
                            client.write( JSON.stringify(clientOptions) +'\r\n');
                        }
                        
                        if (!pl.content) {
                            // debug only
                            //process.stdout.write(  '[MQSpeaker] (undefined content) '+ JSON.stringify(pl, null) +'\n' );
                            continue;
                        }
                        
                        // debug only when starting the framework with: ./bin/cli start >/usr/local/tmp/gina-smaple.log 2>&1
                        // process.stdout.write(  '[MQSpeaker] '+ pl.content +'\n' );
                    }                        
                }
                
                return
            }
            
            // regular messages
            process.stdout.write(  '[MQSpeaker] '+ payloads +'\n'  );
            
        });
        client.on('end', () => {
            console.log('[MQSpeaker] disconnected from server');
        });
        
        return client;
    }   
    
    
    return init(opt, cb);
}
module.exports = MQSpeaker;