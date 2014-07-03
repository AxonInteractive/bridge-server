"use strict";
//server.js

// Bring in external libraries
var fs          = require( 'fs'          );
var crypto      = require( 'crypto'      );
var jsonminify  = require( 'jsonminify'  );
var https       = require( 'https'       );
var http        = require( 'http'        );
var path        = require( 'path'        );
var express     = require( 'express'     );
var underscore  = require( 'underscore'  );
var resourceful = require( 'resourceful' );
var winston     = require( 'winston'     );

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, { level: 'info', colorize:true });

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
exports.app    = app;
exports.config = config;

// Read in local modules
var loggerObj  = require( './src/logger'       );
var database   = require( './src/database'     );
var filters    = require( './src/filters'      );
var bridgeWare = require( './src/middleware'   );
var mailer     = require( './src/mailer'       );
var routes     = require( './src/bridgeroutes' );
var regex      = require( './src/regex'        );

// Prepare server variable
var server = null;

// Export local files for the API to use
exports.filters         = filters;

// Prepare a steam in which for express to be able to write to winston
var logStream = {
    write: function ( message, encoding ) {
        app.get( 'logger' ).silly( 'Request: ' + message );
    }
};

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

app.use( express.logger( {
    stream: logStream
} ) );

// development only settings
if ( 'development' == config.server.environment ) {
    app.use( express.errorHandler( {
        dumpExceptions: true,
        showStack: true
    } ) );
}

// production only settings
if ( 'production' == config.server.environment) {
    app.use( express.errorHandler() );
}

// Automatically parse the body to JSON
app.use( express.json() );

// Decode URL Strings
app.use( express.urlencoded() );

app.use( function ( req, res, next ) {
    app.get( 'logger' ).silly( {
        "Request Body: ": req.body
    } );
    next();
} );

// Add the CORS headers to the response
app.use( bridgeWare.attachCORSHeaders );

// Handle CORS Request
app.use( bridgeWare.handleOptionsRequest );

// create the Bridge Objects on the request and response
app.use( bridgeWare.prepareBridgeObjects );

// read the query string from a request and parse it as JSON
app.use( bridgeWare.parseGetQueryString );

// Standard Request Middleware for Verification of content for any API Calls
//app.use( /^\/api\/.+/, bridgeWare.verifyRequestStructure );

app.use( '/api/1.0/', bridgeWare.verifyRequestStructure );

// Use the router to route messages to the appropriate locations
app.use( app.router );

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

// Setup bridge default routes
routes.setup();

// Log the start of the server
app.get( 'logger' ).info( "Express server listening on port %d in %s mode", port, config.server.environment );

// Setup the kill state handler
function cleanUp() {
    app.get( 'logger' ).info( "Termination signal received. Closing server." );
    database.close();
    mailer.close();
}

/////////////////////////////////////////////////////////////////////////////////////////
///////   CHECKING FOR STANDARD ROUTES   ////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Checking the API to see if the correct routes have been setup by the API
 * @return {Undefined}
 */
setTimeout( function () {

    var routes = app.routes;
    var foundRegister = false;
    var foundLogin = false;
    var regex;
    var method;

    {

        regex = /.*\/users$/;
        method = routes.put;

        method.forEach( function ( element ) {
            var reg = regex.exec( element.path );

            if ( reg !== null ) {
                foundRegister = true;
            }
        } );

    } {

        regex = /.*\/login$/;
        method = routes.get;

        method.forEach( function ( element ) {
            var reg = regex.exec( element.path );

            if ( reg !== null ) {
                foundLogin = true;
            }
        } );

    }

    if (!foundLogin) {
        app.get( 'logger' ).error( "No login route found. this is needed for the normal operation of bridge" );
    }

    if ( !foundRegister ) {
        app.get( 'logger' ).error( "No register route found. this is needed for the normal operation of bridge" );
    }

    // var mail = {
    //     //to: "helocheck@cbl.abuseat.org",
    //     to: "info@jameszinger.com",
    //     from: "dev@jameszinger.com",
    //     subject: "Testing Mailer",
    //     html: "<h1>This is the HTML Body</h1>"
    // };

    // app.get( 'logger' ).info( 'Attempting to send mail', mail );

    // if ( mailer.sendMail( mail ) ) {
    //     app.get( 'logger' ).info( 'Mail sent successfully' );
    // }
    // else {
    //     app.get( 'logger' ).info( "Mail didn't send successfully", mail );
    // }

}, 1000 );



/////////////////////////////////////////////////////////////////////////////////////////
///////   CHECKING FOR STANDARD ROUTES COMPLETE   ///////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////