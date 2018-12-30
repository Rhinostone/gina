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

// Express compatibility
const slice             = Array.prototype.slice;


function ServerEngineClass(options) {

    console.debug('[ ENGINE ] Isaac says hello !');
    
    // openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout localhost-privkey.pem -out localhost-cert.pem
    const credentials = {
        key: fs.readFileSync(options.credentials.privateKey),
        cert: fs.readFileSync(options.credentials.certificate)
    };
    
    var allowHTTP1 = true;
    if (typeof (options.credentials.allowHTTP1) != 'undefined' && options.credentials.allowHTTP1 != '' ) {
        credentials.allowHTTP1 = options.credentials.allowHTTP1;
        allowHTTP1 = options.credentials.allowHTTP1;
    }
        
        
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
            
            
        server.on('request', (request, response) => {
              
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
                        // false & true case
                        if ( /^(false|true|on)$/i.test(a[1]) )
                            a[1] = ( /^(true|on)$/i.test(a[1]) ) ? true : false;
                        
                        request.query[ a[0] ] = a[1]                        
                    }                  
                } else {
                    request.params[0] = request.url
                }
                
                // You can remove this ... can be found in server.js
                // Express compatibility when using Isaac
                // if ( /*/isaac/.test(self.engine ) &&*/ server.instance._expressMiddlewares.length > 0 ) {
                
            //     var next = function(err) {

            //         if (err) {
            //             throwError(response, 500, err.msg||err.stack);
            //         }
                    
            //         var expressMiddlewares  = server._expressMiddlewares;
                    
            //         expressMiddlewares[next._index](request, response, function onNext(err) {
            //             ++next._index;
                        
            //             if (next._index > next._count) {
            //                 cb(request, response)
            //             } else {
            //                 next.call(this, err, true)
            //             }                        
            //         });
                    
            //     };
            //     next._index = 0;
            //     next._count = server._expressMiddlewares.length-1;
                         
                
            //     next();
                cb(request, response);
            }
            
            
        });

        // server.on('stream', (stream, requestHeaders) => {

        //     if ( /^\*$/.test(path) || path == requestHeaders.path ) {

        //         let request     = requestHeaders;
        //         let response    = new Http2ServerResponse();
        //         let next        = undefined;

        //         //response = merge(response, stream);
                
        //         //stream.respond();
        //         //stream.end('secured hello world!');
        //         cb(request, response, next)
        //     }
            
        // });
        
        
    }

    // All paths allowed
    server.all = function(path, cb) {
        onPath.call(this, path, cb, true)
    }
    
    // configuring express plugins|middlewares
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
      
        
        this._expressMiddlewares = merge(this._expressMiddlewares, fns);
        
        return this;
    }

    // server.on('error', (err) => console.error(err));

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