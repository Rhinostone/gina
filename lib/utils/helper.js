var helper;

var fs = require('fs');

helper = {

    createFileFromTemplate : function(source, target){

        var data = fs.readFileSync(source);

        try {
            fs.writeFileSync(target, data);
            fs.chmodSync(target, 0755);
            return target
        } catch (err) {
            throw err.stack;
            process.exit(1)
        }
    },

    loadProjectConfiguration : function(home){

    },

    filterArgs : function(){
        var evar = "";
        for (var a in process.argv) {
            if ( process.argv[a].indexOf('--') > -1 ) {
                evar = ( process.argv[a].replace(/--/, '') ).split(/=/);
                evar[0] = 'GEENA_' + evar[0].toUpperCase();
                process.env['' + evar[0]] = evar[1];
                //Remove from argv.
                process.argv.splice(a, 1)
            }
        }
    },

    getEnvVar : function(key){
        if ( typeof(process.env[key]) != "undefined" && process.env[key] != "") {
            return process.env[key]
        }
        return undefined
    },

    setEnvVar : function(key, val){

        if ( typeof(process.env[key]) != "undefined" && process.env[key] != "") {
            throw new Error('wont\'t override env var ', key)
        } else {
            //write env var
            //key = key.replace(/GEENA_/, '').toLowerCase();
            process.env[key] = val
        }
    },

    getUserHome : function(){
        return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']
    }
};

module.exports = helper