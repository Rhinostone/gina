var fs          = require('fs');
const {spawn}       = require('child_process');
const {execSync}    = require('child_process');
var CmdHelper   = require('./../helper');
var console     = lib.logger;

/**
 * Framework link
 *
 * e.g.
 *  gina framework:link @<project>
 *  or
 *  gina link @<project>
 *
 * */
 function Link(opt, cmd) {

    var self    = {};

    var init = function(opt, cmd) {
        var err = false;
        if ( !/^true$/i.test(GINA_GLOBAL_MODE) ) {
            err = new Error('Gina is not installed globally: cannot proceed with linking.');
            return end(err, 'error', true);
        }

        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if (!isCmdConfigured()) return false;

        link(opt, cmd);
    }

    var link = function(opt, cmd) {
        console.debug('Linking framework');

        var err = null, folder = new _(self.projectLocation);

        if ( folder.isValidPath() && isValidName(self.projectName) ) {

            var destination = new _(self.projectLocation + '/node_modules');

            if ( !destination.existsSync() ) {
                err = destination.mkdirSync();
                if (err instanceof Error) {
                    return end(err, 'error')
                }
            }
            destination = new _(destination.toString() +'/gina');
            var source = new _(GINA_PREFIX + '/lib/node_modules/gina');

            console.debug('Link '+ source + ' -> '+destination + ' [ exists ] ? '+ destination.existsSync() );
            if ( destination.existsSync() ) {
                if ( destination.isSymlinkSync() && destination.getSymlinkSourceSync() == source.toString() ) {
                    console.debug('Skipping symlink: same source, not overriding.');
                    return end();
                }
                destination.rmSync();
                var ginaFileObj = new _(self.projectLocation + '/gina');
                if ( ginaFileObj.existsSync() ) {
                    ginaFileObj.rmSync()
                }

            }

            err = source.symlinkSync(destination.toString());

            if (err instanceof Error) {
                return end(err, 'error')
            }
        }

        end()
    }

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

    init(opt, cmd)
 }

 module.exports = Link;