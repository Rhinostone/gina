/*
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
// nodejs dependencies
if ( typeof(module) !== 'undefined' && module.exports) {
    
    var fs      = require('fs');
    var zlib    = require('zlib');
    var JSZip   = require('./dep/jszip.min.js');
    var Emitter = require('events').EventEmitter;
    var helpers = require('../../../helpers/index');
    var inherits = require('../../../lib/inherits');
}


/**
 * Archiver
 *  zlib APIs except those that are explicitly synchronous 
 *  To prenvent any suprises, you can use this in a child process
 * 
 *  Note: 
 *      Because libuv's threadpool has a fixed size, 
 *      it means that if for whatever reason any of these APIs takes a long time, 
 *      other (seemingly unrelated) APIs that run in libuv's threadpool will experience degraded performance. 
 *      In order to mitigate this issue, one potential solution is to increase the size of libuv's threadpool 
 *      by setting the 'UV_THREADPOOL_SIZE' environment variable to a value greater than 4 (its current default value).
 *      For more information, see the libuv threadpool documentation (http://docs.libuv.org/en/latest/threadpool.html)
 *
 * @package     Gina.Lib
 * @namespace   Gina.Lib.Archiver
 * @author      Rhinostone <gina@rhinostone.com>
 * */

function Archiver() {
    
    
    var self        = this;    
    var isGFFCtx    = ((typeof (module) !== 'undefined') && module.exports) ? false :  true;
    var merge       = (isGFFCtx) ? require('utils/merge') : require('../../../lib/merge');
    var zip         = new JSZip();
    
    
    // var fs = null, zlib = null, Emitter = null;
    // // node dependencies - backend use only !
    // if (!isGFFCtx) { 
    //     fs      = require('fs');
    //     zlib    = require('zlib');
    // }
    
    this.allowedCompressionMethods = ['gzip', 'br', 'deflate'];
    
    var defaultCompressionOptions = {
        tmp         : null,
        method      : 'gzip', // gzip (Gzip/Gunzip) | br (Brotli) | deflate (Deflate/Inflate)
        unlinkSrc   : false,
        // Zli class options : https://nodejs.org/api/zlib.html#zlib_class_options
        level       : 9   // compression level 
    };
    
    
    
    /**
     * compress
     * 
     * @param {string|array} src - filename or array of filenames e.g: `/usr/local/data/dump.sql`
     * @param {string} output pathname - e.g: `/var/backup/mysql/`
     * @param {object} [options] you can also pass Zlib class options, see: https://nodejs.org/api/zlib.html#zlib_class_options
     *  {
     *      method: 'gzip',
     *      name: 'my-dump', // this is optional
     *      level: 7    // `0` for no compression; `1` for best speed; `9` for best compression
     *  }
     * 
     */
    this.compress = function(src, target, options) {
        
        options = ( typeof(options) != 'undefined' ) ? merge(options, defaultCompressionOptions) : defaultCompressionOptions;
        
        if ( options.tmp != null ) {
            options.unlinkSrc = true;
        }
        
        // if ( /\.(zip|gz)$/.test(target) ) {
        //     options.method = 'gzip';
        // }
        
        if ( self.allowedCompressionMethods.indexOf(options.method.toLowerCase()) < 0 ) {
            throw new Error('compression methode `'+ options.method +'` not supported !');
        }
        
        compressWith[options.method](src, target, options);
        
        return {
            onComplete: function onCompressionCompleted(cb) {
                self.once('archiver#complete', function(err, target){
                    cb(err, target)
                })
            }
        }
    }
    
    var compressWith = {};

    compressWith.gzip = function(src, target, options) {        
        

        // compress file or folder
        if ( typeof(src) == 'string' ) {
            if ( !fs.existsSync(src) ) {
                self.emit('archiver#complete', new Error('file not found `'+ src +'`'));
                
                return;
            }                              
            
            
            var stats = fs.statSync(src); 
            
            if ( stats.isFile() ) { // single file compression
                // targeted filename  
                if ( typeof(options.name) != 'undefined' ) {
                    target += options.name+ '.zip';
                } else {
                    target += src.substr(src.lastIndexOf('/')+1) +'.zip';
                }  
            
                var input   = fs.createReadStream(src);
                var output  = fs.createWriteStream(target);
                        
                compressFile(options.method, input, output, function(err, target) {
                    self.emit('archiver#complete', err, target)
                });
            } else { // might be a fodler
                // targeted filename  
                if ( typeof(options.name) != 'undefined' ) {
                    target += options.name;
                } else {
                    target += src.substr(src.lastIndexOf('/')+1);
                }  
                
                browse(options.method, src, target, [], [], 0, null, function(err, target) {
                    self.emit('archiver#complete', err, target);
                });
            }
            
        } else if ( Array.isArray(src) ) { // compress from a list of files & folders
            
        } else {
            
        }
        
    }
    
    var compressFile = function(method, input, output, cb, isPackage) {
        
        var methodObject = null;
        isPackage = ( typeof(isPackage) == 'undefined' ) ? false: isPackage;
        
        switch (method) {
            case 'gzip':
                methodObject = zlib.createGzip();
                break;
        
            default:
                methodObject = zlib.createGzip();
                break;
        }
        
        
        if ( /\/\.(.*)$/.test(input.path) ) {
            // input
            //     .pipe(output); 
            if (isPackage) {
                cb(false, input)
            } else {
                cb(false, input.path)
            }  
            return 
        } else {
            input
                .pipe(methodObject)
                .pipe(output);   
        }
            
            
        output
            .on('error', function onCompressionError(err) {
                cb(err, null)
            })
            .on('finish', function onCompressionFinished(){
                if (isPackage) {
                    cb(false, this)
                } else {
                    cb(false, this.path)
                }                
            });            
        
    }
    
    var browse = function(method, dir, target, files, outFiles, i, mainOutput, cb) {
        
        var input  = null, output = null;
        var f = null, fLen = null;
        if (files.length == 0) {
            files.push(dir);
                        
            outFiles.push(target +'.zip');
            if ( fs.existsSync(outFiles[0])) {
                fs.unlinkSync(outFiles[0]);
            }
            
            mainOutput = fs.createWriteStream(outFiles[0]);
            
            // main zip dir
            target =  '.'+ dir.substr(dir.lastIndexOf('/'));            
            zip.folder(target);
            
            
            var list = fs.readdirSync(dir);
            f = 1; fLen = list.length;
            for (; f < fLen; ++f) {
                // input list
                files.push(dir +'/'+ list[f]);
                // output lis
                outFiles.push(target+ '/'+ list[f])
            }
            ++i
        }
        
        var filename  = files[i];
        
        if ( /^(\.|\.\.)$/.test(filename) ) {// ignore this
            browse(method, dir, target, files, outFiles, i+1, mainOutput, cb)
        }
        
        
        
        // completed
        if ( typeof(filename) == 'undefined' ) {               
            
            zip
                .generateNodeStream()
                .pipe(mainOutput);
                
            mainOutput
                .on('err', function(){                    
                    cb(err, null); 
                })
                .on('finish', function(){
                    mainOutput.close();
                    cb(false, this.path); 
                })
            
        } else {
            
            if ( !fs.existsSync(filename) ) {
                throw new Error('filename not found: '+ filename)
            }
            
            var stats = fs.statSync(filename);
            
            if ( stats.isFile() ) {
                
                
                zip.file(outFiles[i], fs.readFileSync(filename).toString());
                browse(method, dir, target, files, outFiles, i+1, mainOutput, cb)
                
                // input   = fs.createReadStream(filename);
                // output  = fs.createWriteStream(outFiles[i]);                
                
                // compressFile(method, input, output, function(err, output) {
                //     if (err) {
                //         cb(err, null)
                //     } else {
                //         zip.file(outFiles[i], fs.readFileSync(output.path).toString());
                //         browse(method, dir, target, files, outFiles, i+1, mainOutput, cb)
                //     }
                // }, true);
                        
            } else {
                var newDir = filename;
                var moreFiles = fs.readdirSync(newDir);
                
                var newTarget =  '.'+ newDir.substr(newDir.lastIndexOf(target.substr(1)));            
                zip.folder(newTarget);
            
                var index = i+1;
                f = 0; fLen = moreFiles.length;
                for (; f < fLen; ++f) {
                    // update input list
                    files.splice(index, 0, newDir +'/'+ moreFiles[f]);
                    // update output list
                    outFiles.splice(index, 0, newTarget +'/'+ moreFiles[f]);
                    
                    ++index;
                }
                
                browse(method, newDir, target, files, outFiles, i+1, mainOutput, cb)
            }  
        }           
                                  
    }
    
    
    
    this.decompress = function(src, target, options) {
        
    }
    
    this.compressFromData = function(data, target, options) {
        
    }
    
    this.compressHttpResponse = function(request, response) {
        
    }
    
    

    //return self
}

if ( typeof(module) !== 'undefined' && module.exports ) {
    // Publish as node.js module
    Archiver = inherits(Archiver, Emitter);
    module.exports = new Archiver()
} else if ( typeof(define) === 'function' && define.amd ) {
    // Publish as AMD module
    define(function() { return Archiver() })
}