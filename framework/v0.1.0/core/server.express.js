/**
 * Express JS Server Integration
 * 
 */
const fs        = require('fs'); 
var express   = require('express');

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

    var allowHTTP1 = true;
    if (typeof (options.allowHTTP1) != 'undefined' && options.allowHTTP1 != '' ) {
        credentials.allowHTTP1 = options.allowHTTP1;
        allowHTTP1 = options.allowHTTP1;
    }
        
    if (typeof (options.credentials.ca) != 'undefined' && options.credentials.ca != '' )
        credentials.ca = options.credentials.ca;

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
    
    if ( /^http\/2/.test(options.protocol) ) {
        var http2   = require('http2');
        switch (options.scheme) {
            case 'http':
                var app = express({ allowHTTP1: allowHTTP1 });                
                app.init = function() {
                    this.cache = {};
                    this.engines = {};
                    this.settings = {};                    
                    this.defaultConfiguration();
                };
                
                app.listen = function() {               
                    var server = http2.createServer(this);
                    
                    return server.listen.apply(server, arguments);
                };
                break;
                
            case 'https':                
                
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
            
                var app = express({ allowHTTP1: allowHTTP1 });                
                app.init = function() {
                    this.cache = {};
                    this.engines = {};
                    this.settings = {};                    
                    this.defaultConfiguration();
                };
                
                app.listen = function() {               
                    var server = http2.createServer(this);
                    
                    return server.listen.apply(server, arguments);
                };
                
                break;
        }
        
    } else {
        
        switch (options.scheme) {
            case 'http':
                var http    = require('http');
                var app = express();
                
                app.init = function(credentials) {
                    this.cache = {};
                    this.engines = {};
                    this.settings = {};
                    this.credentials = credentials;
                    
                    this.defaultConfiguration();
                };
                  
                app.listen = function() {
                    var server = http.createServer(this);
                    
                    return server.listen.apply(server, arguments);
                };
                break;
                
            case 'https':
                var https   = require('https');          
                            
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
                
        
            default:
            
                var http    = require('http');
                var app = express();
                
                app.init = function(credentials) {
                    this.cache = {};
                    this.engines = {};
                    this.settings = {};
                    this.credentials = credentials;
                    
                    this.defaultConfiguration();
                };
                
                app.listen = function() {
                    var server = http.createServer(this);
                    
                    return server.listen.apply(server, arguments);
                };
                break;
        }
    }
 
   
    
    return {
        instance: app,
        middleware: express
    }
};

module.exports = ServerEngineClass;