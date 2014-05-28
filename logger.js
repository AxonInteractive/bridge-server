"use strict";
var winston = require('winston');

function start(config, app) {
    app.set('apiLogger', new(winston.Logger)({
        transports: [
            new winston.transports.Console({
                level       : config.api.consoleLevel,
                prettyPrint : true,
                colorize    : true,
                silent      : false,
                timestamp   : false
            }),

            new winston.transports.DailyRotateFile({
                filename    : config.api.filename,
                level       : config.api.level,
                prettyPrint : true,
                timestamp   : true,
                silent      : false
            })
        ],
    }));

    app.set('serverLogger', new(winston.Logger)({
        transports: [
            new winston.transports.Console({
                level       : config.server.consoleLevel,
                prettyPrint : true,
                colorize    : true,
                silent      : false,
                timestamp   : false
            }),

            new winston.transports.DailyRotateFile({
                filename    : config.server.filename,
                level       : config.server.level,
                prettyPrint : true,
                timestamp   : true,
                silent      : false
            })
        ],

        exceptionHandlers: [
            new winston.transports.DailyRotateFile({
                filename         : config.exception.filename,
                handleExceptions : true
            }),

            new winston.transports.Console({
                prettyPrint : true,
                colorize    : true,
                silent      : false,
                timestamp   : false
            })
        ]
    }));

    app.set('consoleLogger', new(winston.Logger)({
        transports: [
            new winston.transports.Console({
                level       : config.console.level,
                prettyPrint : true,
                colorize    : true,
                silent      : false,
                timestamp   : false
            })
        ]
    }));

    app.set('debugLogger', new(winston.Logger)({
        transports: [
            new winston.transports.File({
                level       : 'debug',
                filename    : 'logs/debug.log',
                timestamp   : true,
                prettyPrint : true,
                silent      : false
            })
        ]
    }));

    if (config.exception.writetoconsole === true) {

    }
}

exports.start         = start;
