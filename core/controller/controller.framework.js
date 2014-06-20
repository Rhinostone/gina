/**
 * FrameworkController
 * */
var FrameworkController;

//Imports.

FrameworkController = function() {
    var self = this;

    /**
     * Init default action
     *
     * @param {object} req
     * @param {object} res
     * @param {object} [next]
     * */
    this.init = function(req, res) {}

    this.doc = function(req, res) {
        console.log('got doc action');
        var status = req.get.status || 'ok';
        var data = {
            status: status,
            msg: 'hello world !',
            page : { title: 'Documentation', content: 'home.html' }
        };
        render(data)
    }

    var render = function(data) {
        //var views = self.getConfig('views');// ????
        var dir = getPath('geena.documentation');
        self.setViewsLocation(dir);
        //by default for all pages
        data['page']['lang'] = 'en';
        self.render(data)
    }

    var init = function() {
        console.log("local framework init")
    }
};

module.exports = FrameworkController