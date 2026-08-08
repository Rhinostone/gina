'use strict';
// Imports
const net = require('net');
// #B160 — control-plane dial-host resolution (pure, no framework globals)
var netLocality = require(__dirname + '/../../../../net-locality');
// var fs                  = require('fs');
// var util                = require('util');

function MQSpeaker(opt, loggers, cb) {
    var self = {
        name: 'MQSpeaker'
    };
    var loggerHelper    = require(__dirname +'/../../helper.js')(opt, loggers);
    var format          = loggerHelper.format;



    /**
     * Resolves the framework's connection settings, then starts the speaker.
     *
     * Runs before the framework globals are guaranteed to exist (see the
     * "hack for early calls" block below), so every global read is guarded.
     *
     * @inner
     * @param {object} opt - Logger options; mqPort/hostV4/bindHost are filled in here.
     * @param {function} cb - Passed through to startMQSpeaker.
     * @returns {*} Whatever startMQSpeaker() returns.
     *
     * @example
     * init({ }, function(err, speaker) { });
     */
    function init(opt, cb) {

        // ---------- BO - hack for early calls
        var isWin32         = (process.platform === 'win32') ? true : false;
        var binPath         = __dirname +'/../../../../../../../';
        var ginaPath        = (binPath.replace(/\\/g, '/')).replace('/bin', '');
        ginaPath = (isWin32) ? ginaPath.replace(/\//g, '\\') : ginaPath;
        // loading pack
        var pack            = ginaPath + '/package.json';
        pack = (isWin32) ? pack.replace(/\//g, '\\') : pack;
        var packObj         = require(pack);
        var version         = packObj.version;// jshint ignore:line
        // var frameworkPath   = ginaPath + '/framework/v' + version;


        var shortVersion = version.split('.');
        shortVersion.splice(2);
        shortVersion = shortVersion.join('.');

        var settings = { mq_port: 8125, host_v4: '127.0.0.1' };
        try {
            // #B160-sibling (3) — honour GINA_HOMEDIR so an isolated home resolves
            // its OWN settings instead of the invoking user's. The variable already
            // carries the `/.gina` segment (bin/cli, bin/gina-init both compose it
            // as `home + '/.gina'`), so it replaces that whole prefix, not just the
            // home.
            // Three tiers, and process.env is load-bearing rather than defensive:
            // this container is constructed BEFORE bin/cli imports the OS env into
            // process.gina (measured: process.gina is empty here, while
            // process.env.GINA_HOMEDIR still holds the value), so the framework-env
            // tier alone would never fire on the CLI path. Framework env still wins
            // where it is populated (bundle processes, gina-container), matching the
            // two-tier read used by the secrets backend and resolveHttpHost.
            var _ginaHome = (typeof getEnvVar === 'function' && getEnvVar('GINA_HOMEDIR'))
                || process.env.GINA_HOMEDIR
                || (getUserHome() + '/.gina');
            settings = require( _ginaHome + '/' + shortVersion + '/settings.json');
        } catch (err) {}

        // Guard: settings.mq_port may be an unresolved template placeholder (e.g. '${}'
        // from a broken W2 migration write). Convert to int and fall back to 8125 if invalid.
        var _mqPort = ~~settings.mq_port;
        opt.mqPort = (_mqPort > 0 && _mqPort < 65536) ? _mqPort : 8125;
        opt.hostV4 = settings.host_v4;
        // #B160 — carry the daemon's bind address so startMQSpeaker() can
        // dial locally when host_v4 names one of this machine's interfaces.
        opt.bindHost = settings.bind_host;
        // ---------- EO - hack for early calls

        return startMQSpeaker(opt, cb);
    }


    /**
     * Opens the speaker's connection to the MQ listener.
     *
     * The socket is `unref`'d: a logging transport must never be the reason a
     * process stays alive. Processes that legitimately run long hold the event
     * loop open by their own means — a bundle keeps it alive with its HTTP
     * server (`core/server.js` owns the single `listen()` call for both
     * engines) — so unref'ing costs them nothing while it stops the speaker
     * from outliving its host.
     *
     * @inner
     * @param {object} opt - Logger options; `mqPort`/`hostV4`/`bindHost` are read here.
     * @param {function} [cb] - Called `(false, client)` on connect, `(err)` on error.
     * @returns {object} The connected (unref'd) net.Socket.
     *
     * @example
     * startMQSpeaker({ mqPort: 8125, hostV4: '127.0.0.1' }, function (err, client) { });
     */
    function startMQSpeaker(opt, cb) {
        var port = opt.mqPort || 8125;// jshint ignore:line
        // #B160 — the MQ listener binds `bind_host` (loopback by default):
        // dial it when host_v4 is one of this machine's own addresses.
        var host = netLocality.resolveDialHost(opt.hostV4 || '127.0.0.1', opt.bindHost);// jshint ignore:line
        var clientOptions = {
            host    : host,
            port    : port,
            request : 'report'
        };
        var client = net.createConnection(clientOptions, () => {
            // 'connect' listener.
            // send request
            client.write( JSON.stringify(clientOptions) +'\r\n');

            console.info('[MQSpeaker] connected to server on host: '+ host +' & port: '+ port +' :) ');

            if (cb) {
                cb(false, client)
            }
        });
        // #B276 — the logger is a load-time singleton (`lib/index.js` requires it
        // eagerly, `main.js` invokes `Logger()` at module scope), so this socket is
        // opened by the mere act of requiring the framework — including on a boot
        // that is about to throw for want of a bundle context. Without unref, that
        // documented throw becomes unrecoverable: the caller catches the error and
        // the process still cannot exit, because the socket keeps the loop alive.
        // Only bites when something is actually listening on the MQ port; with
        // nothing there the connection is refused and the handle closes itself.
        client.unref();
        // #B318 — `unref()` covers the socket HANDLE but NOT the pending
        // `TCPConnectWrap` REQUEST, and a pending request keeps the event loop
        // alive on its own. The comment above is correct only for the two states
        // it names: a completed connect, and a REFUSED one (reachable host, no
        // listener — the peer sends RST, the handle closes itself). It misses the
        // third: an UNREACHABLE host (powered off, black-holed, a stale
        // `host_v4` left behind by a DHCP reassignment) answers nothing at all,
        // so the connect stays pending for the OS timeout — ~75s on macOS — and
        // the process cannot exit for that whole window. That is exactly the
        // hang #B276 set out to remove, surviving in the one state neither the
        // fix nor its comment considered.
        //
        // The deadline below is itself `unref`'d, so it never keeps the loop
        // alive either: it can only fire while something ELSE is holding the
        // loop open, which during a stalled dial is precisely the connect
        // request it exists to cancel. `destroy(err)` emits `error`, so the
        // outcome flows through the established handler below — same callback
        // contract, same warn text, no new egress path.
        var connectDeadline = setTimeout(function () {
            if (client.connecting) {
                client.destroy(new Error(
                    'connect ETIMEDOUT ' + host + ':' + port +
                    ' - MQ host unreachable; giving up (logging transport only)'
                ));
            }
        }, opt.mqConnectTimeout || 2000);
        connectDeadline.unref();
        client.once('connect', function () { clearTimeout(connectDeadline); });
        client.once('error',   function () { clearTimeout(connectDeadline); });
        client.on('error', (data) => {
            var err = data.toString();
            if (cb) {
                return cb(err)
            }

            //console.error('[MQSpeaker]  (error): ' + err);
            // Identical to console.error
            // But if have to use this one since it can be called from a
            // spawned commande line like `npm install` post_install script
            // console.debug('=> ', process.argv);
            if ( !/(\/bin\/cli|\/bin\/gina)$/.test(process.argv[1]) ) {
                process.stdout.write( format(opt.name, 'warn', '[MQSpeaker] ' + err) );
            }

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
            console.debug('[MQSpeaker] disconnected from server');
        });

        return client;
    }


    return init(opt, cb);
}
module.exports = MQSpeaker;