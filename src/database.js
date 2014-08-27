"use strict";
var mysql       = require( 'mysql' );
var crypto      = require( 'crypto' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;

var server      = require( '../server' );
var app         = server.app;
var bridgeError = server.error;
var mailer      = require( './mailer' );
var config      = server.config;

var connection  = null;

connection = mysql.createConnection( server.config.database );

connection.connect( function(err) {
    if (err) {
        app.log.error( "Could not connect to database. ", err );
        app.log.error( "Connection Information: ", server.config.database );
        return;
    }

    app.log.info( "Connected to database successfully as id " + connection.threadId );
} );


/**
 * A filter used to authenticate a user from the bridge database.
 * @param  {Object}   req   The express request object.
 * @return {Promise}        A Q promise object
 */
exports.authenticateRequest = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {

        if ( req.bridge.isAnon === true ) {
            var authenticationError = bridgeError.createError( 500, 'Failed to authenticate anonymous request', "Cannot authenticate" );

            reject( authenticationError );
            return;
        }

        var request = req.headers.bridge;

        connection.query( 'SELECT * FROM users WHERE lower(EMAIL) = lower(?)', [ request.email ], function ( err, rows ) {

            if ( err ) {
                var databaseError = bridgeError.createError( 403, 'Database query error', "Database query error. see log files for more information" );
                reject( databaseError );
                return;
            }

            if ( rows.length === 0 ) {
                var resultError = bridgeError.createError( 403, 'Email not found', "User not found for that email" );
                reject( resultError );
                return;
            }

            var user = rows[ 0 ];

            var hmac = crypto.createHmac( 'sha256', user.PASSWORD );
            var concat = JSON.stringify( request.content ) + ( request.email ) + request.time;
            hmac.update( concat );
            var valHmac = hmac.digest( 'hex' );


            if ( valHmac !== request.hmac ) {
                var hmacError = bridgeError.createError( 403, 'HMAC failed', "Failed hmac check" );
                reject( hmacError );
                return;
            }

            if ( user.STATUS !== 'NORMAL' ) {
                var incorrectStatusError = bridgeError.createError( 403, 'Incorrect user state', "User is in the '" + ( user.STATUS.toLowerCase() ) + "' state" );
                reject( incorrectStatusError );
                return;
            }

            req.bridge.user = user;

            resolve();
        } );
    } );
};


/**
 * AAdded the request user to the database.
 * @param  {Object}   user   The user object
 * @return {Promise}            A Q Promise
 */
exports.registerUser = function ( user ) {
    return Q.Promise( function ( resolve, reject ) {

        var state = config.server.emailVerification ? 'created' : 'normal';

        var hash = crypto.createHash( 'sha256' ).update( user.email + new Date() ).digest( 'hex' );

        // [Email, Password, First Name, Last Name, App Data, State, UserHash]
        var userInsertionQuery = "INSERT INTO users VALUES (0, ?, ?, ?, ?, NOW(), ?, ?, \"user\", 0, ?, NOW())";

        var values = [  user.email.toLowerCase(),
                        user.password,
                        _.capitalize( user.firstName ),
                        _.capitalize( user.lastName ),
                        JSON.stringify( user.appData ),
                        state,
                        hash ];

        connection.query( userInsertionQuery, values, function ( err, retObj ) {
            if ( err ) {

                if ( err.code === "ER_DUP_ENTRY" ) {
                    var dupEntryError = bridgeError.createError( 409, 'Email already used', "The email that was enter has already been taken by another user" );

                    app.log.debug( {
                        Error: JSON.stringify( dupEntryError ),
                        Reason: "Email that was to be registered was not unique",
                        Query: userInsertionQuery,
                        Values: values,
                        DBError: JSON.stringify( err )
                    } );

                    reject( dupEntryError );
                    return;
                } else {
                    // Create the Error
                    var queryFailedError = bridgeError.createError( 500, 'Database query error', "Query failed to register user" );

                    // Log the error and relevant information
                    app.log.debug( {
                        Error: JSON.stringify( queryFailedError ),
                        Reason: "Database rejected query",
                        Query: userInsertionQuery,
                        Values: values,
                        DBError: JSON.stringify( err )
                    } );

                    reject( queryFailedError );
                    return;
                }
            }

            resolve();

        } );

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
exports.updateUser = function( req ) {
    return Q.Promise(function(resolve, reject){

        var updateUserError;

        if ( !_.has( req.bridge, "structureVerified" ) ) {
            var malformedMessageError = bridgeError.createError( 400, 'Request structure unverified', "Request has not been verified using the verify request middleware property" );


            reject( malformedMessageError );
            return;
        }

        if ( !_.has( req.bridge, "user" ) ) {
            var unAuthenticateError = bridgeError.createError( 403, 'Need authentication', "Cannot change password without authentication" );

            reject( unAuthenticateError );
            return;
        }


        var content = req.headers.bridge.content;

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
                updateFields.EMAIL = content.email.toLowerCase();
            }
        }

        // First Name Check
        if ( _.has( content, 'firstName' ) ) {
            if ( !_.isEmpty( content.firstName ) ) {
                updateFields.FIRST_NAME = _.capitalize( content.firstName );
            }
        }

        // Last Name Check
        if ( _.has( content, 'lastName' ) ) {
            if ( !_.isEmpty( content.lastName ) ) {
                updateFields.LAST_NAME = _.capitalize( content.lastName );
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

            resolve();
            return;
        }

        updateFields.USER_HASH = crypto.createHash( 'sha256' ).update( req.bridge.user.EMAIL + new Date().toISOString() ).digest( 'hex' );

        var query = "UPDATE users SET ";
        var values = [];

        var pairs = _.pairs( updateFields );

        pairs.forEach( function ( element ) {
            var key = element[ 0 ];
            var value = element[ 1 ];

            query = query.concat( key + " = ?, " );
            values.push( value );

        } );

        // Remove the last two characters
        query = query.slice( 0, -2 );

        query = query.concat( " WHERE EMAIL = ?" );

        values.push( req.bridge.user.EMAIL.toLowerCase() );

        connection.query( query, values, function ( err, retObj ) {

            if ( err ) {
                // Create the Error
                var queryFailedError = bridgeError.createError( 500, 'Database query error', "Query failed to update user" );

                reject( queryFailedError );
                return;
            }

            resolve();

        } );

    });
};

/**
 * Verifies the user that made this request.
 * @param  {Object}   req   The express request object
 * @param  {Object}   res   The express response object
 * @param  {Function} next  The callback for when this function is complete
 * @param  {Function} error The callback for when an error occurs
 * @return {Undefined}
 */
exports.verifyEmail = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {
        var verifyEmailError;

        var query = "SELECT * FROM users WHERE USER_HASH = ?";
        var values = [ req.headers.bridge.content.hash ];

        connection.query( query, values, function ( err, rows ) {
            if ( err ) {
                verifyEmailError = bridgeError.createError( 500, 'Database query error', "Database error, See log for more details" );
                app.log.debug( "Database Error: " + err );
                reject( verifyEmailError );
                return;
            }

            if ( rows.length === 0 ) {
                verifyEmailError = bridgeError.createError( 400, 'User not found', "No user with that user hash" );

                reject( verifyEmailError );
                return;
            }

            if ( rows[ 0 ].STATUS !== 'created' ) {
                verifyEmailError = bridgeError.createError( 400, 'Incorrect user state', "Tried to verify email that is not in the created state" );

                reject( verifyEmailError );
                return;
            }

            var query2 = "UPDATE users SET STATUS = 'normal' WHERE id = ?";
            var values2 = [ rows[ 0 ].ID ];

            connection.query( query2, values2, function ( err2, rows2 ) {
                if ( err2 ) {
                    verifyEmailError( 500, 'Database query error', "Database error, See log for more details" );

                    reject( verifyEmailError );
                    return;
                }
                resolve();
            } );
        } );
    } );
};

exports.recoverPassword = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {
        var recoverPasswordError;

        var query = "SELECT * FROM users WHERE USER_HASH = ?";
        var values = [ req.headers.bridge.content.hash ];

        connection.query( query, values, function ( err, rows ) {
            if (err) {
                recoverPasswordError = bridgeError.createError( 500, 'Database query error', "Database error, See log for more details" );
                app.log.debug( "Database Error: " + err );
                reject( recoverPasswordError );
                return;
            }

            if ( rows.length === 0 ) {
                recoverPasswordError = bridgeError.createError( 400, 'User not found', "No user with that user hash" );

                reject( recoverPasswordError );
                return;
            }

            var query2 = "UPDATE users SET PASSWORD = ? WHERE id = ?";
            var values2 = [ req.headers.bridge.content.message, rows[ 0 ].ID ];

            connection.query( query, values, function ( err2, rows ) {
                if ( err2 ) {
                    recoverPasswordError = bridgeError.createError( 500, 'Database query error', "Database error, See log for more details" );

                    reject( recoverPasswordError );
                    return;
                }
                resolve();
            } );

        } ); // end of query
    } ); // end of promise
};

exports.query = function ( query, values ) {
    return Q.Promise( function ( resolve, reject ) {

        var error;

        if ( !_.isString( query ) ) {
            error = bridgeError.createError( 500, 'Database query error', "Query is not a string" );
            reject();
            return;
        }

        if ( !_.isArray( values ) && !_.isUndefined( values ) ) {
            error = bridgeError.createError( 500, 'Database query error', "Query values is not an Array" );
            reject();
            return;
        }

        connection.query( query, values, function ( err, rows ) {
            if ( err ) {
                reject( err );
                return;
            }

            resolve( rows );
        } );
    } );
};

/**
 * Closes the database connection.
 * @return {Undefined} Nothing.
 */
exports.close = function() {
    app.log.info( "Closing Database connection" );
    connection.end();
};

