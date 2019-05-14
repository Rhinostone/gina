/**
 * Isaac Server Integration
 * 
 */


const fs                    = require('fs');
const {EventEmitter}        = require('events');

const lib               = require('./../lib');
const inherits          = lib.inherits;
const merge             = lib.merge;
const console           = lib.logger;

var refreshCore = function() {
       
    var corePath    = getPath('gina').core;
    var libPath     = getPath('gina').lib;
    
    var core        = new RegExp( corePath );
    var excluded    = [
        _(corePath + '/gna.js', true)
    ];

    for (var c in require.cache) {
        if ( (core).test(c) && excluded.indexOf(c) < 0 ) {
            require.cache[c].exports = require( _(c, true) )
        }
    }

    //update lib & helpers
    delete require.cache[require.resolve(_(libPath +'/index.js', true))];        
    require.cache[_(libPath +'/index.js', true)] = require( _(libPath +'/index.js', true) );
    require.cache[_(corePath + '/gna.js', true)].exports.utils = require.cache[_(libPath +'/index.js', true)];
    
    //update plugins
    delete require.cache[require.resolve(_(corePath +'/plugins/index.js', true))];
    require.cache[_(corePath +'/plugins/index.js', true)] = require( _(corePath +'/plugins/index.js', true) );
    require.cache[_(corePath + '/gna.js', true)].exports.plugins = require.cache[_(corePath +'/plugins/index.js', true)];
}

// Express compatibility
const slice             = Array.prototype.slice;


function ServerEngineClass(options) {

    console.debug('[ ENGINE ] Isaac says hello !');    
        
    
    // openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout localhost-privkey.pem -out localhost-cert.pem
    var credentials = {};
    if ( /https/.test(options.scheme) ) {
        try {
            credentials = {
                key: fs.readFileSync(options.credentials.privateKey),
                cert: fs.readFileSync(options.credentials.certificate)
            };
        } catch(err) {
            console.emerg('You are trying to start a secured server (https) wihtout suficient credentials: check your `server settings`\n'+ err.stack);
            process.exit(1)
        }
    }
    
    
    var allowHTTP1 = true; // by default
    if (typeof (options.allowHTTP1) != 'undefined' && options.allowHTTP1 != '' ) {        
        allowHTTP1 = options.allowHTTP1;
    }
    credentials.allowHTTP1 = allowHTTP1;
        
        
    if (typeof (options.credentials.ca) != 'undefined' && options.credentials.ca != '' )
        credentials.ca = options.credentials.ca;

    if (typeof (options.credentials.pfx) != 'undefined' && options.credentials.pfx != '' )
        credentials.pfx = fs.readFileSync(options.credentials.pfx);
        
    if (typeof (options.credentials.passphrase) != 'undefined' && options.credentials.passphrase != '' )
        credentials.passphrase = options.credentials.passphrase;
    
    var server = null, http = null;
            
    if ( /^http\/2/.test(options.protocol) ) {
        var http2   = require('http2');
        switch (options.scheme) {
            case 'http':                
                server      = http2.createServer({ allowHTTP1: allowHTTP1 });
                break;
                
            case 'https':                
                server      = http2.createSecureServer(credentials);
                break;
        
            default:
                server      = http2.createServer({ allowHTTP1: allowHTTP1 });
                break;
        }
    } else {
        
        switch (options.scheme) {
            case 'http':
                http        = require('http');
                server      = http.createServer();
                break;
                
            case 'https':
                var https   = require('https');
                server      = https.createServer(credentials);
                break;
        
            default:
                http        = require('http');
                server      = http.createServer();
                break;
        }
    }
                
    
    const middleware = function(path, cb) {
        
        // if (request.path === path) {
        //     onPath.call(this, path, cb)
        // }  else { // 404
        //     stream.respond({
        //         'content-type': 'text/html',
        //         ':status': 404
        //     });
        //     stream.end('<h1>404</h1>');
        // }
    };
    
       
    const onPath = function(path, cb, allowAll) {
        
        var queryParams = null
            , i         = null
            , len       = null
            , p         = null
            , arr       = null
            , a         = null;
          
        // http2stream handle by the Router class & the SuperController class
        // See `${core}/router.js` & `${core}/controller/controller.js`    
                
        server.on('request', (request, response) => {
            
            if (GINA_ENV_IS_DEV) {
                refreshCore()
            }
                                      
            if (/^\*$/.test(path) || path == request.url) {
                request.params  = {};
                request.query   = {};
                
                if ( /\?/.test(request.url) ) {     
                                   
                    queryParams = request.url.split(/\?/);
                    
                    len = queryParams.length;
                    request.params[0] = queryParams[0];
                    
                    if ( /\&/.test(queryParams[1]) ) {
                        i = 1; 
                        for (; i < len; ++i) {
                            
                            arr = queryParams[i].split(/\&/);
                            p = 0; 
                            for (; p < arr.length; ++p) {
                                a = arr[p].split(/\=/);
                                // false & true case
                                if ( /^(false|true|on)$/i.test(a[1]) )
                                    a[1] = ( /^(true|on)$/i.test(a[1]) ) ? true : false;
                                
                                request.query[ a[0] ] = a[1] 
                            }                        
                        } 
                    } else {
                        a = queryParams[1].split(/\=/);
                        
                        if (a.length > 1) {
                            // false & true case
                            if ( /^(false|true|on)$/i.test(a[1]) )
                                a[1] = ( /^(true|on)$/i.test(a[1]) ) ? true : false;
                            
                            request.query[ a[0] ] = a[1]  
                        } else { // for redirection purposes or when passing `?encodedJsonObject`
                            try {
                                if ( a[0].indexOf('%') > -1 ) { // encoded URI Component
                                    a[0] = decodeURIComponent(a[0])
                                }
                                
                                request.query = JSON.parse(a[0]);
                            } catch(err) {
                                console.error(err.stack)
                            }
                                
                            //request.query = {};
                        }                      
                                                  
                    }
                    request.url = request.url.replace(/\?.*/, '')                  
                } else {
                    request.params[0] = request.url
                }
                      
                                
                cb(request, response);
            }
            
            
        });  
        
    }
    
    // server.on('stream', (stream, headers) => {
    //     // stream is a Duplex
    //     stream.respond({
    //       'content-type': 'text/html',
    //       ':status': 200
    //     });
    //     stream.end('<h1>Hello World</h1>');
    //   });

    // All paths allowed
    server.all = function(path, cb) {
        onPath.call(this, path, cb, true)
    }
    
    // configuring express plugins|middlewares
    server._expressMiddlewares = [];
    /**
     * <server>.use()
     * Applies middleware for every single route
     * 
     * @param {function} fn
     */
    server.use = function use(fn) {
             
        var offset = 0;
        //var path = '/';
      
        // default path to '/'
        // disambiguate app.use([fn])
        if (typeof fn !== 'function') {
          var arg = fn;
      
          while (Array.isArray(arg) && arg.length !== 0) {
            arg = arg[0];
          }
      
          // first arg is the path
          if (typeof arg !== 'function') {
            offset = 1;
            path = fn;
          }
        }
      
        
        var fns = merge(slice.call(arguments, offset));
      
        if (fns.length === 0) {
          throw new TypeError('server.use() requires a middleware function')
        }
        
        fns.forEach(function (fn) {            
            server._expressMiddlewares[server._expressMiddlewares.length] = fn;
        });
        
        return this;
    }

    server.on('error', (err) => {
        console.error(err)
    });

    // server.on('stream', (stream, headers) => {
    //     // stream is a Duplex
    //     stream.respond({
    //         'content-type': 'text/html',
    //         ':status': 200
    //     });
    //     stream.end('<h1>Hello World</h1>');
    // });
    
    

    return {
        instance: server,
        middleware: middleware
    }
};

module.exports = ServerEngineClass;