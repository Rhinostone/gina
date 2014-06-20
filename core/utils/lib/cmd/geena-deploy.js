var Deploy;

var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('../helpers');

Deploy = function(opt) {

    var self =  Deploy.instance || this;


    var error = false;

    this.env = opt.env;

    this.init = this.onInitialize = function(cb) {

        if (self.initialized == undefined) {
            self.initialized = true;

            if (typeof(cb) != 'undefined' && typeof(cb) == 'function') {
                cb(init)
            } else {
                init()
            }
        }

        return self
    }

    var init = function() {
        console.log('init once !!');

        // main init code goes here...
        if ( typeof(opt['set']) != 'undefined') {

            var dic = {};
            for (var k in opt['set']) {
                //normalizing home path alias (nixes only)
                if (k == 'target' && opt['set'][k] === '~/') {
                    opt['set'][k] = '~'
                }

                self[k] = opt['set'][k];
                dic[k] = opt['set'][k];
            }


            if ( typeof(self['shared_path']) == 'undefined') {
                self['shared_path'] = self.target + '/shared'
            }

            if ( typeof(self['releases_path']) == 'undefined') {
                self['releases_path'] = self.target + '/releases'
            }

            self = whisper(dic, self)
        }

        Deploy.instance = self;
        self.emit('init#completed', false);
    }

//    var init = function() {
//
//        if ( typeof(Deploy.instance) == 'undefined') {
//            if ( typeof(opt['set']) != 'undefined') {
//
//                var dic = {};
//                for (var k in opt['set']) {
//                    //normalizing home path alias (nixes only)
//                    if (k == 'target' && opt['set'][k] === '~/') {
//                        opt['set'][k] = '~'
//                    }
//
//                    self[k] = opt['set'][k];
//                    dic[k] = opt['set'][k];
//                }
//
//
//                if ( typeof(self['shared_path']) == 'undefined') {
//                    self['shared_path'] = self.target + '/shared'
//                }
//
//                if ( typeof(self['releases_path']) == 'undefined') {
//                    self['releases_path'] = self.target + '/releases'
//                }
//
//                self = whisper(dic, self)
//            }
//
//            Deploy.instance = self;
//        }
//    }

    this.run = function(cmdline) {

        if ( isWin32() ) {
            throw new Error('Windows platform not supported yet for command line forward');
            process.exit(1)
        }

        var cmd = spawn('ssh', [ self.user +'@'+ self.server, cmdline ]);

        var result;
        var hasCalledBack = false;
        var e = this;

        cmd.stdout.on('data', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            result = lines.join("");

            e.emit('deploy#data', result);
        });

        // Errors are readable in the onComplete callback
        cmd.stderr.on('data',function (err) {
            var str = err.toString();
            error = str;

            e.emit('deploy#err', str);
        });

        cmd.on('close', function (code) {
            //console.log('closing...', code);
            if (code == 0 ) {
                e.emit('deploy#completed', error, result);
            } else {
                err = new Error('project init encountered an error: ' + error);
                e.emit('deploy#completed', error, result)
            }
        });

        this.onData = function(callback) {

            e.on('deploy#data', function(data) {
                callback(data)
            });

            e.on('deploy#err', function(err, data) {
                callback(err, data)
            });
        }

        this.onComplete = function(callback) {
            e.once('deploy#completed', function(err, data) {
                callback(err, data)
            });
        };

        return this;
    }

    this.onComplete = function(callback) {
        self.once('deploy#init' , function(err) {
            if (!err) {
                console.log('init completed')
            }
            callback(err)
        });

        return self
    }
};

module.exports = Deploy
