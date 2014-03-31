var helper;

helper = {

    filterArgs : function(){
        var evar = "";
        if ( typeof(process.env['geena']) == 'undefined') {
            process['geena'] = {}
        }
        for (var a in process.argv) {
            if ( process.argv[a].indexOf('--') > -1 ) {
                evar = ( process.argv[a].replace(/--/, '') ).split(/=/);
                evar[0] = evar[0].toUpperCase();
                if (evar[0].indexOf('GENNA_') < 0 ) {
                    evar[0] = 'GEENA_' + evar[0]
                }
                process.geena[evar[0]] = evar[1];
                //Remove from argv.
                process.argv.splice(a, 1)
            }
        }
        //cleans also the rest
        for (var e in process.env) {
            if ( e.indexOf('GEENA_') > -1 ) {
                process['geena'][e] = process.env[e];
                delete process.env[e]
            }
        }
    },

    setEnvVar : function(key, val){

        if (
            typeof(process['geena']) != 'undefined'
            && typeof(process['geena'][key]) != "undefined"
            && process['geena'][key] != ""
        ) {
            throw new Error('wont\'t override env var ', key)
        } else {
            //write env var
            //key = key.replace(/GEENA_/, '').toLowerCase();
            process['geena'][key] = val
        }
    },

    getEnvVar : function(key){
        if (
            typeof(process['geena']) != 'undefined'
            && typeof(process['geena'][key]) != 'undefined'
            && process['geena'][key] != ''
        ) {
            return process['geena'][key]
        }
        return undefined
    },

    getUserHome : function(){
        return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']
    }
};

module.exports = helper