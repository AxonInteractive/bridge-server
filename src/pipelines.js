"use strict";

var filters  = require('./filters');
var server   = require('../server');
var pipeline = server.pipeline;
var app      = server.app;

exports.getLoginPipeline = function(){
    var loginPipeline = new pipeline();
    
    loginPipeline
        .pipe(filters.authenticationFilter)
        .pipe(filters.responseAddUser);

    return loginPipeline;
};