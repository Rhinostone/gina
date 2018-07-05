/**
 * Express JS Server Integration
 * 
 */
const fs        = require('fs'); 
var express   = require('express');
//const http      = require('http');
//const https     = require('https');
//const http2     = require('http2');

const lib = require('./../lib');
const inherits = lib.inherits;
const merge = lib.merge;
const console = lib.logger;

function ServerEngineClass(options) {

    const credentials = {
        key: fs.readFileSync(options.credentials.privateKey),
        cert: fs.readFileSync(options.credentials.certificate)
    };

    var local = {};

    if (typeof (options.credentials.passphrase) != 'undefined' && options.credentials.passphrase != '')
        credentials.passphrase = options.credentials.passphrase;

        
    var createApplication = function (credentials) {
        var app = function(req, res, next) {
            app.handle(req, res, next);
        };
        
        mixin(app, EventEmitter.prototype, false);
        mixin(app, proto, false);
        
        // expose the prototype that will get set on requests
        app.request = Object.create(req, {
            app: { configurable: true, enumerable: true, writable: true, value: app }
        })
        
        // expose the prototype that will get set on responses
        app.response = Object.create(res, {
            app: { configurable: true, enumerable: true, writable: true, value: app }
        })
        
        
        app.init(credentials);
        return app;
    }
    
    
    
    
    express.createApplication = createApplication;

    //var app = express();
    var app = null;
    switch (options.protocol) {
        case 'http':
            var http    = require('http');
            server      = http.createServer();
            break;
            
        case 'https':
            var https   = require('https');
            //server      = https.createServer(credentials, app);
            
            
            
            var app = express(credentials);
            
            app.init = function(credentials) {
                this.cache = {};
                this.engines = {};
                this.settings = {};
                this.credentials = credentials;
                
                this.defaultConfiguration();
            };
              
            app.credentials = credentials;
            app.listen = function() {
                var server = https.createServer(this.credentials, this);
                
                //var server = http2.createSecureServer(this.credentials, this);
                return server.listen.apply(server, arguments);
            };
            
              
            break;
            
        case 'http/2':
            var http2   = require('http2');
            //server      = http2.createSecureServer(credentials, app);
            var app = express(credentials);
            
            app.init = function(credentials) {
                this.cache = {};
                this.engines = {};
                this.settings = {};
                this.credentials = credentials;
                
                this.defaultConfiguration();
            };
              
            app.credentials = credentials;
            app.listen = function() {               
                var server = http2.createSecureServer(this.credentials, this);
                
                return server.listen.apply(server, arguments);
            };
            break;
    
        default:
            var http    = require('http');
            server      = http.createServer();
            break;
    }
        
        
        
    //var http2Server = http2.createSecureServer(credentials);        
    //var app = express(credentials);
    
    
    

    // your express configuration here
    //var httpsServer = https.createServer(credentials, app);
    
    
    
    return {
        instance: app,
        //instance: server,
        middleware: express
    }
};

module.exports = ServerEngineClass;