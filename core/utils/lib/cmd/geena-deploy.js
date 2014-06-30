var Deploy;

var fs = require('fs');
var spawn = require('child_process').spawn;
var helpers = require('../helpers');

Deploy = function(opt) {

    var self =  Deploy.instance || this;
    var error = false;
    var hosts = {};
    this.env = opt.env;
    this.stask = 'deploy';

    this.tasks = {
        'onInitialized' : [],
        'onDeployed' : []
    }

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
                // by default
                if (k == 'target') {
                    self['releases_path'] = opt['set'][k] +'/releases';
                    dic['releases_path'] = opt['set'][k] +'/releases';
                    if ( typeof(opt.set.release) != 'undefined') {
                        self.release = opt.set.release
                    } else {
                        self.release = self.makeReleaseNumber()
                    }
                    self['release_path'] = self['releases_path'] + '/' + self.release;
                    dic['release_path'] = self['releases_path'] + '/' + self.release;
                }


                self[k] = opt['set'][k];
                dic[k] = opt['set'][k];
            }


            if ( typeof(self['shared_path']) == 'undefined') {
                self['shared_path'] = self.target + '/shared'
            }

            if ( typeof(self['shared']) == 'undefined') {
                self['shared'] = []
            }


            if ( typeof(self['host']) == 'undefined') {
                self['host'] = self.user +'@'+ self.server
            }

            if ( typeof(self['keep_releases']) == 'undefined') {
                self['keep_releases'] = 5
            }

            // link to current task added to the end
            opt.tasks.onDeployed.push('cd '+self.target+'/; rm ./current; ln -s ' + self.release_path +' ./current');

            self = whisper(dic, self);
            opt = whisper(dic, opt);

            if (self.releases_path == '/' || self.releases_path == '/.' || self.releases_path == '~' || self.releases_path == '~/' || self.releases_path == '~/.') {
                console.log('releases path cannot be root')
                process.exit(1)
            }
        }

        Deploy.instance = self;

        self.removeAllReleases( function onRemoved() {
            self.emit('init#complete', false)
        })

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

        var envs = require(getPath('root') +'/env.json');
        var envsList = [], bundleList = [];
        var path = '';

        for (var b in envs) {
            bundleList.push(b);
            for (var e in envs[b]) {
                if (list.indexOf('*/'+ e +'/*') < 0 && e != self.env ) {
                    list.push('*/'+ e +'/*')
                }

                path = './releases/'+ b +'/'+ e;
                if (list.indexOf(path) < 0 && e != self.env ) {
                    list.push(path)
                }
            }
        }

        return list
    }

    this.makeReleaseNumber = function() {
        return new Date().getTime()
    }

    this.removeAllReleases = function(cb) {

        var removeRelease = function(list, i, cb) {
            if ( list.length > ~~self['keep_releases'] ) {
                if (list[i] == '') { //avoid empty
                    list.splice(0, 1);
                    removeRelease(list, 0, cb)
                } else {
                    self
                        .run('rm -Rf ' + self.releases_path + '/' + list[i])
                        .onComplete( function(err, data) {
                            if (!err) {
                                list.splice(0, 1);
                                removeRelease(list, 0, cb)
                            } else {
                                console.error(err);
                                process.exit(1)
                            }
                        })
                }
            } else {
                cb()
            }
        };

        self
            .run('ls ' + self.releases_path + '/')
            .onComplete( function(err, data) {
                if (!err) {
                    var list = data.toString().split('\n');
                    removeRelease(list, 0, cb)
                }
            })
    }

    this.run = function(cmdline, runLocal) {
        var outFile = _(getPath('globalTmpPath') + '/out.log');
        var errFile = _(getPath('globalTmpPath') + '/err.log');
        var out = fs.openSync(outFile, 'a');
        var err = fs.openSync(errFile, 'a');

        var cmd;
        if ( isWin32() ) {
            throw new Error('Windows platform not supported yet for command line forward');
            process.exit(1)
        }
        if ( typeof(runLocal) != 'undefined' && runLocal == true ) {
            // cmdline must be an array !!
            cmd = spawn(cmdline.splice(0,1).toString(), cmdline, { stdio: [ 'ignore', out, err ] })
        } else {
            cmd = spawn('ssh', [ self.host, cmdline ], { stdio: [ 'ignore', out, err ] })
        }


        var result, error = false;
        var hasCalledBack = false;
        var e = self;

        cmd.on('stdout', function(data) {
            var str = data.toString();
            var lines = str.split(/(\r?\n)/g);
            result = lines.join('');
            e.emit('run#data', result)
        });

        // Errors are readable in the onComplete callback
        cmd.on('stderr', function (err) {
            var str = err.toString();
            error = str;
            e.emit('run#err', str)
        });

        cmd.on('close', function (code) {

            try {
                var error = ( fs.existsSync(errFile) ) ? fs.readFileSync(errFile).toString() : undefined;
                //closing
                fs.closeSync(err);
                fs.unlinkSync(errFile);

                if (error) {
                    cmd.emit('stderr', new Buffer(error))
                }

                var data = ( fs.existsSync(outFile) ) ? fs.readFileSync(outFile).toString() : undefined;
                //closing
                fs.closeSync(out);
                fs.unlinkSync(outFile);

                if ( data ) {
                    cmd.emit('stdout', new Buffer(data))
                }


            } catch (err) {
                console.error(err.stack)
            }

            if (code == 0 ) {
                if (runLocal) {
                    e.emit('run#complete', error, result)
                } else {
                    setTimeout( function onClose() {
                        e.emit('run#complete', error, result)
                    }, 150)
                }
            } else {
                if (runLocal) {
                    e.emit('run#complete', new Error('project deploy encountered an error: ' + error), result)
                } else {
                    setTimeout( function onClose() {
                        e.emit('run#complete', new Error('project deploy encountered an error: ' + error), result)
                    }, 150)
                }
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

        return self
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

    var makeStartUpScript = function() {

    }

    this.runOnDeployedTasks = function(t) {
        if ( typeof(opt.tasks) != 'undefined' && typeof(opt.tasks.onDeployed) != 'undefined' && opt.tasks.onDeployed.length > 0) {
            var tasks = opt.tasks.onDeployed;
            var t = t || 0;
            if (t > tasks.length-1) {
                self.emit('deploy#complete', false)
            } else {
                console.info('running: '+ tasks[t]);
                self
                    .run(tasks[t])
                    .onComplete( function(err, msg) {
                        self.runOnDeployedTasks(t+1)
                    })
            }
        } else {
            self.emit('deploy#complete', false)
        }

        this.onComplete = function(callback) {

            self.once('deploy#complete' , function(err) {
                if (!err) {
                    console.log('finalizing... ')
                }

                callback(err)
            });

            return self
        }

        return self
    }
};

module.exports = Deploy
