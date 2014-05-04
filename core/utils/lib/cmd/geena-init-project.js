var iniProject;

//imports
var fs = require('fs');
var utils = getContext('geena.utils');
var GEENA_PATH = _( getPath('geena.core') );
//var Config = require( _( GEENA_PATH + '/config') );
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

iniProject = function(name) {

    var self = this;
    self.task = 'init';//important for later in config init

    var init = function(name) {
        self.root = getPath('root');
        self.name = name;

        var file = new _(self.root + '/project.json');
        var exists = file.existsSync();
        console.log('?? exists ? ', exists);
        //if ( !exists ) {
            createFile( file.toString() )
        //} else {
        //    console.log('[ '+ file +' ] already exists. Do you want to override ? (yes|no) >')
        //}
    }

    var createFile = function(target) {
        var conf = GEENA_PATH +'/template/conf/project.json';
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