var fs          = require('fs');
var os              = require('os');
const {spawn}       = require('child_process');
const {execSync}    = require('child_process');
var CmdHelper   = require('./../helper');
var console     = lib.logger;

/**
 * Framework link node_modules
 *
 * e.g.
 *  gina framework:link-node-modules @<project>
 *  or
 *  gina link-node-modules @<project>
 *
 * */
 function LinkNodeModules(opt, cmd) {

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


        linkNodeModules(opt, cmd);
    }

    var linkNodeModules = function(opt, cmd) {
        console.debug('Linking link node_modules');

        var err = null, folder = new _(self.projectLocation);
        if ( folder.isValidPath() && isValidName(self.projectName) ) {
            // destination = new _(destination.toString() +'/gina');
            var source = new _(self.projectLocation +'/node_modules.'+ os.platform(), true);
            if ( !source.existsSync() ) {
                source.mkdirSync()
            }

            var destination = new _(self.projectLocation + '/node_modules');
            console.debug('Link node_modules '+ source.toString() + ' -> '+destination.toString() + ' [ exists ] ? '+ destination.existsSync() );
            if ( destination.existsSync() ) {
                if ( destination.isSymlinkSync() && destination.getSymlinkSourceSync() == source.toString() ) {
                    console.debug('Skipping symlink: same source, not overriding.');
                    return end();
                }
                destination.rmSync()
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

 module.exports = LinkNodeModules;