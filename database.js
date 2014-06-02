"use strict";

var mysql      = require('mysql');
var server     = require('./server');
var connection = null;
var app        = server.app;

connection = mysql.createConnection(server.config.database);
connection.connect();

/**
 * gets the users using the filter object added on
 * @param  {Object}    req  The request object.
 * @param  {Object}    res  The response object.
 * @param  {Function}  next The callback function for when the filter is complete.
 * @return {Undefined}      Nothing.
 */
exports.getUser = function(req, res, next) {
    var query = 'SELECT APP_DATA FROM users WHERE ';
    var values = [];
    var first = true;
    if (typeof req.filters !== 'undefined')
        req.filters.forEach(function(element) {

            if (first)
                first = false;
            else
                query = query.concat(" AND ");

            query = query.concat(element.field + ' = ?');
            values.push(element.value);

        });

    connection.query(query, values, function(err, rows) {
        if (err) {
            app.get('logger').warn("Query failed: " + query + "\nWith error: " + err);
            throw err;
        }

        var resAry = [];

        rows.forEach(function(element) {
            resAry.push(element.APP_DATA);
        });

        res.content = resAry;

        next();
    });
};

exports.getLoginPackage = function(req, res, next) {
    var userQuery = 'SELECT * FROM users WHERE email = ?';
    var artifactQuery = 'SELECT *(DISTINCT DATA_TYPE) FROM data WHERE USER_ID = ?';

    connection.query(userQuery, [req.body.email], function(err, userRows) {
        if (err) {
            app.get('serverLogger').warn("Query failed: " + userQuery + "\nWith error: " + err);
            throw {
                msg: err,
                statusCode: 400
            };
        }

        if (userRows.length === 0) {
            throw {
                msg: "no users with that email",
                statusCode: 400
            };
        }

        var user = userRows[0];

        connection.query(artifactQuery, [user.ID], function(err, artifactRows) {
            if (err) {
                app.get('logger').warn("Query failed: " + artifactQuery + "\nWith error: " + err);
                throw {
                    msg: err,
                    statusCode: 400
                };
            }

            artifactRows.forEach(function(element) {

            });
        });
    });
};

/**
 * query the database with the given query and values for the query.
 * @param  {String}    query  The mysql database query string with '?' for variables.
 * @param  {Array}     values The array of values to replace the '?'s in the query with.
 * @param  {Function}  cb     The callback when the query is complete. signature - >(err, rows)
 * @return {Undefined}        Nothing
 */
exports.query = function(query, values, cb) {
    connection.query(query, values, function(err, rows) {
        if (err) {
            app.get('logger').warn("Query failed: " + query + "\nWith error: " + err);
            cb(err);
        }

        cb(undefined, rows);

    });
};

/**
 * Closes the database connection.
 * @return {Undefined} Nothing.
 */
exports.close = function() {
    connection.end();
};

