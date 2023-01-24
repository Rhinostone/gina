/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

// nodejs dependencies
if ( typeof(module) !== 'undefined' && module.exports) {
    var fs              = require('fs');
    var execSync        = require('child_process').execSync;
    try {
        // With gina framework only
        var console         =  require('../../logger');
    } catch (err) {}
}
/**
 * Domain
 * Credits & thanks to the Mozilla Community :)
 * https://publicsuffix.org/
 *
 * This lib is using Fetch API (NodeJS >= 18.0.0)
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#browser_compatibility
 *
 * TODO - Write a cron to periodically check updates from `https://publicsuffix.org/`
 * TODO - Finalize MD module support
 * TODO - Replace execSync of `curl` to a NodeJS based synchronous request
 *
 * @param {string} [options] - { filename: "./dist/public_suffix_list.dat" } `.dat` configuration filename
 */
function Domain(options) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    // Detect if user is on IE browser
    var isIE            = false;
    if (isGFFCtx) {
        isIE = !!window.MSInputMethodContext && !!document.documentMode;
    }

    var defaultOptions  = {
        // if isGFFCtx, should be place in the public folder to be served by your own host
        // e.g.: "./public_suffix_list.dat" located under "/my-www-folder/"
        filename            : "../dist/public_suffix_list.dat",
        url                 : "https://publicsuffix.org/list/public_suffix_list.dat",
        alternativeUrl      : "https://raw.githubusercontent.com/publicsuffix/list/master/public_suffix_list.dat",
        // only available from backend calls
        isCachingRrequired  : false
    }

    var self = {
        options : null,
        rawPSL  : null,
        PSL     : [],
    };


    var init = function(proto, options) {
        if ( typeof(options) == 'undefined' ) {
            options = defaultOptions
        } else {
            // merge options
            for(let opt in defaultOptions) {
                if ( typeof(options[opt]) == 'undefined' ) {
                    options[opt] = defaultOptions[opt];
                }
            }
        }

        if (!isGFFCtx) {
            options.filename = __dirname +'/'+ options.filename;
        }

        if (isGFFCtx && options.isCachingRrequired ) {
            console.warn('[DOMAIN] `options.isCachingRrequired` is only available for backend');
            options.isCachingRrequired = false
        }

        self.options = options;

        loadPSL(options);

        console.debug('[DOMAIN] PSL Loaded');

        return proto
    }

    // TODO - for frontend calls
    var onReady = function() {

    }

    var loadPSL = async function(opt, isUpdating) {
        var filenameOrUrl = (isGFFCtx || opt.isCachingRrequired) ? opt.url : opt.filename;
        isUpdating = ( typeof(isUpdating) != 'undefined' ) ? isUpdating : false

        if (isGFFCtx) {

            if (self.rawPSL && !isUpdating) {
                return;
            }

            if (!window.fetch) {// just in case
                console.error( new Error('[DOMAIN] Fetch API not supported'));
                return
            }

            var response = null
                , result = null
            ;
            try {
                response    = await fetch(filenameOrUrl);
                result      = await response.text();

                self.rawPSL = result;
            } catch (err) {
                // There was an error
                console.warn('[DOMAIN] Could not load PSL', err.stack || err.message || err);
            }
            return;
        }

        if (opt.isCachingRrequired) { // Fetch is only supported from NodeJS >= 18.0.0
            var cmd = 'curl -o '+opt.filename +' '+ opt.url +' >/dev/null 2>&1';
            console.debug('[DOMAIN] Running: '+ cmd);
            try {
                execSync(cmd);
            } catch (err) {
                cmd = 'curl -o '+opt.filename +' '+ opt.alternativeUrl +' >/dev/null 2>&1';
                try {
                    execSync(cmd);
                } catch (altErr) {
                    throw err
                }
            }

            // TODO - Synchronize this instead of using CURL
            // var http = require('http');

            // var port = 80;
            // var urlArr = opt.url.match(/^(http|https)\:\/\/(.*)\//)[0].split(/\//g);
            // if ( /\:\d+$/.test(urlArr[1]) ) {
            //     port = ~~(urlArr[1].match(/\:\d+$/)[0].replace(/^\:/, ''));
            //     urlArr[1] = urlArr[1].replace(/\:\d+$/, '');
            // }
            // var hostname = urlArr[0] +'//'+ urlArr[1];
            // var path = '/'+ opt.url.split(/\//g).splice(3).join("/");

            // var data = '';

            // var requestOpt = {
            //     hostname: hostname,
            //     port: port,
            //     path: path,
            //     method: 'GET'
            // };

            // var req = await http.request(options, (res) => {
            //     res.setEncoding('utf8');
            //     res.on('data', (chunk) => {
            //         console.log(`BODY: ${chunk}`);
            //         data += chunk;
            //     });
            //     res.on('end', () => {
            //         console.log('No more data in response.');
            //     });
            // });

            // req.on('error', (e) => {
            //     console.error(`problem with request: ${e.message}`);
            // });

            // req.end();

            // self.rawPSL = data.toString();

        }

        self.rawPSL = fs.readFileSync(filenameOrUrl).toString();
    }

    var updatePSL = function() {
        loadPSL(self.options, true);
    }


    /**
     * Load a json file and removing comments if found
     *
     * @return {string} filename - path
     * @return {boolean} [jsonFormat] - false by default
     * */
    var getRootDomain = function(urlOrHostname, jsonFormat) {
        if ( typeof(jsonFormat) == 'undefined' ) {
            jsonFormat = false
        }
        var isSLD = false
            , isRegisteredTldOrSld = false
            , rootDomain = urlOrHostname.replace(/^(.*)\:\/\/|\/(.*)/g, '')
            // we don't want sub domains: that's why the `.reverse()` is for
            , rootDomainArr = rootDomain.split(/\./g).reverse()
            // TLD by default
            , rootDomainIndex = (rootDomainArr.length) ? rootDomainArr.length-1 : 0
        ;

        var list = self.rawPSL
                // remove comments & empty lines
                .replace(/\/\/\s*(.*)\n|^\s*\n/gm, '')
                .split(/\n/)
                .filter( function onFiltered(item, i, iArr) {
                    // formating ^!, ^. & removing extra junk
                    // this is specific to the ginven extensions list
                    if ( /[^a-z 0-9.]+/.test(item) ) {
                        item = item.replace(/[^a-z 0-9.]+/g, '').replace(/^\./g, '');
                    }

                    // retain only SLD
                    if ( /\./.test(item) ) {
                        if ( !isSLD && new RegExp('.'+item +'$').test(rootDomain) ) {
                            // Found SLD
                            isSLD = true;
                            // console.debug('Found '+ item);
                            rootDomainIndex = item.split(/\./g).length;
                            // Stop here
                            iArr.splice(0, iArr.length);
                            return false;
                        }

                        return item
                    }
                    // also get tld to check later if valid/registered
                    return item
                });

        // Local or unregistered domain
        rootDomain = rootDomainArr[rootDomainIndex];

        // TLD & SLD
        if (rootDomainIndex > 0 ) {
            // rootDomainArr  = rootDomainArr.splice(0, rootDomainIndex);
            // rootDomain += '.'+ rootDomainArr.reverse().join('.');

            rootDomainArr  = rootDomainArr.splice(0, rootDomainIndex);
            var suffix = rootDomainArr[0];
            // Remove port number
            if ( /\:(.*)$/.test(suffix) ) {
                suffix = suffix.replace(/\:(.*)$/, '');
            }
            isRegisteredTldOrSld = ( isSLD || !isSLD && list.indexOf(suffix) > -1 ) ? true : false;
            if (isRegisteredTldOrSld /**&& isSLD || !isSLD && list.indexOf(suffix) < 0*/ ) {
                if (rootDomainIndex > 1 && !isSLD) {
                    // This is a TLD
                    rootDomainArr.splice(2);
                    rootDomain = rootDomainArr.reverse().join('.');
                } else {
                    rootDomain += '.'+ rootDomainArr.reverse().join('.');
                }

            } else {
                if (rootDomainIndex > 1) {
                    // Only allowing pseudo TLD here
                    rootDomainArr.splice(2);
                    rootDomain = rootDomainArr.reverse().join('.');
                } else {
                    rootDomain += '.'+ rootDomainArr.reverse().join('.');
                }
            }
        }

        // Remove port number
        if ( /\:(.*)$/.test(rootDomain) ) {
            rootDomain = rootDomain.replace(/\:(.*)$/, '');
        }

        console.debug('[DOMAIN] isSLD: '+ isSLD, urlOrHostname, ' -> ', rootDomain);
        if ( /^true$/i.test(jsonFormat) ) {
            return {
                rootDomain: rootDomain,
                isSLD: isSLD,
                isRegisteredTldOrSld: isRegisteredTldOrSld
            }
        }
        return rootDomain
    }

    var _proto = {
        getRootDomain   : getRootDomain
    };
    // Backend proto only
    if (!isGFFCtx) {
        _proto.updatePSL = updatePSL;
    }
    // Frontend only
    else {
        _proto.onReady = onReady;
    }


    if (isGFFCtx && isIE && !window.fetch) {
        // Create Promise polyfill script tag
        var promiseScript = document.createElement("script");
        promiseScript.type = "text/javascript";
        promiseScript.src =
            "https://cdn.jsdelivr.net/npm/promise-polyfill@8.1.3/dist/polyfill.min.js";

        // Create Fetch polyfill script tag
        var fetchScript = document.createElement("script");
        fetchScript.type = "text/javascript";
        fetchScript.src =
            "https://cdn.jsdelivr.net/npm/whatwg-fetch@3.4.0/dist/fetch.umd.min.js";

        // Add polyfills to head element
        document.head.appendChild(promiseScript);
        document.head.appendChild(fetchScript);

        // Wait for the polyfills to load and run the function.
        // TODO - add a setinterval to trigger `onFetchReady`event
        return setTimeout(() => {
            return init(_proto, options)
        }, 500);
    } else {
        return init(_proto, options)
    }



}//EO Domain.

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Domain
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( function() { return Domain })
}
