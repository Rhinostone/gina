var net     = require('net');
var console = lib.logger;
/**
 * Scan for available port between ranges
 *
 * @param {object} [opt]
 *
 * @callback cb
 *  @param {object|bool} err
 *  @param {array} ports
 * */
module.exports = function Scanner(opt, cb){

    var defaultOptions = {
        // default binding for localhost
        // remote scan can be added later if needed (e.g: for remote setup)
        host: 'localhost',
        startFrom: null,
        start: 3100,
        // max 65535, but user assigned == 49151 - see [RFC6335](https://www.rfc-editor.org/rfc/rfc6335.html)
        end: null,
        maxEnd: 49151,
        timeout: 2000,
        ignore: [],
        limit: 1
    };

    if ( arguments.length < 2 ) {
        console.warn('no options defined for your scan');
        cb  = opt;
        opt = defaultOptions;
    } else {
        opt = merge(opt, defaultOptions)
    }
    if (opt.startFrom) {
        opt.startFrom = ~~opt.startFrom;
        if (opt.start < opt.startFrom ) {
            opt.start = opt.startFrom;
        }
    }
    opt.end = (~~(opt.start)+899) // shouldn't it be opt.limit+1 ?

    // just in caes
    opt.end = ~~(opt.end);
    opt.ignore.sort();

    console.debug('scan init with options: ', opt);

    var self    = opt
        , port  = ~~self.start
        , ports = []
        , total = ~~opt.limit
    ;

    var find = function(port) {

        if (port > self.end) { // not available port found
            console.warn('found '+ ports.length +'/'+ total);
            var err = new Error('maximum port number reached: '+ self.end);
            cb(err);
            return;
        }

        // skip port present in the `ignore list`
        if ( opt.ignore.length > 0 && opt.ignore.indexOf( port ) > -1 ) {
            port++;
            return find(port);
        }

        // creating socket
        var s = new net.Socket();

        // starting connection
        s.connect(port, self.host);

        // just in case
        s.setTimeout(opt.timeout);
        s.on('timeout', function() {
            var err = new Error(self.timeout +' timeout reached');
            s.destroy(err);
            cb(err)
        });


        // No one is listening ... port is available
        s.on('error', function(err) {
            s.destroy();
            // silently catch all errors - assume the port is closed => available for use
            if ( /ECONNREFUSED/i.test(err.message) ) {
                if ( !opt.ignore.length || opt.ignore.length > 0 && opt.ignore.indexOf( port ) == -1 ) {
                    // ports.push(''+port);
                    ports.push(port);
                    ports.sort();
                    console.debug('available port found '+ port +' ['+ ports.length +'/'+ total +']');
                    opt.limit--;
                }

                if (opt.limit <= 0) {
                    cb(false, ports);
                } else {
                    port++;
                    find(port);
                }
                return;
            } else if (err) {
                // error not handled - not connection to the network ?
                console.warn('exeption not handled: '+ err);
                cb(err);
                return;
            }
        });

        // if connection is made, this only means that service is using it
        s.on('connect', function() {
            s.destroy();

            port++;
            find(port);
        })
    };

    find(port)
}