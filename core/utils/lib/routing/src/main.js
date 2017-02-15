/*
 * This file is part of the gina package.
 * Copyright (c) 2016 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

//var ContextHelper = require('./context');

/**
 * Routing
 *
 * @package     Gina.Utils
 * @namespace   Gina.Utils.Lib.Routing
 * @author      Rhinostone <gina@rhinostone.com>
 * */

function Routing() {

    var self        = {};

    /**
     * @function getRoute
     *
     * @param {string} content to be printed by the terminal
     * @param {object} params
     *
     * @return {object} route
     * */
    self.getRoute = function(rule, params) {

        var config      = getContext('gina').config
        var bundle      = null;

        if ( /\@/.test(rule) ) {
            bundle = rule.split(/\@/)[1];
        } else {
            bundle    = config.bundle
        }

        var env     = config.env
        , routing   = config.getRouting(bundle, env);

        if ( typeof(routing[rule]) == 'undefined' ) {
            throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' +rule + '` not found !')
        }

        var route = JSON.parse(JSON.stringify(routing[rule]));
        var variable = null
        for (var p in route.param) {
            if ( /^:/.test(route.param[p]) ) {
                variable = route.param[p].substr(1);
                if ( typeof(params[variable]) != 'undefined') {
                    route.url = route.url.replace( new RegExp('(/:'+variable+'|/:'+variable+'$)', 'g'), '/'+ params[variable] );

                    if ( typeof(route.param.path) != 'undefined' && /:/.test(route.param.path) ) {
                        route.param.path = route.param.path.replace( new RegExp('(:'+variable+'/|:'+variable+'$)', 'g'), params[variable]);
                    }
                }
            }
        }

        return route

    };

    return self
};
module.exports = Routing()