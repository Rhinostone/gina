var console = lib.logger;
/**
 * Get framework settings
 * */
function Get(){
    var self = {};

    var init = function(){
        self.target     = _(GINA_HOMEDIR +'/' + GINA_RELEASE + '/settings.json');
        self.settings   = require(self.target);
        self.bulk       = false;

        if ( process.argv.length > 3 ) {
            self.bulk = true
        }
        get()
    }

    var get = function() {
        var str = ''
            , key = ''
            , settings = self.settings;
        if (!self.bulk) {
            for(var prop in settings) {
                str += prop +' = '+ settings[prop] +'\n'
            }
            console.log(str.substr(0, str.length-1))
        } else {
            for (var i=0; i<process.argv.length; ++i) {
                if ( /^(\-\-)/.test(process.argv[i]) ) {
                    key = process.argv[i].replace(/\-\-/, '').replace(/\-/, '_');
                    if ( typeof(settings[key]) != 'undefined' ) {
                        str += key +' = '+ settings[key] +'\n'
                    }
                }
            }
            if (str != '')
                console.log(str.substr(0, str.length-1))
        }
    }

    init()
};

module.exports = Get