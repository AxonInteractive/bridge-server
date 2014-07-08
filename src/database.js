"use strict";
var mysql       = require( 'mysql' );
var crypto      = require( 'crypto' );
var Q           = require( 'Q' );

var bridgeError = require( './error' );
var mailer      = require( './mailer' );

var connection  = null;

connection = mysql.createConnection(app.get('BridgeConfig').database);

try {
    connection.connect();
} catch ( err ) {
    app.log.error( "Could not connect to database. Error: " + err );
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
        var authenticationError = bridgeError.createError( 500, 'Failed to authenticate anonymous request', "Cannot authenticate" );
        app.log.verbose( {
            Error: authenticationError,
            Reason: "Cannot authenticate an anonymous request",
            RequestBody: JSON.stringify( req.body )
        } );
        cb( authenticationError );
        return;
    }



    connection.query( 'SELECT * FROM users WHERE lower(EMAIL) = lower(?)', [ req.body.email ], function ( err, rows ) {

        if ( err ) {
            var databaseError = bridgeError.createError( 403, 'Database query error', "Database query error. see log files for more information" );
            cb( databaseError );
            return;
        }

        if ( rows.length === 0 ) {
            var resultError = bridgeError.createError( 403, 'Email not found', "User not found for that email" );
            cb( resultError );
            return;
        }

        var user = rows[ 0 ];

        var hmac = crypto.createHmac( 'sha256', user.PASSWORD );
        var concat = JSON.stringify( req.body.content ) + ( req.body.email ) + req.body.time;
        hmac.update( concat );
        var valHmac = hmac.digest( 'hex' );


        if ( valHmac !== req.body.hmac ) {
            var hmacError = bridgeError.createError( 403, 'HMAC failed', "Failed hmac check" );
            cb( hmacError );
            return;
        }

        if ( user.STATUS != 'NORMAL' ) {
            var incorrectStatusError = bridgeError.createError( 403, 'Incorrect user state', "User is in the '" + ( user.STATUS.toLowerCase() ) + "' state" );
            cb( incorrectStatusError );
            return;
        }

        req.bridge.user = user;

        cb();
    } );
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
            var queryFailedError = bridgeError.createError( 500, 'Database query error', "Database error. See logs for more information" );

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
exports.registerUser = function ( req, res ) {
    return Q.Promise( function ( resolve, reject ) {
        var user = req.bridge.user;

        var state = app.get( 'BridgeConfig' ).server.emailVerification ? 'CREATED' : 'NORMAL';

        var hash = crypto.createHash( 'sha256' ).update( user.email + new Date() ).digest( 'hex' );

        // [Email, Password, First Name, Last Name, App Data, State, UserHash]
        var userInsertionQuery = "INSERT INTO users VALUES (0, ?, ?, ?, ?, NOW(), ?, ?, \"user\", 0, ?, NOW())";

        var values = [ user.email, user.password, user.firstName, user.lastName, JSON.stringify( user.appData ), state, hash ];

        connection.query( userInsertionQuery, values, function ( err, retObj ) {
            if ( err ) {

                if ( err.code === "ER_DUP_ENTRY" ) {
                    var dupEntryError = bridgeError.createError( 409, 'Email already used', "The email that was enter has already been taken by another user" );

                    app.get( 'logger' ).verbose( {
                        Error: JSON.stringify( dupEntryError ),
                        Reason: "Email that was to be registered was not unique",
                        Query: userInsertionQuery,
                        Values: values,
                        DBError: JSON.stringify( err )
                    } );

                    reject( dupEntryError );
                } else {
                    // Create the Error
                    var queryFailedError = bridgeError.createError( 500, 'Database query error', "Query failed to register user" );

                    // Log the error and relevant information
                    app.get( 'logger' ).verbose( {
                        Error: JSON.stringify( queryFailedError ),
                        Reason: "Database rejected query",
                        Query: userInsertionQuery,
                        Values: values,
                        DBError: JSON.stringify( err )
                    } );

                    reject(queryFailedError);
                }
            }

            resolve(req, res);

            if ( app.get( 'BridgeConfig' ).server.emailVerification === true ) {
                mailer.sendVerificationEmail( req );
            }
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
exports.updateUser = function( req, res ) {
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

        values.push( req.bridge.user.EMAIL );

        connection.query( query, values, function ( err, retObj ) {

            if ( err ) {
                // Create the Error
                var queryFailedError = bridgeError.createError( 500, 'Database query error', "Query failed to update user" );

                reject( queryFailedError );
                return;
            }


            res.content = {};

            res.content.message = "Updaing user successful";

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
exports.verifyEmail = function( req, res ){
    return Q.Promise( function ( resolve, reject ) {
        var verifyEmailError;

        var query = "SELECT * FROM users WHERE USER_HASH = ?";
        var values = [ req.body.content.hash ];

        connection.query( query, values, function ( err, rows ) {
            if ( err ) {
                verifyEmailError = bridgeError.createError( 500, 'Database query error', "Database error, See log for more details" );

                reject( verifyEmailError );
                return;
            }

            if ( rows.length === 0 ) {
                verifyEmailError = bridgeError.createError( 400, 'User not found', "No user with that user hash" );

                reject( verifyEmailError );
                return;
            }

            if (rows[0].STATUS !== 'CREATED') {
                verifyEmailError = bridgeError.createError( 400, 'Incorrect user state', "Tried to verify email that is not in the created state");

                reject( verifyEmailError );
                return;
            }

            var query2 = "UPDATE users SET STATUS = 'NORMAL' WHERE id = ?";
            var values2 = [ rows[ 0 ].ID ];

            connection.query( query2, values2, function ( err2, rows2 ) {
                if ( err2 ) {
                    verifyEmailError( 500, 'Database query error', "Database error, See log for more details" );

                    reject( verifyEmailError );
                    return;
                }
                resolve(req, res);
            } );
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


/**
 * Closes the database connection.
 * @return {Undefined} Nothing.
 */
exports.close = function() {
    connection.end();
};

