"use strict";

var mysql       = require('mysql');
var crypto      = require('crypto');

var bridgeError = require('./error');
var mailer      = require('./mailer');

var connection  = null;

connection = mysql.createConnection(app.get('BridgeConfig').database);

try {
    connection.connect();
} catch ( err ) {
    app.get( 'logger' ).error( "Could not connect to database. Error: " + err );
}

/**
 * A filter used to authenticate a user from the bridge database.
 * @param  {Object}   req   The express request object.
 * @param  {Object}   res   The express response object.
 * @param  {Function} next  Callback for when the function is complete
 * @param  {Function} error Callback for when an error occurs
 * @return {Undefined}
 */
exports.authenticateRequest = function ( req, res, cb ) {

    if ( req.bridge.isAnon === true ) {
        var authenticationError = new bridgeError( "Cannot authenticate", 403 );
        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( authenticationError ),
            Reason: "Cannot authenticate an anonymous request",
            "Request Body": JSON.stringify( req.body )
        } );
        cb( undefined, authenticationError );
        return;
    }

    connection.query('SELECT * FROM users WHERE EMAIL = ?', [req.body.email], function(err, rows){

        if (err){
            var databaseError = new bridgeError ('Database query error. see log files for more information', 403);
            app.get('logger').verbose({
                Reason: JSON.stringify(err),
                Query: "SELECT * FROM users WHERE email = " + req.body.email,
                Error: JSON.stringify(databaseError)
            });
            cb(undefined, databaseError);
            return;
        }

        if (rows.length !== 1) {
            var resultError = new bridgeError("User not found or more than one user found for that email", 403);
            app.get('logger').verbose({
                Results: JSON.stringify(rows),
                Query: "SELECT * FROM users WHERE EMAIL = " + req.body.email,
                Error: JSON.stringify(resultError)
            });
            cb( undefined, resultError );
            return;
        }

        var user = rows[0];

        var hmac = crypto.createHmac('sha256', user.PASSWORD);
        var concat = JSON.stringify(req.body.content) + (req.body.email) + req.body.time;
        hmac.update( concat );
        var valHmac = hmac.digest('hex');


        if (valHmac !== req.body.hmac) {
            var hmacError = new bridgeError("Failed hmac check", 403);
            app.get('logger').verbose({
                Reason: 'Request failed hmac check',
                "Request Body": JSON.stringify(req.body),
                "Target HMAC" : valHmac,
                "Request HMAC": req.body.hmac,
                Error: JSON.stringify(hmacError)
            });
            cb( undefined, hmacError );
            return;
        }

        if ( user.STATUS != 'NORMAL' ) {
            var incorrectStatusError = new bridgeError( "User is in the '" + ( user.STATUS.toLowerCase() ) + "' state", 403 );

            app.get( 'logger' ).verbose( {
                Reason: "Request failed status check. Status should be NORMAL to pass authentication",
                "Request Body": JSON.stringify( req.body ),
                UserStatus: user.STATUS,
                Error: JSON.stringify( incorrectStatusError )
            } );

            cb( undefined, incorrectStatusError );
            return;
        }

        req.bridge.user = user;

        cb();
    });
};

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
            mailer.sendVerificationEmail( req );
        }

        next();
    } );
};

/**
 * Updates the user object which made the request if authenticated
 * @param  {Object}   req   The express request object
 * @param  {Object}   res   The express response object
 * @param  {Function} next  The callback for when the function is complete
 * @param  {Function} error The callback for when an error occurs
 * @return {Undefined}
 */
exports.updateUser = function( req, res, next, error ) {

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

    var content = req.body.content;

    var updateFields = {};

    //////////////////////////////////////////////////////////
    ///////////   Determine the fields to update   ///////////
    //////////////////////////////////////////////////////////

    // App Data Check
    if ( _.has( content, 'appData' ) ) {
        if ( !_.isEmpty( content.appData ) ) {
            updateFields.APP_DATA = content.appData;
        }
    }

    // Email Check
    if ( _.has( content, 'email' ) ) {
        if ( !_.isEmpty( content.email ) ) {
            updateFields.EMAIL = content.email;
        }
    }

    // First Name Check
    if ( _.has( content, 'firstName' ) ) {
        if ( !_.isEmpty( content.firstName ) ) {
            updateFields.FIRST_NAME = content.firstName;
        }
    }

    // Last Name Check
    if ( _.has( content, 'lastName' ) ) {
        if ( !_.isEmpty( content.lastName ) ) {
            updateFields.LAST_NAME = content.lastName;
        }
    }

    // Password Check
    if ( _.has( content, 'password' ) ) {
        if ( !_.isEmpty( content.password ) ) {
            updateFields.PASSWORD = content.password;
        }
    }

    //////////////////////////////////////////////////////////
    /////////   End of Determining the fields to update   ////
    //////////////////////////////////////////////////////////
    
    if ( _.isEmpty( updateFields ) ) {

        app.get( 'logger' ).verbose( {
            Reason: "No content to update. Request failed",
            RequestBody: req.body,
            Error: {
                Message: "No content to update",
                StatusCode: 400
            }
        } );

        error( {
            Message: "No content to update",
            StatusCode: 400
        } );

        return;
    }

    updateFields.USER_HASH = crypto.createHash( 'sha256' ).update( req.bridge.user.EMAIL + new Date() ).digest( 'hex' );

    var query = "UPDATE users SET ";
    var values = [];

    var pairs = _.pairs(updateFields);

    pairs.forEach( function ( element ) {
        var key = element[ 0 ];
        var value = element[ 1 ];

        query = query.concat( key + " = ?, " );
        values.push( value );

    } );

    // Remove the last two characters
    query = query.slice(0, - 2);

    query = query.concat( " WHERE EMAIL = ?" );

    values.push(req.bridge.user.EMAIL);

    connection.query( query, values, function ( err, retObj ) {

        if ( err ) {
            // Create the Error
            var queryFailedError = new bridgeError( 'Query failed to update user', 500 );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( queryFailedError ),
                Reason: "Database rejected query",
                Query: query,
                Values: values,
                DBError: JSON.stringify( err )
            } );

            error( queryFailedError );
            return;
        }


        res.content = {};

        res.content.message = "Updaing user successful";

        next();

    } );
};

/**
 * Verifies the user that made this request. 
 * @param  {Object}   req   The express request object
 * @param  {Object}   res   The express response object
 * @param  {Function} next  The callback for when this function is complete
 * @param  {Function} error The callback for when an error occurs
 * @return {Undefined}
 */
exports.verifyEmail = function( req, res, next, error ){

    var verifyEmailError;
    if ( !_.has( req.body.content, 'hash' ) ) {
        verifyEmailError = new bridgeError( "Could not find the user hash", 500 );

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

    if ( !_.isString( req.body.content.hash ) ) {
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
    var values = [req.body.content.hash];

    connection.query( query, values, function ( err, rows ) {
        if ( err ) {
            verifyEmailError = new bridgeError( "Database error, See log for more details", 500 );

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
            verifyEmailError = new bridgeError( "No user with that user hash", 400 );

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
            next();
        } );
    } );
};

exports.forgotPassword = function( req, res, next, error ) {

    var forgotPassword = require( './requests/forgotPassword' )( req.body );

    if ( _.isArray( forgotPassword ) ) {
        app.get('logger').verbose(forgotPassword);
    }

    next();
};

// /**
//  * query the database with the given query and values for the query.
//  * @param  {String}    query  The mysql database query string with '?' for variables.
//  * @param  {Array}     values The array of values to replace the '?'s in the query with.
//  * @param  {Function}  cb     The callback when the query is complete. signature - >(err, rows)
//  * @return {Undefined}        Nothing
//  */
// exports.query = function ( query, values, cb ) {
//     connection.query( query, values, function ( err, rows ) {
//         if ( err ) {

//             var queryFailedError = new bridgeError( "generic query failed", 500 );

//             app.get( 'logger' ).verbose( {
//                 Error: JSON.stringify( queryFailedError ),
//                 Reason: "",
//                 Query: query,
//                 Values: values,
//                 DBError: JSON.stringify( err )
//             } );

//             queryFailedError.DBError = err;

//             cb( queryFailedError );
//         }

//         cb( undefined, rows );

//     } );
// };

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
