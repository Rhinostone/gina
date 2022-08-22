'use strict';
// Imports

function DefaultContainer(opt, loggers) {
    var self = {
        // flow or container name/id
        name: 'default'
    };
    var loggerHelper    = require(__dirname +'/../../helper.js')(opt, loggers);
    var format          = loggerHelper.format;

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

    function onPayload() {

        process.on('logger#'+self.name, function onPayload(payload) {

            try {
                var payloadObj = JSON.parse(payload);

                // loggerServer.emit('logger#default', JSON.stringify({
                //     group       : payload.group,
                //     level       : payload.level,
                //     // Raw content !
                //     content     : payload.content
                // }));

                process.stdout.write( format(payloadObj.group, payloadObj.level, payloadObj.content, payloadObj.skipFormating) );
            } catch (e) {
                process.stdout.write( format('', '', payload, true) );
            }

        });
    }



    init();
}
module.exports = DefaultContainer;