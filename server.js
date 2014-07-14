"use strict";
//server.js

// Bring in external libraries
var fs           = require( 'fs' );
var crypto       = require( 'crypto' );
var jsonminify   = require( 'jsonminify' );
var https        = require( 'https' );
var http         = require( 'http' );
var path         = require( 'path' );
var express      = require( 'express' );
var underscore   = require( 'underscore' );
var resourceful  = require( 'resourceful' );
var winston      = require( 'winston' );
var Q            = require( 'q' );
var bodyParser   = require( 'body-parser' );
var errorHandler = require( 'errorhandler' );

Q.longStackSupport = true;

winston.remove( winston.transports.Console );
winston.add( winston.transports.Console, { level: 'info', colorize:true } );

// Setup global variables
GLOBAL._ = underscore._;

// Export pipeline object as a utility
exports.pipeline = require('./lib/pipeline');

var config = require('./src/config');

// Start the express app
GLOBAL.app = express();

app.set( 'SecureMode'  , config.server.mode );
app.set( 'BridgeConfig', config );

// Determine the port to listen on
var port = config.server.port || 3000;
process.env.PORT = port;

// Export important files for bridge configuration and setup
exports.config = config;

// Read in local modules
var loggerObj   = require( './src/logger'       );
var database    = require( './src/database'     );
var filters     = require( './src/filters'      );
var bridgeWare  = require( './src/middleware'   );
var mailer      = require( './src/mailer'       );
var routes      = require( './src/bridgeroutes' );
var regex       = require( './src/regex'        );
var bridgeError = require( './src/error'        );

// Prepare server variable
var server = null;

// Export local files for the API to use
exports.filters = filters;
exports.error   = bridgeError;

app.log = app.get('logger');

// Setting standard dictionary objects
// database reference
app.set( 'database',   database );
app.set( 'bridge-ext', {} );


app.set( 'views', config.mailer.viewPath );
app.set( 'view engine', 'ejs' );

app.engine( 'html', require( 'ejs' ).renderFile );

// Tell express that it is behind a proxy
app.enable( 'trust proxy' );

/////////////////////////////////////////////////////////////////////////////////////////
///////    STARTING SETUP OF MIDDLEWARE    //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Server any static content under that client folder
// Should be first due to wanting to server content before API whatever happens.
app.use( express.static( config.server.wwwRoot ) );

// Automatically parse the body to JSON
//app.use( express.json() );

// Decode URL Strings
//app.use( express.urlencoded() );

app.use( bodyParser.json() );

app.use( function ( req, res, next ) {
    app.get( 'logger' ).silly( {
        RequestBody: req.body
    } );
    next();
} );


// Add the CORS headers to the response
app.use( bridgeWare.attachCORSHeaders() );

// Handle CORS Request
app.use( bridgeWare.handleOptionsRequest() );

// Add the express error handler for default errors
//app.use( errorHandler() );

// create the Bridge Objects on the request and response
app.use( '/api/', bridgeWare.prepareBridgeObjects() );

// read the query string from a request and parse it as JSON
app.use( '/api/1.0/', bridgeWare.parseGetQueryString() );

app.use( '/api/1.0/', bridgeWare.verifyRequestStructure() );

// app.use( '/api/1.0/', bridgeWare.bridgeErrorHandler() );

// Setup bridge default routes
routes.setup();

setTimeout( function () {
    app.use( '/api/1.0/', bridgeWare.bridgeErrorHandler() );
}, 1000 );

/////////////////////////////////////////////////////////////////////////////////////////
///////     MIDDLEWARE SETUP COMPLETE      //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Setup the server for https mode
if ( config.server.mode === "https" ) {

    var credentials = {
        key: fs.readFileSync( config.server.secure.keyfilepath, 'utf8' ),
        cert: fs.readFileSync( config.server.secure.certificatefilepath, 'utf8' )
    };

    server = https.createServer( credentials, app );

}

// Else setup the server for http mode
else if ( config.server.mode === "http" ) {
    server = http.createServer( app );
}

// Listen on the port defined at the beginning of the script
server.listen( port );

// Log the start of the server
app.get( 'logger' ).info( "Express server listening on port %d in %s mode", port, config.server.environment );

// Setup the kill state handler
function cleanUp() {
    app.get( 'logger' ).info( "Termination signal received. Closing server." );
    database.close();
    mailer.close();
}

