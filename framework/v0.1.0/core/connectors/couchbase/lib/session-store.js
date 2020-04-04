var fs = require('fs');
var gina            = require('../../../../core/gna');
var utils           = gina.utils;
var console         = utils.logger;

var defaultVersion = 2;
var version = JSON.parse(fs.readFileSync(GINA_FRAMEWORK_DIR + '/package.json')).dependencies.couchbase;
version = version.replace(/\^/, '').split(/\./)[0];

var filename = _(GINA_FRAMEWORK_DIR + '/core/connectors/couchbase/lib/session-store.v'+ version +'.js', true);
if ( !fs.existsSync(filename) ) {
    console.warn('Couchbase session-store file not found: ', filename);
    filename = filename = _(GINA_FRAMEWORK_DIR + '/core/connectors/couchbase/lib/session-store.v'+ defaultVersion +'.js', true);
    console.warn('Couchbase session-store will instead use: ', filename);
}

module.exports = require(filename);