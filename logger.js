"use strict";
var winston = require('winston');
var config  = require('./configs/loggerconfig');

var apiLogger = new (winston.Logger) ({
    transports: [
        new winston.transports.Console({
            level: config.logger.api.consoleLevel,
            prettyPrint: true,
            colorize: true,
            silent: false,
            timestamp: false
        }),

        new winston.transports.DailyRotateFile({
            filename: config.logger.api.filename,
            level: config.logger.api.level,
            prettyPrint: true,
            timestamp: true,
            silent: false
        })
    ],
});

var serverLogger = new (winston.Logger) ({
    transports: [
        new winston.transports.Console({
            level: config.logger.server.consoleLevel,
            prettyPrint: true,
            colorize: true,
            silent: false,
            timestamp: false
        }),
        
        new winston.transports.DailyRotateFile({
            filename: config.logger.server.filename,
            level: config.logger.server.level,
            prettyPrint: true,
            timestamp: true,
            silent: false
        })
    ],

    exceptionHandlers: [
        new winston.transports.DailyRotateFile({ filename: config.logger.exception.filename })
    ]
});

var consoleLogger = new (winston.Logger) ({
    transports: [
        new winston.transports.Console({
            level: config.logger.console.level,
            prettyPrint: true,
            colorize: true,
            silent: false,
            timestamp: false
        })
    ]
});

var debugLogger = new (winston.Logger) ({
    transports: [
        new winston.transports.File({
            level: 'debug',
            filename: 'logs/debug.log',
            timestamp: true,
            prettyPrint: true,
            silent: false
        })
    ]
});

exports.apiLogger     = apiLogger;
exports.serverLogger  = serverLogger;
exports.consoleLogger = consoleLogger;
exports.debugLogger   = debugLogger;
