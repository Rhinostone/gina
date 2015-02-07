var console = lib.logger;
/**
 * List all environments
 * TODO - add selected icon (green check) for selected env
 * */
function List(){

    var init = function(){
        var main = require(_(GINA_HOMEDIR + '/main.json'))
            , list = main.envs[GINA_RELEASE]
            , selected = main['def_env'][GINA_RELEASE]
            , str = '';

        list.sort();
        for (var i=0; i<list.length; ++i) {
            if (selected === list[i]) {
                str += '[ * ] ' + list[i]
            } else {
                str += '[   ] ' + list[i]
            }
            str += '\n\r'
        }
        console.log(str.substr(0, str.length-2))
    }

    init()
};

module.exports = List