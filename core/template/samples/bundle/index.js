/**
 * {Bundle} bundle
 *
 * */
var {bundle} = require('geena');
//{bundle}.onInitialize( function(event, app, express){
//    // do whatever things you need to do before server starts
//    // you can use express middleware components
//    // eg.: app.use( express.session({secret: '1234567890QWERTY'}) );
//
//    //then notify the server that startup sequence can be resumed
//    event.emit('complete', app);// this is important !
//});
{bundle}.start();