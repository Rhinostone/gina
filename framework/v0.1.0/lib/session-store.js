/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2022 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
var fs          = require('fs');

//var inherits = require(require.resolve('./inherits'));
var helpers = require('./../helpers');
var console = require('./logger');

function SessionStore(session) {
    
    var ctx                 = getContext()
        , bundle            = ctx.bundle
        , env               = ctx.env
        , conf              = getConfig()[bundle][env]
        , connectorsPath    = conf.connectorsPath
        , connector         = conf.content.connectors[session.name].connector;
    ; 
    var connectorName = 'couchbase';
    var filename = _(connectorsPath + '/'+ connector +'/lib/session-store.js', true);
    
    if ( !fs.existsSync(filename) ) {
        throw new Error('SessionStore could not be loaded: `'+ filename+'` is missing');
    }
    
    return require(filename)(session, bundle)
};
    
module.exports = SessionStore;