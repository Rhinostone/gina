var fs          = require('fs');
var util        = require('util');
var net         = require('net');

var CmdHelper       = require('./../helper');
var console         = lib.logger;
var LoggerHelper    = require( _(GINA_FRAMEWORK_DIR + '/lib/logger/src/helper.js', true) );

/**
 * Framework tail
 *
 * e.g.
 *  gina framework:tail
 *  or
 *  gina tail
 *
 * */
function Tail(opt, cmd) {
    var self        = {};
    var nIntervId   = null;
    var mqPortFile  = _(GINA_DIR +'/tmp/mq-listener-v'+ GINA_VERSION +'.port', true);

    var init = function(opt, cmd) {
        
        console.debug('Getting framework logs');
        
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });
                        
        // check CMD configuration
        //if (!isCmdConfigured()) return false;
        
        // handle server not started yet or server exited
        process.on('gina#mqlistener-started', function onGinaStarted(mqPort) {
            clearInterval(nIntervId);
            nIntervId = null;
            opt.port = mqPort;
            tail(opt, cmd);
        });
                
        // if (!self.name) {
        //     status(opt, cmd, 0);
        // } else {
            tail(opt, cmd);
        // }        
    }
    
        
    var tail = function(opt, cmd) {
        
        var port = opt.port || 8125;
        var clientOptions = {
            port    : port,
            request : 'tail' 
        }
        var loggerOptions   = console.getOptions();
        var loggers         = console.getLoggers();
        var loggerHelper    = LoggerHelper(loggerOptions, loggers);
        var format          = loggerHelper.format;
        
        var delayedMessages = [];
        var resumeTail = function() {
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
            console.resumeReporting();
            console.info('[MQTail] connected to server :)');            
            
            // send request
            client.write( JSON.stringify(clientOptions) +'\r\n');
            
        });
        client.on('error', (data) => {
            var err = data.toString();
            console.error('[MQTail] ' + err + ' - Gina might not be running');
            console.info('[MQTail] waitting for `MQListener` to be started ...');
            
            var mqPort = null;            
            nIntervId = setInterval(() => {
                try {
                    mqPort = ~~(fs.readFileSync(mqPortFile).toString());
                    if (mqPort) {
                        process.emit('gina#mqlistener-started', mqPort);
                    }
                } catch (fileErr) {}
            }, 100);
        });
        
        var payloads = null, i = null;
        client.on('data', (data) => {
            //console.log('[MQTail]  (data): ' + data.toString());
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
                            process.stdout.write( '[MQTail] (exception) '+ payload +'\n' );
                            continue;
                        }                
                            
                        
                        if (!pl.content) {                            
                            // only for debug
                            // process.stdout.write( '[MQTail] (undefined content) '+ JSON.stringify(pl, null) +'\n' );
                            
                            // updating logger context since it can run on different processes
                            if ( pl.sessionId && !clientOptions.sessionId ) {
                                clientOptions.sessionId = pl.sessionId;
                                // acknowledging
                                client.write( JSON.stringify(clientOptions) +'\r\n');
                            }
                            
                            if (pl.loggers) {
                                loggers = merge(loggers, pl.loggers);
                                if (delayedMessages.length > 0) {
                                    resumeTail()
                                }
                            }                            
                            continue;
                        }
                        
                        // only for debug
                        //process.stdout.write(  '[MQTail] '+ pl.content +'\n' );
                        
                        try {                            
                            process.stdout.write( format(pl.group, pl.level, pl.content) );
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
            console.warn('[MQTail] disconnected from server');
            console.info('[MQTail] waitting for `MQListener` to be started ...');
            var mqPort = null;            
            nIntervId = setInterval(() => {
                try {
                    mqPort = ~~(fs.readFileSync(mqPortFile).toString());
                    if (mqPort) {
                        process.emit('gina#mqlistener-started', mqPort);
                    }
                } catch (fileErr) {}
            }, 100);
        });
        // setInterval(() => {}, 1 << 30);
    }
    

    init(opt, cmd);    
}

module.exports = Tail;