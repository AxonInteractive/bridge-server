"use strict";

var mysql      = require('mysql'),
    connection = null,
    app        = require('./server').app,
    config     = require('./configs/dbconfig');

connection = mysql.createConnection(config);

connection.connect();

exports.getUser = function(req, res, next){

    res.user = {
        name: "username"
    };
    next();
};

exports.query = function(query, values, cb){
    connection.query(query, values, function(err, rows) {
        if (err){
            app.get('serverLogger').warn("Query failed: " + query + "\nWith error: " + err);
            return err;
        }

        cb(rows);

    });
};

exports.close = function(){
    connection.end();
};