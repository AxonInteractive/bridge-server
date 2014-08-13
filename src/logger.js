"use strict";
var winston = require( 'winston' );
var fs      = require( 'fs' );
var path    = require( 'path' );
var mkdirp  = require( 'mkdirp' );

var config  = require( '../server' ).config.logger;
var app     = require( '../server' ).app;

config.server.filename = path.normalize( config.server.filename );

var dir = path.dirname( config.server.filename );

if ( !fs.existsSync( dir ) ) {
    winston.warn("Log directory '" + dir + "' doesn't exist. Attempting to make directory now...");
    mkdirp( dir, function ( err ) {
        if ( err ) {
            winston.error( "Error making directory '" + dir + "', Reason: " + err );
            return;
        }

        winston.info( "Log directory created successfully." );
    } );
} else {
    winston.info( "Log directory found." );
}

var loggerConstObj = {
    transports: [
        new winston.transports.DailyRotateFile( {
            filename: config.server.filename,
            level: config.server.level,
            timestamp: true,
            silent: false,
            json: false
        } ),
        new winston.transports.Console( {
            level: config.server.consoleLevel,
            colorize: true,
            silent: false,
            timestamp: false,
            json: false,
            prettyPrint: true
        } )
    ],
    exceptionHandlers: [
        new winston.transports.DailyRotateFile( {
            filename: config.exception.filename,
            handleExceptions: true,
            json: false
        } )
    ],
    exitOnError: false
};

if ( config.exception.writetoconsole === true ) {

    loggerConstObj.exceptionHandlers.push( new winston.transports.Console( {
        prettyPrint: true,
        colorize: true
    } ) );
}

app.log = new( winston.Logger )( loggerConstObj );
