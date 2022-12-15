var Open;

var fs = require('fs');
var child = require('child_process');

Open = function(){

    var init = function(){
        var openCmd = (GINA_IS_WIN32) ?  'start' : 'open';

        switch (process.argv[3]) {
            case 'service':
            case 'services':
                child.exec(openCmd + ' ' + GINA_DIR + '/services');
                break;

            case 'gina':
            case 'framework':
                child.exec(openCmd + ' ' + GINA_DIR);
                break;

            case 'tmp':
                child.exec(openCmd + ' ' + GINA_TMPDIR);
                break;

            case 'log':
                child.exec(openCmd + ' ' + GINA_LOGDIR);
                break;

            case 'run':
                child.exec(openCmd + ' ' + GINA_RUNDIR);
                break;

            case 'home':
                if ( fs.existsSync(GINA_HOMEDIR) ) {
                    child.exec(openCmd + ' ' +  GINA_HOMEDIR)
                } else {
                    console.log((GINA_IS_WIN32) ? 'gina: sorry, no %USERPROFILE% found' : 'gina: sorry, no $HOME found')
                }
                break;

            default:
                console.log('gina: shortcut not indexed [' + process.argv[3] + ']' );
        }

        end()
    };

    var end = function (err, type, messageOnly) {
        if ( typeof(err) != 'undefined') {
            var out = ( typeof(messageOnly) != 'undefined' && /^true$/i.test(messageOnly) ) ? err.message : (err.stack||err.message);
            if ( typeof(type) != 'undefined' ) {
                console[type](out)
            } else {
                console.error(out);
            }
        }

        process.exit( err ? 1:0 )
    }

    init()
};

module.exports = Open