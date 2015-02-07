var console = lib.logger;
/**
 * Select the default environment
 * */
function Use() {
    var self = {};

    var init = function() {
        self.target = _(GINA_HOMEDIR + '/main.json');
        self.main   = require(self.target);

        if ( typeof(process.argv[3]) != 'undefined' ) {
            if ( !self.main.envs[GINA_RELEASE].inArray(process.argv[3]) ) {
                console.error('Environment [ '+process.argv[3]+' ] not found')
            } else {
                useEnv(process.argv[3], self.main, self.target)
            }
        } else {
            console.error('Missing argument in [ gina env:use <environment> ]')
        }
    }

    var useEnv = function(env, main, target) {
        if (env !== main['def_env'][GINA_RELEASE]) {
            main['def_env'][GINA_RELEASE] = env;
            lib.generator.createFileFromDataSync(
                main,
                target
            )
        }
    };

    init()
};

module.exports = Use