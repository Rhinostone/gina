var console = lib.logger;
/**
 * Remove existing environment
 * TODO - Remove related files & folders
 * */
function Remove() {
    var self = {};

    var init = function() {
        self.target = _(GINA_HOMEDIR + '/main.json');
        self.main   = require(self.target);

        if ( typeof(process.argv[3]) != 'undefined' ) {
            if ( self.main.envs[GINA_RELEASE].inArray(process.argv[3]) ) {
                removeEnv(process.argv[3], self.main, self.target)
            } else {
                console.error('Environment [ '+process.argv[3]+' ] not found')
            }
        } else {
            console.error('Missing argument in [ gina env:remove <environment> ]')
        }
    }

    var removeEnv = function(env, main, target) {
        if(env === main['dev_env'][GINA_RELEASE] || env === main['def_env'][GINA_RELEASE]) {
            if (env === main['def_env'][GINA_RELEASE]) {
                console.error('Environment [ '+process.argv[3]+' ] is set as "default environment"')
            } else {
                console.error('Environment [ '+process.argv[3]+' ] is protected')
            }
        } else {
            main['envs'][GINA_RELEASE].splice(main['envs'][GINA_RELEASE].indexOf(env), 1);
            lib.generator.createFileFromDataSync(
                main,
                target
            )
        }
    };

    init()
};

module.exports = Remove