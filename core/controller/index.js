var Controller = require('./controller');
Controller.prototype.framework = require('./controller.framework');
//var inherits = require('./lib/inherits');
//var Main = require('./controller');

//function Controller() {
//    var _require = function(path) {
//        var cacheless = (process.env.IS_CACHELESS == 'false') ? false : true;
//        if (cacheless) {
//            delete require.cache[require.resolve(path)];
//            return require(path)
//        } else {
//            return require(path)
//        }
//    }
//
//    return
//}
//Controller = inherits
//module.exports = Controller()
module.exports = Controller