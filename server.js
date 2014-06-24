"use strict";
//server.js

// Bring in external libraries
var fs         = require( 'fs'         );
var crypto     = require( 'crypto'     );
var jsonminify = require( 'jsonminify' );
var https      = require( 'https'      );
var http       = require( 'http'       );
var path       = require( 'path'       );
var express    = require( 'express'    );
var underscore = require( 'underscore' );

// Setup global variables
GLOBAL._ = underscore._;

// Export pipeline object as a utility
exports.pipeline = require('./lib/pipeline');

var config;

// Check if the file exists. if not create a default configuration to use
if ( !fs.existsSync( 'BridgeConfig.json' ) ) {
    config = {
        "default": true,
        server: {
            mode: "insecure",
            port: 3000,
            emailVerification: true
        },
        database: {
            user: "root",
            password: "",
            host: "localhost",
            database: "bridge"
        },
        logger: {
            exception: {
                filename: "logs/exceptions.log",
                writetoconsole: true
            },
            server: {
                filename: "logs/server.log",
                level: "debug",
                consoleLevel: "warn"
            },
            console: {
                level: "info"
            }
        },
        mailer: {
            method: "Direct",
            options: {}
        }
    };
}

// If the file exists load it.
else
{
    // Parse the configuration file from the application
    var configStr = fs.readFileSync( 'BridgeConfig.json', 'utf8' );
    config = JSON.parse( JSON.minify( configStr ) );
}



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

// Setting standard dictionary objects
// database reference
app.set( 'database',   database );
app.set( 'bridge-ext', {} );

// Tell express that it is behind a proxy
app.enable( 'trust proxy' );

/////////////////////////////////////////////////////////////////////////////////////////
///////    STARTING SETUP OF MIDDLEWARE    //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Use the logging middleware to log requests using the stream above
app.use( express.logger( {
    stream: logStream
} ) );

// Server any static content under that client folder
// Should be first due to wanting to server content before API whatever happens.
app.use( express.static( './client' ) );

// development only settings
if ( 'development' == app.get( 'env' ) ) {
    app.use( express.errorHandler( {
        dumpExceptions: true,
        showStack: true
    } ) );
}

// production only settings
if ( 'production' == app.get( 'env' ) ) {
    app.use( express.errorHandler() );
}

app.use(function(req, res, next){

    var wha = req;

    next();
});

// Automatically parse the body to JSON
app.use( express.json() );

// Decode URL Strings
app.use( express.urlencoded() );

// Provides faux HTTP method support.
//app.use(express.methodOverride());

// Add the CORS headers to the response
app.use( bridgeWare.attachCORSHeaders );

// Handle CORS Request
app.use( bridgeWare.handleOptionsRequest );

// create the Bridge Objects on the request and response
app.use( bridgeWare.prepareBridgeObjects );

// read the query string from a request and parse it as JSON
app.use( bridgeWare.parseGetQueryString );

// Standard Request Middleware for Verification of content for any API Calls
app.use( bridgeWare.verifyRequestStructure );

// Use the router to route messages to the appropriate locations
app.use( app.router );

/////////////////////////////////////////////////////////////////////////////////////////
///////     MIDDLEWARE SETUP COMPLETE      //////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////

// Setup the server for https mode
if ( config.server.mode === "secure" ) {
    var credentials = {
        key: fs.readFileSync( config.server.secure.keyfilepath, 'utf8' ),
        cert: fs.readFileSync( config.server.secure.certificatefilepath, 'utf8' )
    };

    server = https.createServer( credentials, app );

}

// Else setup the server for http mode
else if ( config.server.mod === "insecure" ) {
    server = http.createServer( app );
}

// Listen on the port defined at the beginning of the script
server.listen( port );

// Setup bridge default routes
routes.setup();

// Log the start of the server
app.get( 'logger' ).info( "Express server listening on port %d in %s mode", port, app.settings.env );

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