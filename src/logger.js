"use strict";
var winston = require( 'winston' );
var fs      = require( 'fs' );
var path    = require( 'path' );
var mkdirp  = require( 'mkdirp' );

var config  = require( '../server' ).config.logger;
var app     = require( '../server' ).app;
var _  = require( 'lodash')._;

config.server.filename = path.normalize( config.server.filename );

var dir = path.resolve( path.dirname( config.server.filename ) );

winston.verbose( "Verifying that server log directory exists..." );
winston.debug( dir );

if ( !fs.existsSync( dir ) ) {
    winston.warn("Log directory '" + dir + "' doesn't exist. Attempting to make directory now...");
    mkdirp( dir, function ( err ) {
        if ( err ) {
            winston.error( "Error making server directory '" + dir + "', Reason: " + err );
            return;
        }
        winston.info( "Log directory created successfully." );
    } );
} else {
    winston.verbose( "Server Log directory found." );
}

config.exception.filename = path.normalize( config.exception.filename );

dir = path.resolve( path.dirname( config.exception.filename ) );

winston.verbose( "Verifying that exception log directory exists..." );
winston.debug( dir );

if ( !fs.existsSync( dir ) ) {
    winston.warn("Log directory '" + dir + "' doesn't exist. Attempting to make directory now...");
    mkdirp( dir, function ( err ) {
        if ( err ) {
            winston.error( "Error making exception directory '" + dir + "', Reason: " + err );
            return;
        }
        winston.info( "Exception log directory created successfully." );
    } );
} else {
    winston.verbose( "Exception log directory found." );
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
