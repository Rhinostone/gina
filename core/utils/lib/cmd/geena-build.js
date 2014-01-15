var buildBundle;

buildBundle = function(project, bundle){

    var releasePath;
    var version;
    var init = function(project, bundle){
        console.log('build init...');
        if ( typeof(bundle) == 'undefined' ) {
           // buildBundle(bundle);
        } else {
           // buildProject(project);
        }

        //build(bundle, releasePath, version);
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
        try {
            var package = project.packages[bundle];
            //
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
};

module.exports = buildBundle;