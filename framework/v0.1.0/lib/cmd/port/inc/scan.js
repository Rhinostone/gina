var net = require('net');
var console     = lib.logger;
/**
 * Scan for available port between ranges
 *
 * @param {object} [opt]
 *
 * @callback cb
 *  @param {object|bool} err
 *  @param {array} ports
 * */
module.exports = function scan(opt, cb){

    var defaultOptions = {
        host: '127.0.0.1', // default binding for localhost
        start: 3100,
        end: 10000,
        timeout: 2000,
        ignore: [],
        len: 1
    };


    if ( arguments.length < 2 ) {

        var cb      = opt
            , opt   = defaultOptions
        ;

    } else {
        opt = merge(opt, defaultOptions)
    }

    console.debug('scan init with options: ', opt);

    var self    = opt
        , port  = self.start
        , ports = []
        , count = 1
    ;

    var find = function(port) {

        if (port.length > self.end) { // not available port found
            cb(new Error('No available port found'))
        }

        if ( opt.ignore.length > 0 && opt.ignore.indexOf( port ) > -1 ) {

            ++port;
            find(port)
        } else {
            // checking port
            var s = new net.Socket();
            // just in case
            s.setTimeout(opt.timeout, function() {
                s.destroy();
            });

            // port is taken / already opened
            s.connect(port, self.host, function() {
                s.destroy();
                ++port;
                find(port)
            });

            // No one is listening ... port is available
            s.on('error', function(e) {
                // silently catch all errors - assume the port is closed
                s.destroy();

                if ( /ECONNREFUSED/.test(e.message) ) {

                    if ( !opt.ignore.length || opt.ignore.length > 0 && opt.ignore.indexOf( port ) == -1 ) {
                        console.debug('available port found ', port);
                        ports.push(port);
                        --opt.len;
                    }

                    if (opt.len <= 0) {
                        cb(false, ports)
                    } else {
                        ++port;
                        find(port)
                    }

                } else {

                    ++port;
                    find(port)
                }
            })
        }
    };

    find(port)
}