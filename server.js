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
var userAgent  = require( 'express-useragent' );
var moment     = require( 'moment' );
var compress   = require('compression');
var constants  = require('constants');

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

// Start the express app
var app = exports.app = express();

var config = require( './src/config' );

// Export important files for bridge configuration and setup
exports.config = config;

if ( config.server.hostname.substr( -1 ) === '/' ) {
    config.server.hostname = config.server.hostname.substr( 0, config.server.hostname.length - 1 );
}

// Set the host variable in the application
app.set( 'host', config.server.hostname );

var rootURL = config.server.mode + "://" + app.get( 'host' );

// Set the rootURL variable that has a trailing slash
app.set( 'rootURL', config.server.mode + "://" + app.get( 'host' ) + "/" );



// Create the routers that will be used by the bridge app.
var routerOptions = { caseSensitive: true };
app.set( 'privateRouter' , express.Router( routerOptions ) );
app.set( 'publicRouter'  , express.Router( routerOptions ) );

// Determine the port to listen on
var port = config.server.port;
process.env.PORT = port;

var loggerObj  = require( './src/logger' );

app.log.debug( "App host: ", app.get( 'host' ) );
app.log.debug( "App root URL: ", app.get( 'rootURL' ) );

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

// Remove the header that displays that express powers the application.
app.disable('x-powered-by');

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
        app.log.verbose( "Sending Response." );
        app.log.silly( 'Response headers: ', res._headers );

        if ( _.isObject( req.bridge ) ) {
            if ( _.isObject( req.bridge.dbLogger ) ) {
                req.bridge.dbLogger.data.responseHeaders = res._headers;
                req.bridge.dbLogger.data.bridgeHeader = req.get( 'bridge' );

                var values = [];

                values.push( req.bridge.dbLogger.userID  );
                values.push( JSON.stringify( req.bridge.dbLogger.data )  );
                values.push( req.bridge.dbLogger.datatype );
                values.push( moment().format( 'YYYY-MM-DD HH:mm:ss' ) );
                values.push( moment().format( 'YYYY-MM-DD HH:mm:ss' ) );
                values.push( 0 );

                database.insertIntoTable( 'actions', values )
                .fail( function( err ) {
                    app.log.warn( "Cannot insert action into the actions table. Error: ", err );
                } );
            }
        }
    } );
    next();
} );

// Setup the cookie parser
app.use( bridgeWare.getCookies() );

app.use( userAgent.express() );

// Setup the request logger
app.use( function ( req, res, next ) {

    app.log.verbose( "Received Request at " + req.path );
    app.log.silly( {
        RequestBody: req.body,
        BridgeHeader: req.get( 'bridge' ),
        Method: req.method,
        Resource: req.path,
        Secure: req.secure,
        XHR: req.xhr,
        Protocol: req.protocol,
        BridgeCookie: req.bridge.cookies.get( 'BridgeAuth' )
    } );

    next();
} );

app.use( bridgeWare.applyDefaultSecuityPolicyHeader );

app.use( compress() );

// Static hosting Middleware
app.use( bridgeWare.staticHostFiles() );

app.use( bridgeWare.prepBridgeObjects );

// Serve the index if it is a GET request for '/'
app.get( '/', routes.serveIndex );

app.get( 'publicRouter' ).use( bridgeWare.prepBridgeObjects );

// Handle an authentication request
app.get( 'publicRouter' ).route( '/authenticate' )
    .post( require( './src/requests/authenticate' ) );

// Automatically parse the body to JSON
app.use( bodyParser.json() );

// Add the CORS headers to the response
app.use( bridgeWare.attachCORSHeaders() );

// Handle CORS Request
app.use( bridgeWare.handleOptionsRequest() );

// Use the public router to send
app.use( config.server.apiRoute, app.get( "publicRouter" ) );

// Use the private router to try to interpret the route
app.use( config.server.apiRoute, app.get( "privateRouter" ) );

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

    if ( config.server.httpRedirect ) {

        var app2 = express();

        app2.listen( 80 );

        app2.get( '*', function ( req, res ) {
          if ( req.protocol === 'http' ) {
            res.redirect( "https://" + config.server.hostname + req.url );
          }
        } );
    }

    var keyDir, certDir;

    if ( config.security.sshKeys.privateKeyfilepath[ 0 ] === '/' ) {
        keyDir = path.resolve( config.security.sshKeys.privateKeyfilepath );
    } else {
        keyDir = path.resolve( path.join( path.dirname( require.main.filename ), config.security.sshKeys.privateKeyfilepath ) );
    }

    if ( config.security.sshKeys.certificatefilepath[ 0 ] === '/' ) {
        certDir = path.resolve( config.security.sshKeys.certificatefilepath );
    } else {
        certDir = path.resolve( path.join( path.dirname( require.main.filename ), config.security.sshKeys.certificatefilepath ) );
    }

    var promises = [];

    promises.push( fs.read( keyDir )
        .fail( function( err ) {
            app.log.error( 'Failed to load private key file. Check your private key file path. Error: ', err );
        } ) );

    promises.push( fs.read( certDir )
        .fail( function( err ) {
            app.log.error( 'Failed to load certificate file. Check your certificate file path. Error: ',
                err );
        } ) );

    _.forEach( config.security.sshKeys.ca, function( caPath ) {
        var AbsCaPath = path.resolve( caPath );
        promises.push( fs.read( AbsCaPath )
        .fail( function( err ) {
            app.log.error( 'Failed to load CA file at location: ' + AbsCaPath );
        } ) );
    } );

    Q.all( promises )
    .then( function( results ) {
        var credentials = {
            key: results.shift(),
            cert: results.shift(),
            ca: results,
            //
            // This is the default secureProtocol used by Node.js, but it might be
            // sane to specify this by default as it's required if you want to
            // remove supported protocols from the list. This protocol supports:
            //
            // - SSLv2, SSLv3, TLSv1, TLSv1.1 and TLSv1.2
            //
            secureProtocol: 'SSLv23_method',

            //
            // Supply `SSL_OP_NO_SSLv3` constant as secureOption to disable SSLv3
            // from the list of supported protocols that SSLv23_method supports.
            //
            secureOptions: constants.SSL_OP_NO_SSLv3,

            // A string describing the ciphers to use or exclude for tls.
            // Modified from the default option to exclude RC4 for security reasons.
            ciphers: "ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:AES128-GCM-SHA256:!RC4:HIGH:!MD5:!aNULL",

            // When choosing a cipher, use the server's preferences instead of the client preferences.
            // Although, this option is disabled by default, it is recommended that you use this option
            // in conjunction with the ciphers option to mitigate BEAST attacks.
            honorCipherOrder: true,

            // The PEM passphrase to use for the certificate.
            passphrase: config.security.passphrase
        };

        server = https.createServer( credentials, app );

        // Listen on the port defined at the beginning of the script
        server.listen( port );
        Q.delay( 100 ).
        then( function() {
            // Log the start of the server
            app.log.info( "Express server listening on port %d in %s mode", port, config.server.environment );
            app.log.info( "Server is now running!" );
        } );
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

process.stdin.on( 'data', function ( chunk ) {

} );

function exitHandler( options, err ) {
    if ( options.cleanup ) {
        app.log.debug( 'Bridge application closing. Good Bye!' );
    }
    if ( err ) {
        app.log.error( err.stack );
    }
    if ( options.exit ) {
        process.exit();
    }
}

//do something when app is closing
process.on( 'exit', exitHandler.bind( null, { cleanup: true } ) );

//catches ctrl+c event
process.on( 'SIGINT', exitHandler.bind( null, { exit: true } ) );

//catches uncaught exceptions
process.on( 'uncaughtException', exitHandler.bind( null, { exit: true } ) );
