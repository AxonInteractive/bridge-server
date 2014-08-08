"use strict";
//server.js

// Bring in external libraries
var fs         = require( 'fs'          );
var https      = require( 'https'       );
var http       = require( 'http'        );
var path       = require( 'path'        );
var express    = require( 'express'     );
var underscore = require( 'underscore'  );
var winston    = require( 'winston'     );
var Q          = require( 'q'           );
var bodyParser = require( 'body-parser' );

Q.longStackSupport = true;

winston.remove( winston.transports.Console );
winston.add( winston.transports.Console, { level: 'info', colorize:true } );

// Setup global variables
var _ = underscore._;
exports._ = _;
exports.express = express;

var config = require('./src/config');
// Export important files for bridge configuration and setup
exports.config = config;

// Start the express app
var app = exports.app = express();

// Determine the port to listen on
var port = config.server.port;
process.env.PORT = port;



// Read in local modules that are to be exported
var regex       = require( './src/regex' );
var bridgeError = require( './src/error' );
var util        = require( './src/utilities');

exports.error    = bridgeError;
exports.regex    = regex;
exports.util     = util;

var database    = require( './src/database' );

// Export local files for the API to use
exports.database = database;

// Read in non exported local modules
var loggerObj   = require( './src/logger' );
var bridgeWare  = require( './src/middleware' );

var mailer      = require( './src/mailer' );
var routes      = require( './src/bridgeroutes' );

// Prepare server variable
var server = null;

// Setting standard dictionary objects
// database reference
app.set( 'views', config.mailer.viewPath );
app.set( 'view engine', 'ejs' );

app.engine( 'html', require( 'ejs' ).renderFile );

// Tell express that it is behind a proxy
app.enable( 'trust proxy' );

/////////////////////////////////////////////////////////////////////////////////////////
///////    STARTING SETUP OF MIDDLEWARE    //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

app.use( function ( req, res, next ) {

    var typeRegex =  /\.[A-Za-z0-9]+$/;

    var regexResult = typeRegex.exec( req.path );

    if ( _.isUndefined( regexResult ) ) {
        next();
        return;
    }

    if ( _.isNull( regexResult ) ) {
        next();
        return;
    }

    if ( regexResult.length === 0 ) {
        next();
        return;
    }

    var extension = regexResult[ regexResult.length - 1 ];

    var type = extension.slice(1, extension.length );

    res.type( type );

    app.log.debug( "Setting the content type to: " + res.get( 'Content-Type' ) );

    next();
} );

// Server any static content under that client folder
// Should be first due to wanting to server content before API whatever happens.
app.use( express.static( config.server.wwwRoot ) );

// Automatically parse the body to JSON
app.use( bodyParser.json() );

app.use( function ( req, res, next ) {
    app.log.silly( {
        RequestBody: req.body,
        Method: req.method,
        Resource: req.path
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
app.use( '/api/', bridgeWare.parseGetQueryString() );

app.use( '/api/1.0/', bridgeWare.verifyRequestStructure() );

// Setup bridge default routes
routes.setup();

setTimeout( function () {

    app.use( '/api/1.0/', bridgeWare.bridgeErrorHandler() );

    app.all( '*', function ( req, res, next ) {

        if ( _.has( res, 'finished' ) && res.finished === true ) {
            next();
            return;
        }

        res.status( 404 );

        var NotFoundPath = path.join( config.server.wwwRoot, "404.html" );

        fs.exists(NotFoundPath, function(exists){

            if (!exists) {
                res.send( "404 - Not found" );
                next();
                return;
            }

            res.sendfile( NotFoundPath );

        } );

        return;
    } );

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
app.log.info( "Express server listening on port %d in %s mode", port, config.server.environment );

// Setup the kill state handler
function cleanUp() {
    app.log.info( "Termination signal received. Closing server." );
    database.close();
    mailer.close();
}
