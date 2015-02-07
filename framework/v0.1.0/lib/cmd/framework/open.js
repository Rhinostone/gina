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

            case 'geena':
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
                    console.log((GINA_IS_WIN32) ? 'geena: sorry, no %USERPROFILE% found' : 'geena: sorry, no $HOME found')
                }
                break;

            default:
                console.log('geena: shortcut not indexed [' + process.argv[3] + ']' );
        }
    };

    init()
};

module.exports = Open