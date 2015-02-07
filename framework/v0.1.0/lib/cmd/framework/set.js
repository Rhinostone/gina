var console = lib.logger;

function Set(opt){

    var init = function(opt){
        //if ( typeof(GINA_LOG_LEVEL) != '')
        var a = [], k, v;
        for (var i=3; i<process.argv.length; ++i) {
            a = process.argv[i].split(/=/);
            k = a[0];
            v = a[1];
            console.debug('framework:set', process.argv[i]);
            set(k,v);
        }
    };



    var set = function(k, v) {
        switch(k) {
            case '--log-level':
                setLogLevel(v);
            break;
        }
    }

    var setLogLevel = function(level) {

    }

    init(opt)
};

module.exports = Set