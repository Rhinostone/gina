
//imports
var fs = require('fs');
var utils = getContext('gina.utils');
var GINA_PATH = _( getPath('gina.core') );
//var Config = require( _( GINA_PATH + '/config') );
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

function iniProject(name) {

    var self = this;
    self.task = 'init';//important for later in config init

    var init = function(name) {
        self.root = getPath('root');
        self.name = name;

        var file = new _(self.root + '/project.json');
        var exists = file.existsSync();
        if ( !exists ) {
            createFile( file.toString() )
        } else {
            console.log('[ aborted ] a project already exists in this location: '+ file);
            process.exit(0)
        }
    }

    var createFile = function(target) {
        var conf = GINA_PATH +'/template/conf/project.json';
        var contentFile = require(conf);
        var dic = {
            "project" : self.name
        };

        contentFile = whisper(dic, contentFile);//data
        fs.writeFileSync(target, JSON.stringify(contentFile, null, 4));
        console.log('project [ '+ self.name +' ] ready');
        process.exit(0)
    }

    init(name)
};
module.exports = iniProject