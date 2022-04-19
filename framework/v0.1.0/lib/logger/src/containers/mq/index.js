'use strict';
// Imports
var fs          = require('fs');
var net         = require('net');
var util        = require('util');
var promisify   = util.promisify;

function MqContainer(opt, loggers) {
    var self = {
        // flow or container name/id
        name: 'mq' 
    };
    
    // TODO - get options like the `port` from: ~/.gina/user/extensions/logger/main.json
    
    var MQSpeaker       = require('./speaker.js'); 
    var mqSpeaker       = new MQSpeaker({ name: opt.name, port: 8125 }, loggers);    
    
    function init() {
        onPayload()
        
        // ------------------------------------------------------------------------
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
    
    function onPayload() {   
        process.on('logger#'+self.name, function onPayload(payload) {                        
            if ( !loggers[opt.name]._options.isReporting ) {
                return;
            }            
            if (mqSpeaker.write) {
                mqSpeaker.write( payload +'\r\n' );
            }
            
        });
    }
    
    init();
}
module.exports = MqContainer;