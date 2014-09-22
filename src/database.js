/** @module database */
"use strict";
var mysql       = require( 'mysql' );
var crypto      = require( 'crypto' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var revalidator = require( 'revalidator' );
var moment      = require( 'moment' );

var server = require( '../server' );
var mailer = require( './mailer' );

var app         = server.app;
var bridgeError = server.error;
var config      = server.config;
var connection  = null;

var recoveryStateUserMap = {};

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
 *
 * @param {String} email     The email of the user that is being authenticated in the database.
 *
 * @param {String} password  The password hash of the user that is being authenticated to check if
 *                           it correct
 *
 * @return {Promise}        A Q promise object
 */
exports.authenticateUser = function ( email, password ) {
    return Q.Promise( function ( resolve, reject ) {

        // if ( req.bridge.isAnon === true ) {
        //     var authenticationError = bridgeError.createError( 500, 'authFailedAnon', "Cannot authenticate an anonymous request" );

        //     reject( authenticationError );
        //     return;
        // }

        connection.query( 'SELECT * FROM users WHERE EMAIL = lower(?) AND DELETED = ?', [ email, 0 ], function ( err, rows ) {

            if ( err ) {
                var databaseError = bridgeError.createError( 403, 'databaseError', "Database query error. see log files for more information" );
                app.log.error( 'Database query error: ', err );
                reject( databaseError );
                return;
            }

            if ( rows.length === 0 ) {
                var resultError = bridgeError.createError( 403, 'userNotFound', "User not found for that email" );
                reject( resultError );
                return;
            }

            var user = rows[ 0 ];

            // Check that the password is valid
            if ( user.PASSWORD !== password ) {
                reject( bridgeError.createError( 403, 'invalidPassword', "The suppiled password was incorrect" ) );
                return;
            }

            // Check the status
            if ( user.STATUS !== 'normal' && user.STATUS !== 'recovery' ) {
                var incorrectStatusError = bridgeError.createError( 403, 'incorrectUserState', "User is in the '" + ( _.capitalize( user.STATUS ) ) + "' state" );
                reject( incorrectStatusError );
                return;
            }

            resolve( user );
        } );
    } );
};

/**
 * Added the request user to the database.
 * @param  {Object}   user   The user object
 * @return {Promise}            A Q Promise
 */
exports.registerUser = function ( req, user ) {
    return Q.Promise( function ( resolve, reject ) {

        var state = config.server.emailVerification ? 'created' : 'normal';

        // [Email, Password, First Name, Last Name, App Data, State, UserHash]
        var userInsertionQuery = "INSERT INTO users VALUES (0, ?, ?, ?, ?, \"" +
                moment.utc().format( 'YYYY-MM-DD HH:mm:ss' ) + "\", ?, ?, \"user\", 0, ?, \"" +
                moment.utc().format( 'YYYY-MM-DD HH:mm:ss' ) + "\" )";

        var values = [  user.email.toLowerCase(),
                        user.password,
                        _.capitalize( user.firstName ),
                        _.capitalize( user.lastName ),
                        JSON.stringify( user.appData ),
                        state,
                        "" ];

        connection.query( userInsertionQuery, values, function ( err, retObj ) {
            if ( err ) {

                if ( err.code === "ER_DUP_ENTRY" ) {
                    var dupEntryError = bridgeError.createError( 409, 'emailInUse', "The email that was enter has already been taken by another user" );
                    reject( dupEntryError );
                    return;
                } else {
                    // Create the Error
                    var queryFailedError = bridgeError.createError( 500, 'databaseError', "Query failed to register user" );
                    app.log.error( 'Database query error: ', err );
                    reject( queryFailedError );
                    return;
                }
            }

            req.bridge.user = user;

            app.log.silly( "Database registration return: ", retObj );

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
            var malformedMessageError = bridgeError.createError( 400, 'structureMustBeVerified', "Request has not been verified using the verify request middleware property" );


            reject( malformedMessageError );
            return;
        }

        if ( !_.has( req.bridge, "user" ) ) {
            var unAuthenticateError = bridgeError.createError( 500, 'internalServerError', "Cannot change password without authentication" );

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

        updateFields.LAST_UPDATED =  moment.utc().format( 'YYYY-MM-DD HH:mm:ss' );

        updateFields.DELETED = 0;

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
                var queryFailedError = bridgeError.createError( 500, 'databaseError', "Query failed to update user" );
                app.log.error( 'Database query error: ', err );
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

        var query = "SELECT * FROM users WHERE USER_HASH = ? AND DELETED = 0";
        var values = [ req.headers.bridge.content.hash ];

        connection.query( query, values, function ( err, rows ) {
            if ( err ) {
                verifyEmailError = bridgeError.createError( 500, 'databaseError', "Database query failed. See log for more details" );
                app.log.error( "Database Error: " + err );
                reject( verifyEmailError );
                return;
            }

            if ( rows.length === 0 ) {
                verifyEmailError = bridgeError.createError( 400, 'userNotFound', "No user with that user hash" );

                reject( verifyEmailError );
                return;
            }

            if ( rows[ 0 ].STATUS !== 'created' ) {
                verifyEmailError = bridgeError.createError( 400, 'incorrectUserState', "Tried to verify email that is not in the created state" );

                reject( verifyEmailError );
                return;
            }

            req.bridge.user = rows[ 0 ];

            var query2 = "UPDATE users SET STATUS = 'normal' WHERE id = ?";
            var values2 = [ rows[ 0 ].ID ];

            connection.query( query2, values2, function ( err2, rows2 ) {
                if ( err2 ) {
                    verifyEmailError( 500, 'databaseError', "Database query failed, See log for more details" );
                    app.log.error( 'Database query error: ', err2 );
                    reject( verifyEmailError );
                    return;
                }
                resolve();
            } );
        } );
    } );
};

/**
 * Recovers a password. this is the follow up of a forgot password request. This will check the
 * user hash of the request with the user hash on the account. if the hashs are the same then this
 * request is authenticated and authorized to set the password of the related email.
 *
 * @param  {String}         userHash        The user hash to check agianist in the database.
 *
 * @param  {String}         newPasswordHash New password hash to replace the old password in the
 *                                          database
 *
 * @param  {ExpressRequest} req             The express request object that is made when a request
 *                                          is made to the server.
 *
 * @return {Promise}                        A Q style promise object
 */
exports.recoverPassword = function ( userHash, newPasswordHash, req ) {
    return Q.Promise( function ( resolve, reject ) {
        var recoverPasswordError;

        var query = "SELECT * FROM users WHERE USER_HASH = ? AND STATUS = ? AND DELETED = ?";
        var values = [ userHash, 'recovery', 0 ];

        connection.query( query, values, function ( err, rows ) {
            if (err) {
                recoverPasswordError = bridgeError.createError( 500, 'databaseError', "Database error, See log for more details" );
                app.log.error( "Database Error: " + err );
                reject( recoverPasswordError );
                return;
            }

            if ( rows.length === 0 ) {
                recoverPasswordError = bridgeError.createError( 400, 'userNotFound', "No user with that user hash" );

                reject( recoverPasswordError );
                return;
            }

            req.bridge.user = rows[ 0 ];

            var query2 = "UPDATE users SET PASSWORD = ?, STATUS = ?, USER_HASH = ? WHERE id = ?";
            var values2 = [ newPasswordHash, 'normal', '', rows[ 0 ].ID ];

            connection.query( query2, values2, function ( err2, rows ) {
                if ( err2 ) {
                    recoverPasswordError = bridgeError.createError( 500, 'databaseError', "Database query error, See log for more details" );
                    app.log.error( "Database Error: " + err2 );
                    reject( recoverPasswordError );
                    return;
                }

                clearTimeout( recoveryStateUserMap[ rows[ 0 ].ID ] );
                recoveryStateUserMap[ rows[ 0 ].ID ] = undefined;

                resolve();
            } );

        } ); // end of query
    } ); // end of promise
};

function clearUserHash( userID ) {

    if ( _.isUndefined( recoveryStateUserMap[ userID ] ) ) {
        return;
    }

    var query = "UPDATE users SET STATUS = ?, USER_HASH = ? WHERE ID = ?";
    var values = [ 'normal', '', userID ];

    connection.query( query, values, function( err, rows ) {
        if ( err ) {
            app.log.error( "Cannot clear user hash from user", userID, "Database Error: ", err );
            return;
        }

        recoveryStateUserMap[ userID ] = undefined;

    } );
}

/**
 * The database responsibility that relate to a user making a forgot password request.
 * @param  {String} email The email related to the user who is making the forgot password request.
 * @return {Promise}      A Q style promise object.
 */
exports.forgotPassword = function( user ) {
    return Q.Promise( function( resolve, reject ) {
        var query = "UPDATE users SET STATUS = ?, USER_HASH = ? WHERE EMAIL = ? AND DELETED = ?";

        var userHash = crypto.createHash( 'sha256' ).update( user.EMAIL + moment.utc().toISOString() ).digest( 'hex' );

        var values = [ 'recovery', userHash, user.EMAIL, 0 ];

        connection.query( query, values, function( err, rows ) {

            if ( err ) {
                reject( bridgeError.createError( 500, 'databaseError', "Database error, See log for more details" ) );
                app.log.error( "Database query error: ", err );
                return;
            }

            recoveryStateUserMap[ user.ID ] = setTimeout( clearUserHash, config.accounts.recoveryStateDuration );

            resolve();

        } );
    } );
};

/**
 * Query the database for an arbitrary SQL statement with an arbitrary values to place into the
 * database.
 *
 * @param  {String} query  The SQL statement to send to the database. (Can use a '?' character to
 *                         be a placeholder for the values array.)
 *
 * @param  {Array}  values The array of values to replace the '?'s in the SQL statement. If a
 *                         value is a string then it gets wrapped in quotes.
 *
 * @return {Promise}       A Q style promise object
 */
exports.query = function ( query, values ) {
    return Q.Promise( function ( resolve, reject ) {

        var error;

        if ( !_.isString( query ) ) {
            error = bridgeError.createError( 500, 'internalServerError', "Query is not a string" );
            reject();
            return;
        }

        if ( !_.isArray( values ) && !_.isUndefined( values ) ) {
            error = bridgeError.createError( 500, 'internalServerError', "Query values is not an Array" );
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

/**
 * Inserts data into the specified table using the values specified in the values array
 * @param  {String} table  The name of the table in the database.
 * @param  {Array}  values An array of values to insert into the database.
 * @return {Promise}       A Q style promise object.
 */
exports.insertIntoTable = function( table, values ) {
    return Q.Promise( function( resolve, reject ){

        // Make sure the table name is a string
        if ( !_.isString( table ) ) {
            reject( bridgeError.createError( 500, 'internalServerError', "Table name must be a string" ) );
            return;
        }

        // Check that the string is not empty
        if ( _.isEmpty( table ) ) {
            reject( bridgeError.createError( 500, 'internalServerError', 'Table name must not be empty' ) );
            return;
        }

        // Make sure the values array is an array
        if ( !_.isArray( values ) ) {
            reject( bridgeError.createError( 500, 'internalServerError', "Values must be an array" ) );
            return;
        }

        var query = "INSERT INTO " + table + " VALUES ( 0";

        // Complete the query by adding the nessesary '?' templates
        _.forEach( values, function( element ) {
            query = query.concat( ", ?" );
        } );

        query = query.concat( " )" );

        connection.query( query, values, function( err, result ) {

            if ( err ) {
                reject( bridgeError.createError( 500, 'databaseError', "Database Error, See error log for more details." ) );
                app.log.error( "Database query Error: ", err );
                return;
            }

            app.log.info( result );

            resolve( result );

        } );
    } );
};

/**
 * A JSON Schema object that defines a selectQueryObject
 * @type {Schema}
 */
var selectQueryObjectSchema = {
    properties: {
        table: {
            type: 'string',
            required: true,
            allowEmpty: false
        },
        fields: {
            type: 'array',
            required: true,
            items: {
                type: 'string',
                allowEmpty: false
            }
        },
        filters: {
            required: false,
            type: 'array',
            items: {
                type: 'object',
                required: true,
                properties: {
                    field: {
                        type: 'string',
                        required: true,
                        allowEmpty: false
                    },
                    operand: {
                        type: 'string',
                        required: true,
                        allowEmpty: false
                    },
                    value: {
                        required: true
                    }
                }
            }
        },
        sorts: {
            required: true,
            type: 'array',
            items: {
                type: 'object',
                required: true,
                properties: {
                    predicate: {
                        type: 'string',
                        required: true,
                        allowEmpty: false
                    },
                    order: {
                        type: 'string',
                        required: true,
                        enum: [ 'ASC', 'DESC' ]
                    }
                }
            }
        },
        limits: {
            type: 'object',
            required: false,
            properties: {
                maxResults: {
                    type: 'integer',
                    required: true,
                    minimum: 1
                },
                offset: {
                    type: 'integer',
                    required: false,
                    minimum: 0
                }
            }
        },
        join: {
            properties: {
                table: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                },
                on: {
                    type: 'string',
                    required: true,
                    allowEmpty: false
                }
            }
        }
    }
};

/**
 * Runs a MySQL statement based on the query object provided. Uses the
 * selectQueryObjectSchema schema above
 * @method selectWithQueryObject
 * @param  {SelectQueryObject} selectQueryObj A object defining the results
 *                                            of the database query
 *
 * @return {Promise}                          A Q style promise object
 */
exports.selectWithQueryObject = function( selectQueryObj ) {
    return Q.Promise( function( resolve, reject ) {

        if ( !selectQueryObj ) {
            reject( bridgeError.createError( 500, 'internalServerError', 'Query object must be defined to get data from database' ) );
            return;
        }

        var table   = selectQueryObj.table;
        var fields  = selectQueryObj.fields;
        var filters = selectQueryObj.filters;
        var sorts   = selectQueryObj.sorts;
        var limits  = selectQueryObj.limits;
        var join    = selectQueryObj.join;

        var validationObj = revalidator.validate( selectQueryObj, selectQueryObjectSchema );

        if ( !validationObj.valid ) {
            reject( bridgeError.createError( 500, 'internalServerError', validationObj.errors[ 0 ] ) );
            return;
        }

        var query = "SELECT ";
        var values = [];

        _.forEach( fields, function( element, index ) {

            if ( index !== 0 ) {
                query = query.concat( ', ' );
            }

            query = query.concat( element );
            //values.push( element );
        } );

        query = query.concat( " FROM ", table );
        //values.push( table );

        if ( join ) {

            query = query.concat( " INNER JOIN ", join.table, " ON ", join.on );
            //values.push( join.table, join.on );

        }

        if ( filters && filters.length > 0 ) {

            query = query.concat( ' WHERE ' );

            _.forEach( filters, function( filter, index ) {
                if ( index !== 0 ) {
                    query = query.concat( " AND " );
                }

                query = query.concat( filter.field, " ", filter.operand, " ?" );
                //values.push( filter.field, filter.operand, filter.value );
                values.push( filter.value );
            } );
        }

        if ( sorts && sorts.length > 0 ) {

            query = query.concat( ' ORDER BY ' );

            _.forEach( sorts, function( sort, index ) {
                if ( index !== 0 ) {
                    query = query.concat( ', ' );
                }

                query = query.concat( sort.predicate, " ", sort.order );
                //values.push( sort.predicate, sort.order );
            } );
        }

        if ( limits ) {

            query = query.concat( " LIMIT ");

            if ( limits.offset ) {
                query = query.concat( "?, ");
                values.push( limits.offset );
            }

            query = query.concat( "?" );
            values.push( limits.maxResults );

        }

        app.log.info( mysql.format( query, values ) );

        connection.query( query, values, function( err, rows ) {

            if ( err ) {
                reject( bridgeError.createError( 500, 'databaseError', 'Database query error, see the error log for more information.' ) );
                app.log.error( 'Database query error: ', err );
                return;
            }

            resolve( rows );

        } );

    } );
};
