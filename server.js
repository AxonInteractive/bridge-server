"use strict";
//server.js

// Bring in external libraries
var fs         = require( 'q-io/fs'     );
var https      = require( 'https'       );
var http       = require( 'http'        );
var path       = require( 'path'        );
var express    = require( 'express'     );
var lodash     = require( 'lodash'      );
var winston    = require( 'winston'     );
var Q          = require( 'q'           );
var bodyParser = require( 'body-parser' );
var onHeaders  = require( 'on-headers'  );

Q.longStackSupport = true;

winston.remove( winston.transports.Console );
winston.add( winston.transports.Console, { level: 'verbose', colorize:true } );

// Setup global variables
var _ = lodash._;

exports.express = express;

// Mixin the underscore.string lib
// Import Underscore.string to separate object, because there are conflict functions (include, reverse, contains)
_.str = require( 'underscore.string' );

// Mix in non-conflict functions to Underscore namespace if you want
_.mixin( _.str.exports() );

var config = require( './src/config' );

// Export important files for bridge configuration and setup
exports.config = config;

// Start the express app
var app = exports.app = express();

// Create the routers that will be used by the bridge app.
var routerOptions = { caseSensitive: true };
app.set( 'privateRouter' , express.Router( routerOptions ) );
app.set( 'publicRouter'  , express.Router( routerOptions ) );

// Determine the port to listen on
var port = config.server.port;
process.env.PORT = port;

var loggerObj  = require( './src/logger' );

// Read in local modules that are to be exported
var regex        = require( './src/regex' );
var bridgeError  = require( './src/error' );
var util         = require( './src/utilities' );
var pdfGenerator = require( './src/html2pdf' );

exports.error        = bridgeError;
exports.regex        = regex;
exports.util         = util;
exports.pdfGenerator = pdfGenerator;

var database    = require( './src/database' );

// Export local files for the API to use
exports.database = database;

// Read in non exported local modules
var bridgeWare = require( './src/middleware' );
var mailer     = require( './src/mailer' );
var routes     = require( './src/bridgeroutes' );

// Prepare server variable
var server = null;

// Setting standard dictionary objects
// database reference
app.set( 'views', config.mailer.templateDirectory );
app.set( 'view engine', 'ejs' );

app.engine( 'html', require( 'ejs' ).renderFile );
app.engine( 'ejs',  require( 'ejs' ).renderFile );

// Tell express that it is behind a proxy
app.enable( 'trust proxy' );

/////////////////////////////////////////////////////////////////////////////////////////
///////    STARTING SETUP OF MIDDLEWARE    //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Setup the response logger event handler.
app.use( function( req, res, next ) {
    onHeaders( res, function() {
        app.log.silly( 'Response headers: ', res._headers );
    } );
    next();
} );

// // Setup the cookie parser
// app.use( bridgeWare.getCookies() );

// Setup the request logger
app.use( function ( req, res, next ) {

    app.log.silly( "Received Request: ", {
        RequestBody: req.body,
        BridgeHeader: req.get( 'bridge' ),
        Method: req.method,
        Resource: req.path,
        Secure: req.secure,
        XHR: req.xhr,
        Protocol: req.protocol,
        BridgeCookie: req.bridge.cookies.get( 'bridge-auth' )
    } );

    next();
} );

// Static hosting Middleware
app.use( bridgeWare.staticHostFiles() );

// Serve the index if it is a GET request for '/'
app.get( '/', routes.serveIndex );

// Handle an authentication request
app.post( '/authenticate', require( './src/requests/authenticate' ) );

// Automatically parse the body to JSON
app.use( bodyParser.json() );

// Add the CORS headers to the response
app.use( bridgeWare.attachCORSHeaders() );

// Handle CORS Request
app.use( bridgeWare.handleOptionsRequest() );

// Use the public router to send
app.use( config.server.publicAPIRoute,  app.get( "publicRouter" ) );

// Use the private router to try to interpret the route
app.use( config.server.privateAPIRoute, app.get( "privateRouter" ) );

//
app.use( '/api/1.0/', bridgeWare.parseBridgeHeader() );

//
app.use( '/api/1.0/', bridgeWare.verifyRequestStructure() );

// Error Handler
app.use( bridgeWare.bridgeErrorHandler() );

// 404 Handler
app.log.debug( "404 handler setup" );
app.all( '*', function ( req, res, next ) {

    if ( _.has( res, 'finished' ) && res.finished === true ) {

        next();
        return;
    }

    routes.send404( req, res );
    return;
} );

// Setup bridge default router
routes.setup();

/////////////////////////////////////////////////////////////////////////////////////////
///////     MIDDLEWARE SETUP COMPLETE      //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Setup the server for https mode
if ( config.server.mode === "https" ) {

    var keyFound = false,
        keyContent,
        certFound = false,
        certContent;

    var checkIfKeyAndCertAreLoaded = function () {
        if ( !keyFound || !certFound ) {
            return;
        }

        var credentials = {
            key: keyContent,
            cert: certContent
        };

        server = https.createServer( credentials, app );

        // Listen on the port defined at the beginning of the script
        server.listen( port );

        // Log the start of the server
        app.log.info( "Express server listening on port %d in %s mode", port, config.server.environment );
        app.log.info( "Server is now running!" );
    };

    fs.read( config.security.sshKeys.privateKeyfilepath )
        .then( function( content ) {
            keyFound = true;
            keyContent = content;

            checkIfKeyAndCertAreLoaded();
        } )
        .fail( function( err ) {
            app.log.error( 'Failed to load private key file. Check your private key file path. Error: ',
                 err );
        } );

    fs.read( config.security.sshKeys.certificatefilepath )
        .then( function( content ) {
            certFound = true;
            certContent = content;

            checkIfKeyAndCertAreLoaded();
        } )
        .fail( function( err ) {
            app.log.error( 'Failed to load certificate file. Check your certificate file path. Error: ',
                err );
        } );
}

// Else setup the server for http mode
else if ( config.server.mode === "http" ) {
    server = http.createServer( app );

    // Listen on the port defined at the beginning of the script
    server.listen( port );

    // Log the start of the server
    app.log.info( "Express server listening on port %d in %s mode", port, config.server.environment );
    app.log.info( "Server is now running!" );
}


// Setup the kill state handler
function cleanUp() {
    app.log.info( "Termination signal received. Closing server." );
    database.close();
    mailer.close();
}

process.stdin.resume();//so the program will not close instantly

function exitHandler(options, err) {
    if (options.cleanup) {
        app.log.debug( 'Bridge application closing. Good Bye!' );
    }
    if (err) {
        app.log.error(err.stack);
    }
    if (options.exit) {
        process.exit();
    }
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
