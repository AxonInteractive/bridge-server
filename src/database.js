"use strict";

var mysql       = require('mysql');
var crypto      = require('crypto');

var bridgeError = require('./error');
var mailer      = require('./mailer');

var connection  = null;

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
                Error          : JSON.stringify( queryFailedError ),
                Reason         : "Database rejected query",
                Query          : query,
                Values         : JSON.stringify( values ),
                "Request Body" : JSON.stringify( req.body ),
                DBError        : JSON.stringify( err )
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

    if (!_.has(req.bridge, 'user')){
                // Create the error
        var authenticationNeededError = new bridgeError( 'Cannot register without authentication', 500 );

        // Log the error and relevant information
        app.get( 'logger' ).verbose( {
            Error          : JSON.stringify( authenticationNeededError ),
            Reason         : "Need to authenticate the user before being able to register them",
            "Request Body" : JSON.stringify( req.body )
        } );

        // Throw the error
        error( authenticationNeededError );
        return;
    }

    var user  = req.bridge.user;

    var state = app.get( 'BridgeConfig' ).server.emailVerification ? 'CREATED' : 'NORMAL';

    var hash = crypto.createHash( 'sha256' ).update( user.Email + new Date() ).digest( 'hex' );

    // [Email, Password, First Name, Last Name, App Data, State, UserHash]
    var userInsertionQuery = "INSERT INTO users VALUES (0, ?, ?, ?, ?, NOW(), ?, ?, \"user\", 0, ?, NOW())";


    var values = [ user.Email, user.Pass, user.FName, user.LName, JSON.stringify( user.AppData ), state, hash ];

    connection.query( userInsertionQuery, values, function ( err, retObj ) {
        if ( err ) {

            if ( err.code === "ER_DUP_ENTRY" ) {
                var dupEntryError = new bridgeError( 'Email already taken', 409 );

                app.get( 'logger' ).verbose( {
                    Error   : JSON.stringify( dupEntryError ),
                    Reason  : "Email that was to be registered was not unique",
                    Query   : userInsertionQuery,
                    Values  : values,
                    DBError : JSON.stringify( err )
                } );

                error(dupEntryError);
                return;
            }
            else {
                // Create the Error
                var queryFailedError = new bridgeError( 'Query failed to register user', 500 );

                // Log the error and relevant information
                app.get( 'logger' ).verbose( {
                    Error   : JSON.stringify( queryFailedError ),
                    Reason  : "Database rejected query",
                    Query   : userInsertionQuery,
                    Values  : values,
                    DBError : JSON.stringify( err )
                } );

                error( queryFailedError );
                return;
            }
        }

        if ( app.get( 'BridgeConfig' ).server.emailVerification === true ) {
            mailer.sendVerificationEmail( req.bridge.user );
        }

        next();
    } );
};

exports.changePassword = function ( req, res, next, error ) {

    if ( !_.has( req.bridge, "user" ) ) {
        var unAuthenticateError = new bridgeError( 'Cannot change password without authentication', 403 );

        app.get( 'logger' ).verbose( {
            Error          : JSON.stringify( unAuthenticateError ),
            Reason         : "Tried to change the password of a user without Authentication",
            "Request Body" : JSON.stringify( req.body ),
        } );

        error( unAuthenticateError );
        return;
    }

    var changePassword = "UPDATE users SET PASSWORD = ? WHERE EMAIL = ? ";

    if ( !_.has( req.body, "content" ) ) {
        var malformedMessageError = new bridgeError( "Request is missing the content property", 400);

        app.get('logger').verbose( {
            Error          : JSON.stringify(malformedMessageError),
            Reason         : "Request is missing content property",
            "Request Body" : JSON.stringify(req.body)
        });

        error(malformedMessageError);
        return;
    }

    if (!_.has(req.body.content, "message")) {
        var messageMissingError = new bridgeError( "Request is missing message property", 400);

        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( messageMissingError ),
            Reason: "Request is missing message property for path req.body.content.message",
            "Request Body": JSON.stringify( req.body )
        } );
    }

    var values = [req.body.content.message, req.bridge.user.email];

    connection.query(changePassword, values, function(err, retObj){

        if (err){
            // Create the Error
            var queryFailedError = new bridgeError( 'Query failed to register user', 500 );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( queryFailedError ),
                Reason: "Database rejected query",
                Query: changePassword,
                Values: values,
                DBError: JSON.stringify( err )
            } );

            error( queryFailedError );
            return;
        }

        if (!_.has(req, "content"))
            req.content = {};

        req.content.message = "Changing password successful"; 

        next();

    });

};

exports.verifyEmail = function( req, res, next, error ){

    var verifyEmailError;
    if ( !_.has( req.bridge, 'reqUserHash' ) ) {
        verifyEmailError = new bridgeError( "The could not find the user hash", 500 );

        logBridgeError( verifyEmailError,
            "The req.bridge has no property 'reqUserHash' which is needed for email verification",
            null,
            null,
            req,
            null
        );
        error( verifyEmailError );
        return;
    }

    if ( !_.isString( req.bridge.reqUserHash ) ) {
        verifyEmailError = new bridgeError( "The requests user hash is not a string", 500 );
        logBridgeError( verifyEmailError,
            "The req.bridge.reqUserHash is not a string which is needed for email verification",
            null,
            null,
            req,
            null
        );
        error( verifyEmailError );
        return;
    }

    var query = "SELECT * FROM users WHERE USER_HASH = ?";
    var values = [req.bridge.reqUserHash];

    connection.query( query, values, function ( err, rows ) {
        if ( err ) {
            verifyEmailError( "Database error, See log for more details", 500 );

            logBridgeError( verifyEmailError,
                "Database query failed",
                query,
                values,
                req,
                err
            );

            error( verifyEmailError );
            return;
        }

        if ( rows.length !== 1 ) {
            verifyEmailError( "No user with that user hash", 400 );

            logBridgeError( verifyEmailError,
                "No user exists with this user hash",
                query,
                values,
                req, {
                    rows: rows
                }
            );
        }

        res.content.message = "Email verification sucessful";

        var query2 = "UPDATE users SET STATUS = 'NORMAL' WHERE id = ?";
        var values2 = [ rows[ 0 ].ID ];

        connection.query( query2, values2, function ( err2, rows2 ) {
            if ( err2 ) {
                verifyEmailError( "Database error, See log for more details", 500 );

                logBridgeError( verifyEmailError,
                    "Database query failed to update the table for verification",
                    query2,
                    values2,
                    req,
                    err
                );

                error( verifyEmailError );
                return;
            }
        } );
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

            var queryFailedError = new bridgeError( "generic query failed", 500 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( queryFailedError ),
                Reason: "",
                Query: query,
                Values: values,
                DBError: JSON.stringify( err )
            } );

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

function logBridgeError( Error, Reason, Query, Values, req, Meta ) {
    app.get( 'logger' ).verbose( {
        Error: JSON.stringify( Error ),
        Reason: Reason,
        Query: Query,
        Values: JSON.stringify( Values ),
        ExtraData: JSON.stringify( Meta ),
        "Request Body": JSON.stringify( req.body )
    } );
}
