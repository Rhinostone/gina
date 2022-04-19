'use strict';
// Imports
var fs                  = require('fs');
var util                = require('util');
var net                 = require('net');
// var promisify           = util.promisify;
// const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// const { execSync }      = require('child_process');


var merge = require('../../merge');

function FileContainer(opt, loggers) {
    var self = {
        // flow or container name/id
        name: 'file' 
    };
    
    //var defaultOptions = ;
    
    var loggerHelper    = require(__dirname +'/../../helper.js')(opt, loggers);
    var format          = loggerHelper.format;
    var delayedMessages = [];
    
    
    
    
    function init() {
        
        onPayload();
        // ----------------------------Debug---------------------------------------
        var level = 'debug';
        // Init debugging - Logs not in hierarchy will just be ignored
        if (opt.hierarchies[opt.hierarchy].indexOf( opt.levels[level].code) > -1) {
            process.emit('logger#'+self.name, JSON.stringify({
                group       : opt.name,
                level       : level,
                // Raw content !
                content     : '`'+ self.name +'` logger container loaded !'
            }));
        }
        // ------------------------------------------------------------------------
    }
    
    // function onPayload() {   
    //     process.on('logger#'+self.name, function onPayload(payload) {
            
    //         payload = JSON.parse(payload);
            
    //         // loggerServer.emit('logger#default', JSON.stringify({
    //         //     group       : payload.group,
    //         //     level       : payload.level,
    //         //     // Raw content !
    //         //     content     : payload.content
    //         // }));
            
    //         process.stdout.write( format(payload.group, payload.level, payload.content) );
    //     });
    // }
    
    function onPayload() {
        var port = 8125;
        var clientOptions = {
            port    : port,
            request : 'wrtie' 
        }
        // var loggerOptions   = console.getOptions();
        // var loggers         = console.getLoggers();
        // var loggerHelper    = LoggerHelper(loggerOptions, loggers);
        // var format          = loggerHelper.format;
        
        
        
        
        var delayedMessages = [];
        var resume = function() {
            var i = 0;
            while (i < delayedMessages.length) {
                let pl = delayedMessages[i];
                
                process.stdout.write( format(pl.group, pl.level, pl.content) );
                i++;
            }
            delayedMessages = []
        }
        
        
        var client = net.createConnection(clientOptions, () => {
            // 'connect' listener.
            console.info('MQLog connected to server :)');            
            
            // send request
            client.write( JSON.stringify(clientOptions) +'\r\n');
            
        });
        client.on('error', (data) => {
            var err = data.toString();
            console.error('[MQLog]  (error): ' + err);
        });
        
        var payloads = null, i = null;
        client.on('data', (data) => {
            //console.log('[MQLog]  (data): ' + data.toString());
            payloads = data.toString();
                
            // from speakers
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
                            process.stdout.write( '[MQLog] (exception) '+ payload +'\n' );
                            continue;
                        }                
                            
                        
                        if (!pl.content) {                            
                            // only for debug
                            // process.stdout.write( '[MQLog] (undefined content) '+ JSON.stringify(pl, null) +'\n' );
                            
                            // updating logger context since it can run on different processes
                            if ( pl.sessionId && !clientOptions.sessionId ) {
                                clientOptions.sessionId = pl.sessionId;
                                // acknowledging
                                client.write( JSON.stringify(clientOptions) +'\r\n');
                            }
                            
                            if (pl.loggers) {
                                loggers = merge(loggers, pl.loggers);
                                if (delayedMessages.length > 0) {
                                    resume()
                                }
                            }                            
                            continue;
                        }
                        
                        // only for debug
                        //process.stdout.write(  '[MQLog] '+ pl.content +'\n' );
                        
                        try {                            
                            write( format(pl.group, pl.level, pl.content) );
                            
                        } catch (writeErr) {
                            // means that the related MQSpeaker is not connected yet
                            // this can happen during `bundle:start` configuration
                            // we'll then delay the output until MQSpeaker is ready
                            delayedMessages.push(pl);
                        }
                        
                    }                        
                }                
            }
            
        });
        client.on('end', () => {
            console.log('[MQLog] disconnected from server');
        });
        // setInterval(() => {}, 1 << 30);
    }
    
    function write(path, content) {
        
    }
    
    
    
    init();
}
module.exports = FileContainer;