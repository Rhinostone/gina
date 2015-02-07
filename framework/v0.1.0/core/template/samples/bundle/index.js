/**
 * {Bundle} bundle
 *
 * */
//import sample
//var session = require('express-session');
var {bundle} = require('gina');

// do whatever things you need to do before server starts
//{bundle}.onInitialize( function(event, app, express){//
//    // you can use express middleware components
//    // eg.: app.use( session({secret: '1234567890QWERTY'}) );
//
//    //then notify the server that startup sequence can be resumed
//    event.emit('complete', app);// this is important !
//});

{bundle}.start();