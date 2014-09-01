/*
 * This file is part of the geena package.
 * Copyright (c) 2009-2014 Rhinostone <geena@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * MathHelper
 *
 * @package     geena.utils.helpers
 * @author      Rhinostone <geena@rhinostone.com>
 * @api public
 * */

function MathHelper() {
    /**
     * operate from a string value
     *
     * e.g.:
     *
     *  var operate = require("geena").utils.math.operate;
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

    return this
}
module.exports = MathHelper