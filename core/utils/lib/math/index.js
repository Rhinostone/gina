/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2014 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

var fs          = require('fs');
var console     = require('../logger');
var crypto      = require('crypto');

/**
 * MathHelper
 *
 * @package     gina.utils.math
 * @author      Rhinostone <gina@rhinostone.com>
 * @api public
 * */

function Math() {

    var self = this;

    /**
     * init
     * @constructor
     * */
    var init = function() {
        if ( typeof(Math.instance) != "undefined" ) {
            return Math.instance
        } else {
            Math.instance = self
        }
    }

    /**
     * operate from a string value
     *
     * e.g.:
     *
     *  var operate = require("gina").utils.math.operate;
     *  var calculation = "10*2";
     *  var result = operate(calculation);
     *      => 20
     *
     *  @param {string} calcultation
     *
     *  @return {number} result
     * */
    this.operate = function(calculation) {
        return new Function('return ' + calculation)()
    }

    var checkSum = function (str, algorithm, encoding) {
        return crypto
            .createHash(algorithm || 'md5')
            .update(str, 'utf8')
            .digest(encoding || 'hex')
    }

    this.checkSum = function(filename, algorithm, encoding, cb) {
        if (arguments.length < 4) {
            var cb = arguments[arguments.length-1]
        }

        fs.readFile(filename, function (err, data) {
            checkSum(data);         // e53815e8c095e270c6560be1bb76a65d
            //checkSum(data, 'sha1'); // cd5855be428295a3cc1793d6e80ce47562d23def
        })
    }

    this.checkSumSync = function(filename, algorithm, encoding) {
        try {
            return checkSum( fs.readFileSync(filename), algorithm, encoding )
        } catch (err) {
            console.error(err.stack||err.message);
            return undefined
        }
    }

    // for big files only: > 1Mb
    //this.checkSumBig= function(filename, cb) {
    //    var hash = crypto.createHash('md5');
    //    var encryption = encryption || 'sha1';
    //
    //    var stream = fs.createReadStream(filename);
    //    stream.on('data', function (data) {
    //        hash.update(data, 'utf8')
    //    })
    //
    //    stream.on('end', function () {
    //        hash.digest('hex');
    //    })
    //}

    init();
    return this
}
module.exports = Math()