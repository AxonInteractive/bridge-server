"use strict";
//server.js
var express          = require('express'),
    fs               = require('fs'),
    loggerObj        = require('./logger'),
    serverLogger     = loggerObj.serverLogger,
    apiLogger        = loggerObj.apiLogger,
    consoleLogger    = loggerObj.consoleLogger,
    crypto           = require('crypto'),
    database         = require('./database'),
    filters          = require('./filters');

var app            = express(),
    extentionObj   = null,
    api            = null,

    logStream      = {
    write: function(message, encoding){
        serverLogger.verbose('Request: ' + message);
        }
    };

// Setting standard dictionary objects
    // logger references
app.set('apiLogger', apiLogger);
app.set('serverLogger', serverLogger);
app.set('consoleLogger', consoleLogger);
    // database reference
app.set('database', database);

// Setting up standard middle ware
    // Log dump to the steam setup by winston above
app.use(express.logger({stream: logStream}));
    // Automatically parse the body to JSON
app.use(express.json());
app.use(express.urlencoded());

    // Provides faux HTTP method support.
app.use(express.methodOverride());
    // Use the router to route messages to the appropriate locations
app.use(app.router);

// development only settings
if ('development' == app.get('env')) {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true})); 
}

// production only settings
if ('production' == app.get('env')) {
    app.use(express.errorHandler());
}

// The constructor of the object
function start(){
    var port = process.env.PORT || 3000;
    app.listen(port);
    serverLogger.info("Express server listening on port %d in %s mode", port, app.settings.env);
   
}

process.on('SIGTERM', function(){
    serverLogger.info("Server closing");
    database.close();
});

exports.start          = start;
exports.app            = app;
exports.filters        = filters;
