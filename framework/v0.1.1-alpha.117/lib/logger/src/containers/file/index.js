'use strict';
// Imports
const fs                  = require('fs');
const util                = require('util');
//const {EventEmitter}             = require('events');
const net                 = require('net');
// var promisify           = util.promisify;
// const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// const { execSync }      = require('child_process');


const merge = require(__dirname + '/../../../../merge');

function FileContainer(opt, loggers) {
    var self = {
        // flow or container name/id
        name: 'file'
    };
    var mqId = 'MQ'+ self.name.substring(0,1).toLocaleUpperCase() + self.name.substring(1);

    //var defaultOptions = ;

    var loggerHelper    = require(__dirname +'/../../helper.js')(opt, loggers);
    var format          = loggerHelper.format;
    var processProperties = null;
    var filenames   = {};

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

    function setup(group, filenames, props) {
        //var group = process.title; // gina, frontend@myproject ...
        console.log('['+ mqId +'] setting up '+ group);

        // we only want the bundle's logs
        if (
            !/\@/.test(group)
            // ||
            // props.bundles
            // && props.bundles.length == 0
            // ||
            // props.bundles
            // && props.bundles.indexOf(group) < 0
        ) {
            return
        }

        if ( !filenames[group] ) {
            filenames[group] = {}
        }
        process.stdout.write( format(opt.name, 'info', '['+ mqId +'] setting up '+ group +'\nFilenames: '+ JSON.stringify(filenames, null, 2)) );
        /// aready defiened
        if ( filenames[group].filename) {
            return
        }

        // retriving hostname
        var bfnArr = group.split(/\@/);
        var bundleName = bfnArr[0];
        var projectName = bfnArr[1];
        var homeDir = getUserHome() || process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];// jshint ignore:line
        homeDir += '/.gina';
        var project = requireJSON(_(homeDir +'/projects.json', true))[projectName];// jshint ignore:line
        var projectPath = project.path;
        console.info('write env: ', bundleName, process.env.NODE_ENV || getEnvVar('GINA_ENV'));// jshint ignore:line
        var envObj      = requireJSON(_(projectPath +'/env.json', true))[bundleName][process.env.NODE_ENV || getEnvVar('GINA_ENV')];// jshint ignore:line
        var webroot     = ( !/\s+|\//.test(envObj.server && envObj.server.webroot) ) ? envObj.server.webroot +'.' : '';
        var hostname    = envObj.host;
        var logDir      = getLogDir() || getEnvVar('GINA_LOGDIR');// jshint ignore:line

        filenames[group].filename = _(logDir +'/'+ webroot + hostname +'.log', true);// jshint ignore:line
        console.debug('Log group `'+ group +'` filename set to: ' + filenames[group].filename);
        process.stdout.write( format(opt.name, 'info', 'Log group `'+ group +'` filename set to: ' + filenames[group].filename) );
    }

    function onPayload() {
        var port = opt.mqPort || getEnvVar('GINA_MQ_PORT') || 8125;// jshint ignore:line
        var host = opt.hostV4 || getEnvVar('GINA_HOST_V4') || '127.0.0.1';// jshint ignore:line
        var clientOptions = {
            host    : host,
            port    : port,
            request : 'writeToFile'
        }
        // var loggerOptions   = console.getOptions();
        // var loggers         = console.getLoggers();
        // var loggerHelper    = LoggerHelper(loggerOptions, loggers);
        // var format          = loggerHelper.format;




        var delayedMessages = [];
        var resume = function(payload) {
            process.stdout.write('['+ mqId +'] Resuming with group: '+ payload.group);
            var i = 0;
            while (i < delayedMessages.length) {
                let pl = delayedMessages[i];
                // debug only
                // process.stdout.write('['+ mqId +']'+ format(pl.group, pl.level, pl.content) );

                write(pl.group, format(pl.group, pl.level, pl.content) );
                i++;
            }
            delayedMessages = []
        }


        var client = net.createConnection(clientOptions, () => {
            // 'connect' listener.
            console.info('['+ mqId +'] connected to server :) ', process.argv);
            processProperties = loggerHelper.getProcessProperties();
            console.info('['+ mqId +'] process properties ', processProperties);
            // send request
            client.write( JSON.stringify(clientOptions) +'\r\n');

        });
        client.on('error', (data) => {
            var err = data.toString();
            process.stdout.write( format(opt.name, 'warn', '['+ mqId +'] ' + err) );
        });

        var payloads = null, i = null;
        client.on('data', (data) => {
            //console.log('['+ mqId +']  (data): ' + data.toString());
            payloads = data.toString();

            // from speakers
            if ( /^(\{\"|\[\{\")/.test(payloads) ) {
                payloads = payloads.split(/\r\n/g);
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
                            process.stdout.write( '['+ mqId +'] (exception) '+ payload +'\n' );
                            continue;
                        }


                        if (!pl.content) {
                            // only for debug
                            // process.stdout.write( '['+ mqId +'] (undefined content) '+ JSON.stringify(pl, null) +'\n' );

                            // updating logger context since it can run on different processes
                            if ( pl.sessionId && !clientOptions.sessionId ) {
                                clientOptions.sessionId = pl.sessionId;
                                // setting up file descriptor if not existing

                                //setup(pl.group, processProperties);
                                for ( let b = 0, bLen = processProperties.bundles.length; b < bLen; b++) {
                                    let realGroup = processProperties.bundles[b];
                                    setup(realGroup, filenames, processProperties);
                                }

                                // acknowledging
                                client.write( JSON.stringify(clientOptions) +'\r\n');
                            }

                            if (pl.loggers) {
                                loggers = merge(loggers, pl.loggers);
                                if (delayedMessages.length > 0 /**&& /\@/.test(pl.group)*/ ) {
                                    resume(pl)
                                }
                            }
                            continue;
                        }

                        // only for debug
                        // process.stdout.write(  '['+ mqId +'] '+ pl.content +'\n' );

                        try {
                            if (!filenames[pl.group].filename ) {
                                return;
                            }
                            write(pl.group, format(pl.group, pl.level, pl.content) );

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
            console.log('['+ mqId +'] disconnected from server');
        });
        // setInterval(() => {}, 1 << 30);
    }

    function write(group, content) {

        if ( !/\@/.test(group) || !filenames[group] ) {
            process.stdout.write( '['+ mqId +']['+ group +'] '+ content );
            return;
        }

        if ( !filenames[group].filename ) {
            //throw new Error('['+ mqId +'] No filename found!');
            process.emit('logger#'+self.name, JSON.stringify({
                group       : group,
                level       : 'error',
                // Raw content !
                content     : new Error('['+ mqId +'] No filename found!')
            }));
            return;
        }
        var data = new Uint8Array(Buffer.from(content));
        fs.writeFile(filenames[group].filename, data,
            {
                encoding: "utf8",
                // https://nodejs.org/api/fs.html#file-system-flags
                flag: "a"
            },
            (err) => {
                if (err) {
                    process.stdout.write( format(opt.name, 'err', '['+ mqId +'] ' + err) );
                    return;
                }
        });
    }



    init();
}
module.exports = FileContainer;