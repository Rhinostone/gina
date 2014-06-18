var Deploy;

var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('../helpers');

Deploy = function(opt) {

    var self = this;
    var error = false;



    this.env = opt.env;
    this.target = 'deploy@staging.vitrinedemo.com';

    var init = function() {

        if ( typeof(Deploy.instance) == 'undefined') {
            if ( typeof(opt['set']) != 'undefined') {
                var dic = {};
                for (var k in opt['set']) {
                    self[k] = opt['set'][k];
                    dic[k] = opt['set'][k]
                }

                self = whisper(dic, self)
            }
            Deploy.instance = self;
            return self;
        } else {
            return Deploy.instance
        }
    }

    this.run = function(cmdline) {

        if ( isWin32() ) {
            throw new Error('Windows platform not supported yet for command line forward');
            process.exit(1)
        }
        var cmd = spawn('ssh', [ self.target, cmdline ]);

        var result;
        var hasCalledBack = false;

        cmd.stdout.on('data', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            result = lines.join("");

            self.emit('deploy#data', result);
        });

        // Errors are readable in the onComplete callback
        cmd.stderr.on('data',function (err) {
            var str = err.toString();
            error = str;

            self.emit('deploy#err', str);
        });

        cmd.on('close', function (code) {
            //console.log('closing...', code);
            if (code == 0 ) {
                self.emit('deploy#completed', error, result);
            } else {
                err = new Error('project init encountered an error: ' + error);
                self.emit('deploy#completed', error, result)
            }
        });

        var _this = this;


        this.onData = function(callback) {

            self.on('deploy#data', function(data) {
                callback(data)
            });

            self.on('deploy#err', function(err, data) {
                callback(err, data)
            });

            return _this
        }

        this.onComplete = function(callback) {
            self.once('deploy#completed', function(err, data) {
                callback(err, data)
            })
        };

        return this
    }

    this.onComplete = function(callback) {
        self.once('deploy#init' , function(err) {
            if (!err) {
                console.log('init done with sucess')
            }
            callback(err)
        })
    }

    init()
};

module.exports = Deploy
