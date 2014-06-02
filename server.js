"use strict";
//server.js

// Bring in external libraries
var fs         = require('fs');
var crypto     = require('crypto');
var jsonminify = require('jsonminify');
var https      = require('https');
var http       = require('http');
var path       = require('path');
var express    = require('express');

// Parse the configuration file from the application
var configStr   = fs.readFileSync('config.json','utf8');
var config      = JSON.parse(JSON.minify(configStr));

// Start the express app
var app         = express();

// Determine the port to listen on
var port = config.server.port || 3000;
process.env.PORT = port;

// Export important files for bridge configuration and setup
exports.app = app;
exports.config = config;

// Read in local modules
var loggerObj  = require('./logger');
var database   = require('./database');
var filters    = require('./filters');
var jsonminify = require('jsonminify');

// Prepare server variable
var server     = null;

// Export local files for the API to use
exports.filters = filters;

// Prepare a steam in which for express to be able to write to winston
var logStream = {
    write: function(message, encoding) {
        app.get('serverLogger').verbose('Request: ' + message);
    }
};

app.use(express.logger({stream: logStream}));

// Tell express that it is behind a proxy
app.enable('trust proxy');

// Setting standard dictionary objects
    // database reference
app.set('database', database);

// Setting up standard middle ware
    // Automatically parse the body to JSON
app.use(express.json());
    // Decode URL Strings
app.use(express.urlencoded());
    // Provides faux HTTP method support.
app.use(express.methodOverride());
    // Server any static content under that client folder
app.use(express.static('client'));
    // Use the router to route messages to the appropriate locations
app.use(app.router);
    // Standard Request Middleware for API Calls
app.use('/api/*',function(req, res, next){
    var body    = req.body;
    var content = body.content;
    var email   = body.email;
    var time    = body.time;
    var hmac    = body.hmac;

    app.get('consoleLogger').info('Standard API Filter is being used');

    // Check if the content exists
    if (content == null){
        throw {
            msg: "content does not exist",
            statusCode: 400
        };
    }

    // Check the email field of the request
    {
        if (email == null){
            throw { 
                msg: "email does not exist",
                statusCode: 400
            };
        }

        var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/g;
        var reg = emailRegex.exec(email);

        if (reg === null){
            throw { 
                msg: "email is not valid",
                statusCode: 400
            };
        }
    }
    
    // Check the time field of the message
    {
        if (time == null){
            throw {
                msg: "time does not exist",
                statusCode: 400
            };
        }

        var timeRegex = /^\d{4}-(0[1-9]|1[1-2])-([0-2]\d|3[0-1])T([0-1]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z/g;
        var timeReg = timeRegex.exec(time);

        if (timeReg === null){
            throw {
                msg: "time is not valid",
                statusCode: 400
            };
        }
    }

    // Check the hmac field of the message
    {
        if (hmac == null)
            throw {
                msg: "hmac does not exist",
                statusCode: 400
            };
        
       var sha256 = crypto.createHash('sha256');
       var hash = sha256.update('something').digest('hex');

        if (hash.length !== hmac.length)
            throw {
                msg: "password is not valid",
                statusCode: 400
            };
    }

    req.bridge = {};
    res.content = {};

    next();
});

// development only settings
if ('development' == app.get('env')) {
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true})); 
}

// production only settings
if ('production' == app.get('env')) {
    app.use(express.errorHandler());
}

// Setup the server for https mode
if (config.server.mode === "https") {
    var credentials = {
        key: fs.readFileSync(config.server.https.keyfilepath, 'utf8'),
        cert: fs.readFileSync(config.server.https.certificatefilepath, 'utf8')
    };

    server = https.createServer(credentials, app);
} 
// Else setup the server for http mode
else if (config.server.mod === "http") {
    server = http.createServer(app);
}

// Listen on the port defined at the beginning of the script
server.listen(port);

// Log the start of the server
app.get('logger') .info("Express server listening on port %d in %s mode", port, app.settings.env);
app.get('consoleLogger').info("Express server listening of port %d in %s mode", port, app.settings.env);

// Setup the kill state handler
process.on('SIGTERM', function(){
    app.get('logger').info("Termination signal received. Closing server.");
    app.get('consoleLogger').info("Termination signal received. Closing server.");
    database.close();
});

