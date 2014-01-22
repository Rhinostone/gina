var buildBundle;
//var utils = getContext('geena.utils');
//var util = require('util');

buildBundle = function(project, bundle){

    var releasePath;
    var version;

    var init = function(project, bundle){
        console.log('build init...', bundle);
        if ( typeof(bundle) != 'undefined' ) {
            //buildBundleFromSources(project, bundle);
        } else {
            //buildProjectFromSources(project);
        }
    };

    //var build

    var getSourceInfos = function(package, callback){
        //will always build from sources by default.
        if ( typeof(package['src']) != 'undefined' ) {

        } else if ( typeof(package['repo']) != 'undefined' ) {

        } else {
            callback('No source reference found for build. Need to add [src] or [repo]');
        }
    };

    var buildBundleFromSources = function(project, bundle){
        //build(bundle, releasePath, version);
        try {
            var package = project.packages[bundle];
            var srcPath = package.src;
            var release = package.release;
            var version = package.version;

        } catch (err) {
            console.error(err.stack);
            process.exit(0);
        }

    };

    var buildProjectFromSources = function(project){

    };

    var buildBundleFromRepo = function(project, bundle){

    };

    var buildProjectFromRepo = function(project){

    };

    init(project, bundle);
//    return {
//        onComplete : function(err){
//
//            init(project, bundle);
//        }
//    }
};

module.exports = buildBundle;