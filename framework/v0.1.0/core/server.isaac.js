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


function ServerEngineClass(options) {

    console.debug('[ ENGINE ] Isaac is there !');
    // openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" -keyout localhost-privkey.pem -out localhost-cert.pem
    const credentials = {
        key: fs.readFileSync(options.credentials.privateKey),
        cert: fs.readFileSync(options.credentials.certificate)
    };
    
    if (typeof (options.credentials.allowHTTP1) != 'undefined' && options.credentials.allowHTTP1 != '' )
        credentials.allowHTTP1 = options.credentials.allowHTTP1;
        
    if (typeof (options.credentials.ca) != 'undefined' && options.credentials.ca != '' )
        credentials.ca = options.credentials.ca;

    if (typeof (options.credentials.pfx) != 'undefined' && options.credentials.pfx != '' )
        credentials.pfx = fs.readFileSync(options.credentials.pfx);
        
    if (typeof (options.credentials.passphrase) != 'undefined' && options.credentials.passphrase != '' )
        credentials.passphrase = options.credentials.passphrase;
    
    var server = null, http = null;
    switch (options.protocol) {
        case 'http':
            http        = require('http');
            server      = http.createServer();
            break;
            
        case 'https':
            var https   = require('https');
            server      = https.createServer(credentials);
            break;
            
        case 'http/2':
            var http2   = require('http2');
            server      = http2.createSecureServer(credentials);
            // unknownProtocol handling
            //if (typeof())
            break;
    
        default:
            http        = require('http');
            server      = http.createServer();
            break;
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
                
                cb(request, response)
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