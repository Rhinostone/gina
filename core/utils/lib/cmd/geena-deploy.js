var Deploy;

var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('../helpers');

Deploy = function(opt) {

    var self =  Deploy.instance || this;

    var error = false;

    var hosts = {};

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

            if ( typeof(self['host']) == 'undefined') {
                self['host'] = self.user +'@'+ self.server
            }

            self = whisper(dic, self)
        }

        Deploy.instance = self;

        self.emit('init#complete', false)
    }

    this.getIgnoreList = function() {
        var list = [];
        var path = getPath('root') + '/deploy/' + self.env + '/.ignore';

        if ( fs.existsSync(path) ) {
            var arr = fs.readFileSync(path).toString().split(/\n/);
            var tmp =''
            for (var i=0; i<arr.length; ++i) {
                tmp = arr[i].trim();
                if ( tmp.substr(0, 1) != "#" && tmp!= '') {
                    if (tmp.indexOf('#') > -1) {
                        tmp = tmp.substr(0, tmp.indexOf('#')).trim()
                    }
                    list.push(tmp)
                }
            }
        }
        return list;
    }


    this.run = function(cmdline, runLocal) {
        var cmd;
        if ( isWin32() ) {
            throw new Error('Windows platform not supported yet for command line forward');
            process.exit(1)
        }
        if ( typeof(runLocal) != 'undefined' && runLocal == true ) {
            // cmdline must be an array !!
            cmd = spawn(cmdline.splice(0,1).toString(), cmdline);
        } else {
            cmd = spawn('ssh', [ self.host, cmdline ]);
        }


        var result, error = false;
        var hasCalledBack = false;
        var e = self;

        cmd.stdout.on('data', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            result = lines.join("");
            //result += data;
            e.emit('run#data', result);
        });
        //cmd.stdout.pipe(process.stdout);

        // Errors are readable in the onComplete callback
        cmd.stderr.on('data',function (err) {
            var str = err.toString();
            error = str;
            e.emit('run#err', str);
        });

        cmd.on('close', function (code) {
            //console.log('closing...', code);
            if (code == 0 ) {
                e.emit('run#complete', error, result);
            } else {
                error = new Error('project init encountered an error: ' + error);
                e.emit('run#complete', error, result)
            }
        });

        this.onData = function(callback) {

            e.on('run#data', function(data) {
                callback(data)
            });

            e.on('run#err', function(err, data) {
                callback(err, data)
            });

            return e
        }

        this.onComplete = function(callback) {
            e.once('run#complete', function(err, data) {
                callback(err, data)
            });

            return e
        };

        return self;
    }

    this.onComplete = function(callback) {
        self.once('init#complete' , function(err) {
            if (!err) {
                console.log('init completed')
            }
            callback(err)
        });

        return self
    }
};

module.exports = Deploy
