"use strict";

var filters  = require('./filters');
var server   = require('./server');
var pipeline = server.pipeline;
var app      = server.app;

exports.login = function(req, res) {
    var loginPipeline = new pipeline();
    loginPipeline.pipe(filters.authenticationFilter)
        .pipe(filters.getRequestUser);

    loginPipeline.execute(req, function(resBody) {
        if (typeof resBody.err !== 'undefined') {
            res.status(resBody.err.statusCode);
            app.get('logger').verbose({
                req: req.body,
                status: resBody.err.statusCode,
                err: resBody.err.msg
            });
            res.send();
            return;

        }

        app.get('logger').verbose({
            req: req.body,
            status: 200,
            res: resBody
        });

        res.status(200);
        res.send(resBody);
        return;
    });
};

