"use strict";
var winston = require('winston');
var server = require('../server');
var app = server.app;
var config = server.config.logger;

app.set('logger', new(winston.Logger)({
    transports: [
        new winston.transports.DailyRotateFile({
            filename: config.server.filename,
            level: config.server.level,
            prettyPrint: true,
            timestamp: true,
            silent: false
        })
    ],
    exceptionHandlers: [
        new winston.transports.DailyRotateFile({
            filename: config.exception.filename,
            handleExceptions: true
        })
    ]
}));

if (config.exception.writetoconsole === true){
    app.get('logger').handleExceptions(new winston.transports.Console({ prettyPrint: true, colorize: true}));
}

app.set('consoleLogger', new(winston.Logger)({
    transports: [
        new winston.transports.Console({
            level: config.console.level,
            prettyPrint: true,
            colorize: true,
            silent: false,
            timestamp: false
        })
    ]
}));

if (app.get('env') === 'development') {

    app.set('devLogger', new(winston.Logger)({
        transports: [
            new winston.transports.File({
                level: 'silly',
                filename: 'logs/dev.log',
                timestamp: true,
                prettyPrint: true,
                silent: false
            })
        ]
    }));
    app.get('devLogger').add(winston.transports.Console, { level: 'debug', colorize: true } );
}
else {
    app.set('devLogger', new (winston.Logger)({
    }));
}