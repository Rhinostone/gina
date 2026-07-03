var console = lib.logger;
var fs      = require('fs');
var path    = require('path');
/**
 * @module gina/lib/cmd/framework/help
 */
/**
 * Prints the framework CLI help.
 *
 * Handles `gina --help`, `gina -h`, and `gina help` — all aliased to
 * `framework:help` (see `lib/cmd/aliases.json`). Reads and prints the command
 * reference at `lib/cmd/framework/help.txt`, then exits.
 *
 * Opening a Gina directory in the OS file manager is a separate concern handled
 * by the `open` command (`gina open <key>` / `gina -o <key>` — see `./open`).
 *
 * Usage:
 *  gina --help | -h
 *  gina help
 *
 * @class Help
 * @constructor
 * @param {object} opt - Parsed command-line options (unused; help reads help.txt).
 *
 * @example
 *  $ gina --help
 *  $ gina -h
 *  $ gina help
 */
function Help(opt) {

    /**
     * Reads and prints `lib/cmd/framework/help.txt` to stdout, then exits.
     * @inner
     * @private
     */
    var init = function() {
        var file = path.join(__dirname, 'help.txt');

        if ( !fs.existsSync(file) ) {
            console.error('gina: no CLI help available at the moment. Try `man gina`.');
            process.exit(1);
            return;
        }

        try {
            console.log( '\n' + fs.readFileSync(file, 'utf8') );
        } catch (err) {
            console.error( err.stack || err );
            process.exit(1);
            return;
        }

        process.exit(0);
    };

    init();
};
module.exports = Help;
