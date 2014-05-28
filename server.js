"use strict";
//server.js
var express          = require('express'),
    fs               = require('fs'),
    loggerObj        = require('./logger'),
    app              = express(),
    crypto           = require('crypto'),
    database         = require('./database'),
    filters          = require('./filters'),
    https            = require('https'),
    http             = require('http'),
    path             = require('path'),
    privatekey       = fs.readFileSync('privatekey.pem', 'utf8'),
    certificate      = fs.readFileSync('certificate.pem', 'utf8'),
    server           = null,
    jsonminify       = require('jsonminify');



var dasfdfcredentials = {
        key: privatekey,
        cert: certificate
    };

// Tell express that it is behind a proxy
app.enable('trust proxy');

// Setting standard dictionary objects
    // database reference
app.set('database', database);

// Setting up standard middle ware
    // Automatically parse the body to JSON
app.use(express.json());
app.use(express.urlencoded());
    // Provides faux HTTP method support.
app.use(express.methodOverride());
    // Use the router to route messages to the appropriate locations
app.use(app.router);
    // Server any static content under that client folder
app.use(express.static(path.join(__dirname, 'client')));

// development only settings
if ('development' == app.get('env')) {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true})); 
}

// production only settings
if ('production' == app.get('env')) {
    app.use(express.errorHandler());
}

// The constructor of the object
function start(configPath){

    var configjson = fs.readFileSync(configPath, 'utf8');

    var config = JSON.parse(JSON.minify(configjson));

    loggerObj.start(config.logger, app);

    var logStream = {
        write: function(message, encoding) {
            app.get('serverLogger').verbose('Request: ' + message);
        }
    };

    app.use(express.logger({stream: logStream}));

    if (config.server.mode === "https"){
        var credentials = {
            key: fs.readFileSync(config.server.https.keyfilepath, 'utf8'),
            cert: fs.readFileSync(config.server.https.certificatefilepath, 'utf8')
        };

        server = https.createServer(credentials, app);
    }
    else if (config.server.mod === "http"){
        server= http.createServer(app);
    }

    process.env.PORT = config.server.port;
    var port = config.server.port;
    server.listen(port);


    filters.start(app);

    app.set('DatabaseConfig', config.database);
    database.start(app);


    app.get('serverLogger') .info("Express server listening on port %d in %s mode", port, app.settings.env);
    app.get('consoleLogger').info("Express server listening of port %d in %s mode", port, app.settings.env);
   
}

process.on('SIGTERM', function(){
    app.get('serverLogger').info("Termination signal received. Closing server.");
    app.get('consoleLogger').info("Termination signal received. Closing server.");
    database.close();
});

exports.start          = start;
exports.app            = app;
exports.filters        = filters;
