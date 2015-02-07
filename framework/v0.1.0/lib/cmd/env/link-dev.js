var console = lib.logger;
/**
 * Link environment to development - A way of renaming dev
 * */
function LinkDev() {
    var self = {};

    var init = function() {
        self.target = _(GINA_HOMEDIR + '/main.json');
        self.main   = require(self.target);

        if ( typeof(process.argv[3]) != 'undefined' ) {
            if ( !self.main.envs[GINA_RELEASE].inArray(process.argv[3]) ) {
                console.error('Environment [ '+process.argv[3]+' ] not found')
            } else {
                link(process.argv[3], self.main, self.target)
            }
        } else {
            console.error('Missing argument in [ gina env:use <environment> ]')
        }
    }

    var link = function(env, main, target) {

        if (env !== main['dev_env'][GINA_RELEASE]) {
            if (main['def_env'][GINA_RELEASE] === main['dev_env'][GINA_RELEASE]) {
                main['def_env'][GINA_RELEASE] = env
            }

            main['dev_env'][GINA_RELEASE] = env;
            lib.generator.createFileFromDataSync(
                main,
                target
            )
        }
    };

    init()
};

module.exports = LinkDev