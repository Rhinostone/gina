var fs          = require('fs');

var CmdHelper   = require('./../helper');
var Shell       = lib.Shell;
var console     = lib.logger;

/**
 * Build a project.
 * */
 function Build(opt, cmd) {
    var self    = {}
    , local     = {
        // bundle index while searching or browsing
        b : 0,
        bundle : null,
        bundlePath : null
    };
    
    var init = function() {
        // import CMD helpers
        new CmdHelper(self, opt.client, { port: opt.debugPort, brkEnabled: opt.debugBrkEnabled });

        // check CMD configuration
        if ( !isCmdConfigured() ) return false;
        
        if (!self.bundles.length) {
            return end( new Error('No bundle found in your project `'+ self.projectName +'`') );
        }
        
        console.debug('Building project `'+ self.projectName +'`');
        buildBundle(0);        
    }
    
    var buildBundle = function(b, e) {                
        if ( b > self.bundles.length-1 ) {
            return end()
        }
        if (!e) {
            e = 0;
        }
        
        
        var bundle = self.bundles[b];
        if (!local.envs) {
            try {
                local.envs = [];
                local.manifest = requireJSON(_(self.projectPath, true));            
                var targets = local.manifest.bundles[bundle].releases;                
                for (let env in targets) {
                    local.envs.push(env);
                }
                if (!local.envs.length) {
                    return end( new Error('No environment found for your build !'));
                }           
                
                
            } catch(err) {
                end(err)
            }
        }
        console.debug('Building bundle `'+ bundle + '@'+ self.projectName + '`');
        
        buildEnv(b, e);
        
    }
    
    var buildEnv = function(b, e) {
        
        if ( e > local.envs.length-1 ) {
            return buildBundle(b+1);
        }
        
        var bundle          = self.bundles[b]
            , env           = local.envs[e]
            , manifest      = local.manifest
            , releasePath   = self.projectLocation +'/'+ manifest.bundles[bundle].releases[env].target
            , release       = new _(releasePath, true)
            , srcPath       = _(self.bundlesLocation +'/'+ bundle, true)
        ;
        
        console.debug('Building bundle env `'+ env +'` for `'+ bundle + '@'+ self.projectName + '`');
        
        // cleanup
        if (release.existsSync()) {
            release.rmSync()
        }
        new _(srcPath).cp(releasePath, function onCopied(err, destination) {
            if (err) {
                return end(err)
            }
            
            buildEnv(b, e+1);
        })
    }
    
    var end = function(err) {     
        if (err) {
            if (GINA_ENV_IS_DEV) {
                console.error(err.stack);
            } else {
                console.error(err.message);
            }
            
            return process.exit(1);
        }
        
        console.log('Project [ '+ self.projectName+' ] built with success');
        
        return process.exit(0)
    }
    
    init()
    
 }
 module.exports = Build;