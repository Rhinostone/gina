/**
 * ${Bundle} bundle
 *
 * */
var ${bundle} = require('gina');

// gina lib samples
// var lib             = ${bundle}.lib;
// var routing         = lib.routing;
// var console         = lib.logger;
// var operate         = lib.math.operate;
// var Collection      = lib.Collection;
// var SessionStore    = lib.SessionStore; // see: https://gina.io/docs/guides/sessions
// var Domain          = lib.Domain;


// Do whatever things you need to do before server starts
// e.g.: register session, set a shared path for your template engine ...
// This is mostly pre-start configuration
//${bundle}.onInitialize( function(event, app, express){//
//    var self = ${bundle};
//    // getting config/app.json would be: self.getConfig('app')
//    // or self.getConfig().app
//    var conf = self.getConfig();
//
//    // --- Session store (pick one backend) ---
//    // var expressSession = require('express-session');
//    //
//    // #CSRF1 — wrap express-session with hardened cookie defaults from
//    // settings.json > session.cookie.* (SameSite=Lax, HttpOnly, Secure="auto").
//    // The bundle's cookie options below still override the defaults.
//    // var session = ${bundle}.plugins.Session(expressSession);
//    //
//    // Redis — multi-pod / K8s (requires: npm install ioredis)
//    // Configure connectors.json: { "myRedis": { "connector": "redis", "host": "...", "port": 6379, "ttl": 86400 } }
//    // expressSession.name = 'myRedis';
//    //
//    // SQLite — dev / staging / single-pod (requires: Node >= 22.5.0, zero npm deps)
//    // Configure connectors.json: { "myDb": { "connector": "sqlite", "database": ":memory:", "ttl": 86400 } }
//    // expressSession.name = 'myDb';
//    //
//    // var StoreClass = new SessionStore(expressSession);  // returns connector-specific Store class
//    //
//    // Recommended: keep the session secret out of tracked source via the
//    // ${secret:KEY} placeholder pattern. Put it in bundle/config/session.json:
//    //   { "secret": "${secret:SESSION_SECRET}" }
//    // then read via self.getConfig('session').secret. lib/secrets fills
//    // the placeholder from process.env.SESSION_SECRET at config-load time.
//    // See https://gina.io/docs/guides/secrets for details.
//    //
//    // app.use(session({
//    //     secret           : self.getConfig('session').secret,  // ${secret:SESSION_SECRET}
//    //     resave           : false,
//    //     saveUninitialized: false,
//    //     store            : new StoreClass(),
//    //     cookie           : { maxAge: 86400000 }
//    // }));
//    //
//    // #CSRF2 — signed double-submit token middleware. Reads its HMAC secret
//    // from settings.json > csrf.secret (recommended; supports ${secret:KEY}
//    // placeholders), or falls back to process.env.GINA_CSRF_SECRET
//    // (back-compat). Generate the secret once with `openssl rand -base64 64`.
//    // MUST be registered AFTER the session middleware. Per-route opt-out
//    // for webhook receivers via `routing.json > "csrfExempt": true`.
//    // var csrf = ${bundle}.plugins.Csrf();
//    // app.use(csrf);
//
//    // #HDR1 — X-Content-Type-Options: nosniff response header. Blocks
//    // MIME-sniffing attacks by instructing browsers to trust the declared
//    // Content-Type strictly. No required configuration; nosniff is the
//    // only valid value per RFC 7034. Order with other gina security
//    // plugins does not matter — the header is emitted on the response,
//    // not consumed from the request.
//    // var xContentTypeOptions = ${bundle}.plugins.XContentTypeOptions();
//    // app.use(xContentTypeOptions);
//
//    // you can also use express middleware components directly (no #CSRF1 hardening)
//    // eg.: app.use( expressSession({secret: process.env.SESSION_SECRET}) );
//
//    //then notify the server that startup sequence can be resumed
//    event.emit('complete', app);// this is important !
//});

// If you need to do something once the server has started
// e.g.: start a cron or a watcher
// ${bundle}.onStarted(function(){
//     console.info('${bundle} has started ! ');
// });

// Catch unhandled errors
${bundle}.onError(function(err, req, res, next){
    console.error('[ BOOTSTRAP ] <${bundle}> fatal error: ' + err.message + '\nstack:\n'+ err.stack);
    next(err);
});

${bundle}.start();