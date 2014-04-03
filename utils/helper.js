'use strict';
var helper;

var fs = require('fs');
var os = require('os');

helper = {

    filterArgs : function(){
        var evar = "";
        if ( typeof(process.env['geena']) == 'undefined') {
            process['geena'] = {}
        }
        var newArgv = {};
        for (var a in process.argv) {
            if ( process.argv[a].indexOf('--') > -1 ) {
                evar = ( (process.argv[a].replace(/--/, ''))
                            .replace(/-/, '_') )
                                .split(/=/);

                evar[0] = evar[0].toUpperCase();
                if (
                    evar[0].substr(0, 6) !== 'GENNA_' &&
                    evar[0].substr(0, 7) !== 'SYSTEM_' &&
                    evar[0].substr(0, 5) !== 'USER_'
                ) {
                    evar[0] = 'GEENA_' + evar[0]
                }
                //boolean values.
                if (evar[1] === "true") {
                    evar[1] = true
                }
                if (evar[1] === "false") {
                    evar[1] = false
                }

                process.geena[evar[0]] = evar[1];
            } else {
                newArgv[a] = process.argv[a]
            }
        }

        //Cleaning argv.
        process.argv = newArgv;

        //cleaning the rest.
        for (var e in process.env) {
            if (
                e.substr(0, 6) === 'GENNA_' ||
                e.substr(0, 7) === 'SYSTEM_' ||
                e.substr(0, 5) === 'USER_'
            ) {
                process['geena'][e] = process.env[e];
                delete process.env[e]
            }
        }
    },

    setEnvVar : function(key, val){

        if (
            typeof(process['geena']) != 'undefined' &&
            typeof(process['geena'][key]) != 'undefined' &&
            process['geena'][key] !== ''
        ) {
            throw new Error('wont\'t override env var ', key)
        } else {
            //write env var.
            process['geena'][key] = val
        }
    },

    getEnvVar : function(key){
        if (
            typeof(process['geena']) != 'undefined' &&
            typeof(process['geena'][key]) != 'undefined' &&
            process['geena'][key] != ''
        ) {
            return process['geena'][key]
        }
        return undefined
    },

    getUserHome : function(){
        this.isWin32 = process.platform == 'win32';
        return process.env[(this.isWin32) ? 'USERPROFILE' : 'HOME']
    },

    getTmpDir : function(){
        // support for node 0.10.x & 0.11.x
        var tmp = os.tmpdir || function(){
            if (this.isWin32) {
                return process.env.TEMP ||
                    process.env.TMP ||
                    (process.env.SystemRoot || process.env.windir) + '\\temp'
            } else {
                return process.env.TMPDIR ||
                    process.env.TMP ||
                    process.env.TEMP ||
                    '/tmp'
            }
        }
        return ( typeof(tmp) == 'function') ?  tmp() : tmp
    },
    /**
     * Get run\lock path
     *
     * */
    getRunDir : function(){

        if (this.isWin32) {

        } else {
            // Means /var/run or /var/lock by default.
            var runDir = '/var/run';
            return ( fs.existsSync(runDir) ) ? runDir : '/var/lock'//by default.
        }
    },

    /**
     * Get log path - %SystemRoot%\system32\winevt\logs or /
     *
     * @return {string} logPath
     * */
    getLogDir : function(){
        return (this.isWin32) ? process.env.SystemRoot + '\\system32\\winevt\\logs'  : '/var/log'
    }
};

module.exports = helper