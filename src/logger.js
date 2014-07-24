"use strict";
var winston = require( 'winston'   );
var config  = require( '../server' ).config.logger;
var fs      = require( 'fs'        );
var path    = require( 'path'      );
var app = require('../server').app;

if ( !fs.existsSync( 'logs' ) ) {
    fs.mkdir( 'logs' );
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

if ( app.get( 'env' ) === 'development' ) {

    app.set( 'devLogger', new( winston.Logger )( {
        transports: [
            new winston.transports.File( {
                level: 'silly',
                filename: 'logs/dev.log',
                timestamp: true,
                silent: false,
                json: false
            } )
        ]
    } ) );
    app.get( 'devLogger' ).add( winston.transports.Console, {
        level: 'debug',
        colorize: true
    } );
}

else {
    app.set( 'devLogger', new( winston.Logger )( {} ) );
}
