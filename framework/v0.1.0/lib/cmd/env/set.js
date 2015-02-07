var console = lib.logger;
/**
 * Add or edit framework settings
 * */
function Set(){
    var self = {};

    var init = function(){
        self.target = _(GINA_HOMEDIR +'/' + GINA_RELEASE + '/settings.json');
        self.settings = require(self.target);

        var modified = false, argv = JSON.parse(JSON.stringify(process.argv));

        for (var i in argv) {
            if ( /^(\-\-)(?=)/.test(argv[i]) ) {
                set( argv[i].split(/=/) );
                modified = true
            }
        }

        if (modified)
            save(self.settings, self.target)
    }

    var set = function(arr) {
        self.settings[arr[0].replace(/\-\-/, '').replace(/\-/, '_')] = arr[1] || '';
    }

    var save = function(data, target) {
        lib.generator.createFileFromDataSync(
            data,
            target
        )
    };

    init()
};

module.exports = Set