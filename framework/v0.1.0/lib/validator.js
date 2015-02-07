var fs      = require('fs');
var helpers = require('./helpers');
var merge   = require('./merge');
var console = require('./logger');

/**
 * @class Validator
 *
 * e.g.:
 *  var data = req.post;
 *  var d = new Validator(data);
 *
 *  if ( data.count() > 0 ) {
 *      d.username
 *           .isRequired()
 *           .isString(0, 10)
 *           .isEmail();
 *  }
 *
 *  TODO - validate date against country_code or pattern yyyy-mm-dd
 *
 * */
function Validator(data, errorLabels) {

    var local = {
        errors: {},
        keys: {
            '%n': 'label', // %f => field name
            '%s': 'size' // %l => length
        },
        errorLabels: {
            is: 'condition not satisfied',
            isEmail: '%n not valid',
            isRequired: '%n is required',
            isString: '%n must be an instance of String',
            validStringWithLen: '%n should be a %s characters length',
            validStringWithMaxLen: '%n should not be more than %s characters',
            validStringWithMinLen: '%n should be at least %s characters'
        },
        data: {} // output to send
    };

    if (!data) {
        throw new Error('missing data param');
        return false
    } else {
        // cloning
        var self  = JSON.parse( JSON.stringify(data) );
        local.data = JSON.parse( JSON.stringify(data) )
    }

    if ( typeof(errorLabels) != 'undefined') {
        local.errorLabels = merge(errorLabels, local.errorLabels)
    }

    for (var el in self) {
        var val;
        if ( typeof(self[el]) == 'object' ) {
            try {
                val = JSON.parse( JSON.stringify( self[el] ))
            } catch (err) {
                val = self[el]
            }
        } else {
            val = self[el]
        }
        self[el] = {
            value: val,
            name: el,
            // is name by default, but you should use setLabe(name) to change it if you need to
            label: el,
            // check as field to exclude while sending datas to the model
            exclude: false
        };

        /**
         *
         * is(regex)       -> validate if value matches regex
         *
         * @param {object|string} regex - RegExp oject or condition to eval
         *
         * */
        self[el].is = function(regex, flash) {
            var valid = true;
            if ( regex instanceof RegExp ) {
                valid = regex.test(this.value) ? true : false;
            } else {
                try {
                    valid = regex
                } catch (err) {
                    throw new Error(err.stack||err.message)
                }
            }

            if (!valid) {
                if ( !(local.errors[this.name]) )
                    local.errors[this.name] = {};

                local.errors[this.name].is = replace(this.flash || flash || local.errorLabels.is, this)
            }

            return self[this.name]
        }

        self[el].isEmail = function() {
            var rgx = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            var valid = rgx.test(this.value) ? true : false;
            if (!valid) {
                if ( !(local.errors[this.name]) )
                    local.errors[this.name] = {};

                local.errors[this.name].isEmail = replace(this.flash || local.errorLabels.isEmail, this)
            }

            return self[this.name]
        }

        self[el].isRequired = function() {
            var valid = (typeof(this.value) != 'undefined' && this.value != null && this.value != '') ? true : false;

            if (!valid) {
                if ( !(local.errors[this.name]) )
                    local.errors[this.name] = {};

                local.errors[this.name].isRequired = replace(this.flash || local.errorLabels.isRequired, this)
            }

            return self[this.name]
        }
        /**
         *
         * isString()       -> validate if value is string
         * isString(10)     -> validate if value is at least 10 chars length
         * isString(0, 45)  -> no minimum length, but validate if value is maximum 45 chars length
         *
         * @param {number|undefined} minLen
         * @param {number} [ maxLen ]
         * */
        self[el].isString = function(minLen, maxLen) {
            var validString = ( typeof(this.value) == 'string' ) ? true : false;
            var validStringWithMinLen = true, validStringWithMaxLen = true;
            // max or min - valid if true
            if ( minLen && typeof(minLen) == 'number') {
                validStringWithMinLen = ( this.value.length >= minLen) ? true : false;
                this.size = minLen;
            } else if ( maxLen && typeof(maxLen) == 'number' ) {
                validStringWithMaxLen = ( this.value.length <= maxLen) ? true : false;
                this.size = maxLen;
            }

            if ( !validString || !validStringWithMinLen || !validStringWithMaxLen ) {
                if ( !local.errors[this.name] ) local.errors[this.name] = {}
            }

            if ( !validString ) local.errors[this.name].isString = replace(this.flash || local.errorLabels.isString, this);
            if ( !validStringWithMinLen && minLen) local.errors[this.name].validStringWithMinLen = replace(this.flash || local.errorLabels.validStringWithMinLen, this);
            if ( !validStringWithMaxLen && maxLen ) local.errors[this.name].validStringWithMaxLen = replace(this.flash || local.errorLabels.validStringWithMaxLen, this);

            return self[this.name]
        }

        /**
         * Set flash
         *
         * @param {str} flash
         * */
        self[el].setFlash = function(regex, flash) {
            if ( typeof(flash) != 'undefined' && flash != '') {
                this.flash = flash
            }
            return self[this.name]
        }

        /**
         * Set label
         *
         * @param {str} label
         * */
        self[el].setLabel = function(label) {
            if ( typeof(label) != 'undefined' && label != '') {
                this.label = label
            }
            return self[this.name]
        }

        /**
         * Exclude when converting back to datas
         *
         * @return {object} data
         * */
        self[el].exclude = function() {
            //clonning
            for (var d in local.data) {
                if (d === this.name) { //cleaning
                    delete local.data[d]
                }
            }

            return self[this.name]
        }

    } // EO for (var el in self)

    /**
     * Check if errors found during validation
     *
     * @return {boolean}
     * */
    self.isValid = function() {
        var i = local.errors.count();
        var valid = true;

        if (i > 0) {
            valid = false;
            // exporting errors
            self.errors = local.errors
        }
        return valid
    }

    self.toData = function() {
        return local.data
    }

    var replace = function(target, fieldObj) {
        var keys = target.match(/%[a-z]+/gi);
        if (keys) {
            for (var k=0; k<keys.length; ++k) {
                target = target.replace(new RegExp(keys[k], 'g'), fieldObj[local.keys[keys[k]]])
            }
        }
        return target
    }

    return self
};

module.exports = Validator;