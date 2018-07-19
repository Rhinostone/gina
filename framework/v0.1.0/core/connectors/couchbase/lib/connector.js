var fs              = require('fs');
var util            = require('util');
var EventEmitter    = require('events').EventEmitter;
var couchbase       = require('couchbase');
var gina            = require('../../../../core/gna');
var utils           = gina.utils;
var console         = utils.logger;
var merge           = utils.merge;
var modelUtil       = new utils.Model();

//globalized
N1qlQuery           = couchbase.N1qlQuery;
N1qlStringQuery     = couchbase.N1qlStringQuery;
ViewQuery           = couchbase.ViewQuery;
uuid                = require('uuid');


/**
 * Connector
 *
 * Options :
 *  - keepAlive
 *      if set to `true`, will ping based on `pingInterval`
 *      if set to `false`, will not ping the database server
 *  - pingInterval
 *      `30s` will set the ping interval to 30 seconds
 *      `1m` will set the ping interval to 1 minute
 *      `1h` will set the ping interval to 1 hour
 *      `1d` will set the ping interval to 1 day
 *
 * @class
 * */
function Connector(dbString) {
    var self    = this
        , local = {
            bundle: null,
            env: null,
            options: {
                keepAlive: true,
                pingInterval : "1m"
            }
    };

    /**
     * init
     *
     * @param {object} dbString
     *
     * @contructor
     * */
    var init = function(dbString) {

        var err = false;
        try {
            dbString        = merge(dbString, local.options);
            local.options   = dbString;

            console.info('[ CONNECTOR ] [ ' + dbString.connector +' ] connecting to couchbase cluster');
            self.cluster = new couchbase.Cluster(dbString.protocol + dbString.host);
            // version 5.x
            if ( typeof(self.cluster.authenticate) != 'undefined' )
                self.cluster.authenticate(dbString.username, dbString.password);

            self
                .connect(dbString)
                .on('error', function(err){
                    console.emerg('[ CONNECTOR ] [ '+ dbString.database +' ] Handshake aborted ! PLease check that Couchbase is running.\n',  err.message);
                })
                .once('connect', function () {
                    // default driver does not trigger any conn event, so we have to intercept it thu gina
                    gina.onError(function(err, req, res, next){
                        // (code)   message
                        // (16)     Generic network failure. Enable detailed error codes (via LCB_CNTL_DETAILED_ERRCODES, or via `detailed_errcodes` in the connection string) and/or enable logging to get more information
                        // (23)     Client-Side timeout exceeded for operation. Inspect network conditions or increase the timeout
                        //          cannot perform operations on a shutdown bucket
                        //          err instanceof CouchbaseError

                        if (!self.instance.connected) {
                            self.reconnected = false;
                            self.reconnecting = false;
                        }
                        
                        if (
                            err instanceof couchbase.Error && err.code == 16 && !self.reconnected
                            //|| err instanceof couchbase.Error && err.code == 23 && !self.reconnecting
                            || /cannot perform operations on a shutdown bucket/.test(err.message ) && !self.reconnecting && !self.reconnected
                        ) {
                            // reconnecting
                            console.debug('[ CONNECTOR ] [ ' + dbString.database +' ] trying to reconnect...');
                            self.reconnecting = true;
                            self.connect(dbString, next)

                        } else if (err instanceof couchbase.Error && err.code == 23 && !self.reconnecting) {
                            self.instance.disconnect();
                            next(err)
                        } else {

                            if (err && err instanceof Error) {

                                console.error('[ CONNECTOR ] [ ' + dbString.database +' ] gina fatal error: ' + err.message + '\nstack: '+ err.stack);
                                
                                if ( typeof(err) == 'object' ) {
                                    res.end(JSON.stringify({
                                        status: 500,
                                        error: err.message,
                                        stack: err.stack
                                    }))
                                } else {
                                    res.end(err)
                                }
                                
                                res.headersSent = true;
                            } else {
                                // express js patch
                                next(err) // might just be a "false" error: `err` is replaced with cb() caller `data`
                            }                            
                        }
                    })
                })

        } catch (err) {
            console.error(err.stack);
            self.emit('ready', err, null)
        }
    }

    /**
     * connect
     *
     * @param {object} dbString
     * @callback cb
     * */
    this.connect = function(dbString, cb) {
        // Attention: the connection is lost 5 minutes once the bucket is opened.
        var conn        = null;

        // version 4.x
        if ( typeof(dbString.password) != 'undefined' && typeof(self.cluster.authenticate) == 'undefined' ) {
            conn = self.cluster.openBucket(dbString.database, dbString.password);
        } else {
            conn = self.cluster.openBucket(dbString.database);
        }

        self.instance   = conn;

        conn.once('connect', function(){
            self.reconnected = true;
            var options = local.options;
            // will send heartbeat every 4 minutes if keepAlive == `true`
            self.ping(options.pingInterval, function(){

                console.debug('[ CONNECTOR ] [ctx] ', getConfig().bundle, getConfig().env );
                // updating context
                // var ctx = getContext()
                //     , bundle = ctx.bundle
                //     , env = ctx.env
                //     , conf = ctx['gina'].config.envConf[bundle][env]
                //     , name = dbString.database
                //     //Reload models.
                //     , modelsPath = _(conf.modelsPath)
                //     ;

                var ctx = getConfig()
                    , bundle = ctx.bundle
                    , env = ctx.env
                    , conf = ctx[bundle][env]
                    , name = dbString.database
                    //Reload models.
                    , modelsPath = _(conf.modelsPath)
                    ;

                local.bundle = bundle;
                local.env = env;

                if ( typeof(cb) != 'undefined' ) { // this portition is not working yet on Mac OS X
                    console.debug('[ ' + local.bundle +' ] reconnected to couchbase !!');

                    
                    modelUtil.setConnection(bundle, name, self.instance);

                    if ( fs.existsSync(modelsPath) ) {
                        modelUtil.setConnection(bundle, name, self.instance);
                        modelUtil.reloadModels(
                            conf,
                            function doneReloadingModel(err) {
                                self.reconnecting = false;
                                cb(err)
                            })
                    } else {
                        cb(new Error('[ ' + local.bundle +' ] '+ modelsPath+ ' not found') )
                    }

                } else {
                    console.debug('[ ' + local.bundle +' ] couchbase is alive !!');
                    self.emit('ready', false, self.instance)
                }
            })
        });

        conn.on('error', function (err) {
            delete self.reconnecting;
            self.reconnected = false
        });

        return conn
    }

    /**
     * ping
     * Heartbeat to keep connection alive
     *
     * @param {string} interval
     * @callback cb
     * */
    this.ping = function(interval, cb) {
        var options = local.options;
        if (options.keepAlive) {
            if ( self.pingId ) {
                clearInterval(self.pingId )
            }

            var interval    = interval || options.pingInterval; // for a minute
            var value       = interval.match(/\d+/);
            var unit        = null; // will be seconds by default
            try {
                unit = interval.match(/[a-z]+/i)[0]
            } catch(err) {
                unit = 's'
            }

            switch ( unit.toLowerCase() ) {
                case 's':
                    interval = value * 1000;
                    break;

                case 'm':
                    interval = value * 60 * 1000;
                    break;

                case 'h':
                    interval = value * 60 * 60 * 1000;
                    break;

                case 'd':
                    interval = value * 60 * 60 * 1000 * 24;
                    break;

                default: // seconds
                    interval = value * 1000
            }

            self.pingId = setInterval(function onTimeout(){
                
                if (!self.instance.connected) {
                    console.debug('[ CONNECTOR ] [ ' + local.bundle +' ] connection is dead: trying to reconnect');
                    self.reconnected = false;
                    self.reconnecting = true;
                    self.connect(dbString, next)
                } else {
                    self.instance.get('heartbeat', function(err, res){
                        console.debug('[ CONNECTOR ] [ ' + local.bundle +' ] connection is being kept alive ...')
                    })
                }
                                
            }, interval);
            cb()
        } else {
            self.instance.get('heartbeat', function(err, result){
                console.debug('[ CONNECTOR ] [ ' + local.bundle +' ] sent ping to couchbase ...');
                cb()
            })
        }
    }

    this.getInstance = function() {
        return self.instance
    }

    this.onReady = function(cb) {
        self.once('ready', cb);
        init(dbString)
    }
};
util.inherits(Connector, EventEmitter);
module.exports = Connector;