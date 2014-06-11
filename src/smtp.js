"use strict";

var simplesmtp = require( 'simplesmtp' );
var app        = require('../server.js').app;

var isStarted = false;

exports.startSmtpServer = function(options)
{

    isStarted = true;

};
