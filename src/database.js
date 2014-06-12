"use strict";

var mysql       = require('mysql');
var connection  = null;
var bridgeError = require('./error');

connection = mysql.createConnection(app.get('BridgeConfig').database);
connection.connect();

/**
 * gets the users using the filter object added on
 * @param  {Object}    req  The request object.
 * @param  {Object}    res  The response object.
 * @param  {Function}  next The callback function for when the filter is complete.
 * @return {Undefined}      Nothing.
 */
exports.getUser = function ( req, res, next, error ) {
    var query = 'SELECT APP_DATA FROM users';
    var values = [];
    var first = true;
    if ( typeof req.filters !== 'undefined' ) {
        query = query.concat( ' WHERE ' );
        req.filters.forEach( function ( element ) {

            if ( first )
                first = false;
            else
                query = query.concat( " AND " );

            query = query.concat( element.field + ' = ?' );
            values.push( element.value );

        } );
    }

    connection.query( query, values, function ( err, rows ) {
        if ( err ) {
            // Create the error
            var queryFailedError = new bridgeError( 'Database error. See logs for more information', 500 );

            // Log the error with relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( queryFailedError ),
                Reason: "Database rejected query",
                Query: query,
                Values: JSON.stringify( values ),
                "Request Body": JSON.stringify( req.body ),
                DBError: JSON.stringify( err )
            } );

            // Throw the error
            error( queryFailedError );
            return;
        }

        var resAry = [];

        rows.forEach( function ( element ) {
            resAry.push( element.APP_DATA );
        } );

        res.content = resAry;

        next();
    } );
};

/**
 * AAdded the request user to the database.
 * @param  {Object}   req   The express request object.
 * @param  {Object}   res   The express response object.
 * @param  {Function} next  The callback for the sucessful completion of this function
 * @param  {Function} error The callback incase of an error occuring inside this filter
 * @return {Undefined}
 */
exports.registerUser = function ( req, res, next, error ) {

    // [Email, Password, First Name, Last Name, App Data]
    var userInsertionQuery = "INSERT INTO users VALUES (0, ?, ?, ?, ?, NOW(), ?, \"CREATED\", \"user\", 0)";
    if ( !req.bridge.regObj ) {

        // Create the error
        var authenticationNeededError = new bridgeError( 'Cannot register without authentication', 403 );

        // Log the error and relevant information
        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( authenticationNeededError ),
            Reason: "Need to authenticate the user before being able to register them",
            "Request Body": JSON.stringify( req.body )
        } );

        // Throw the error
        error( authenticationNeededError );
        return;
    }
    var regObj = req.bridge.regObj;
    var values = [ regObj.Email, regObj.Pass, regObj.FName, regObj.LName, JSON.stringify( regObj.AppData ) ];

    connection.query( userInsertionQuery, values, function ( err, retObj ) {
        if ( err ) {

            // Create the Error
            var queryFailedError = new bridgeError( 'Query failed to register user', 500 );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( queryFailedError ),
                Reason: "Database rejected query",
                Query: userInsertionQuery,
                Values: values,
                DBError: JSON.stringify( err )
            } );

            error( queryFailedError );
            return;
        }

        next();
    } );
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

            var queryFailedError = new bridgeError(' generic query failed ', 500);

            app.get('logger').verbose({
                Error: JSON.stringify(queryFailedError),
                Reason: "",
                Query: query,
                Values: values,
                DBError: JSON.stringify(err)
            });

            queryFailedError.DBError = err;

            cb(queryFailedError);
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

