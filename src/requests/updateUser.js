/** @module request/updateUser */
"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' );
var uri         = require( 'uri-js' );
var jwt         = require( 'jwt-simple' );

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var util     = require( '../utilities' );
var mailer   = require( '../mailer' );
var config   = require( '../config' );
var app      = require( '../../server' ).app;

var schema = {
    properties: {
        appData: {
            type: 'object',
            required: false,
        },

        firstName: {
            type: 'string',
            allowEmpty: true,
            required: false,
        },

        lastName: {
            type: 'string',
            allowEmpty: true,
            required: false
        },

        password: {
            type: 'string',
            required: false,
            pattern: regex.sha256,
            messages: {
                pattern: "not a valid hash"
            }
        }
    }

};

function validateUpdateUserRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge,
            schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
            case 'email':
                errorCode = 'emailInvalid';
                break;
            case 'password':
                errorCode = 'passwordInvalid';
                break;
            case 'firstName':
                errorCode = 'firstNameInvalid';
                break;
            case 'lastName':
                errorCode = 'lastNameInvalid';
                break;
            default:
                errorCode = 'malformedRequest';
                break;
            }

            var updateError = error.createError( 400, errorCode,
                firstError.property + " : " + firstError.message );

            reject( updateError );
            return;
        }

        // if password exists then make sure current password also exists
        if ( _.has( req.headers.bridge, 'password' ) ) {
            if ( !_.has( req.headers.bridge, 'currentPassword' ) ) {
                reject( error.createError( 400, 'currentPasswordInvalid', 'Current password is missing from the request' ) );
                return;
            }
        }

        resolve();
    } );
}

/**
 * Send a email notifiying the owner of the account that their user information has been updated.
 *
 * @param  {User} user             A user object in the form of the DB Table relating to the user where each
 *                     column is a variable my the column name.
 *
 * @param {Object} emailVariabels  The variabels object to be passed to e.js to template the emails
 *                                to send
 *
 * @param {Array} fieldsUpdated The field
 *
 * @return {Promise}   A Q style promise object
 */
function sendUpdatedUserEmail( user, fieldsUpdated ) {
    return Q.Promise( function ( resolve, reject ) {

        // Determine if a non AppData
        var updatedNonAppDataField;

        var emailsToSend = [];

        _.forEach( fieldsUpdated, function ( value, key ) {

            if ( key === 'FIRST_NAME' ) {
                if ( user.FIRST_NAME !== value ) {
                    if ( !_.contains( emailsToSend, 'info' ) ) {
                        emailsToSend.push( 'info' );
                    }
                }
            }

            if ( key === 'LAST_NAME' ) {
                if ( user.LAST_NAME !== value ) {
                    if ( !_.contains( emailsToSend, 'info' ) ) {
                        emailsToSend.push( 'info' );
                    }
                }
            }

            if ( key === 'PASSWORD' ) {
                if ( user.PASSWORD !== value ) {
                    if ( !_.contains( emailsToSend, 'password' ) ) {
                        emailsToSend.push( 'password' );
                    }
                }
            }

        } );

        if ( _.isEmpty( emailsToSend ) ) {
            resolve();
            return;
        }

        var mailerTracker = {};

        function sendMailComplete() {
            if ( mailerTracker.info ) {
                if ( mailerTracker.info.sending ) {
                    if ( !mailerTracker.info.isSent ) {
                        return;
                    }
                }
            }

            if ( mailerTracker.password ) {
                if ( mailerTracker.password.sending ) {
                    if ( !mailerTracker.password.isSent ) {
                        return;
                    }
                }
            }

            resolve();
        }

        user = _.transform( user, function ( result, value, key ) {
            key = key.toLowerCase();
            var arr = key.split( '_' );
            for ( var i = 1; i < arr.length; i += 1 ) {
                arr[ i ] = arr[ i ].charAt( 0 ).toUpperCase() + arr[ i ].slice( 1 );
            }
            key = arr.join( '' );
            result[ key ] = value;
        } );


        if ( _.contains( emailsToSend, 'info' ) ) {

            mailerTracker.info = {};
            mailerTracker.info.sending = true;

            var mail = {
                to: user.email,
                subject: config.mailer.updatedUserInfoEmail.subject
            };

            var viewName = config.mailer.updatedUserInfoEmail.viewName;

            mailer.sendMail( viewName, {}, mail, user )
                .then( function () {
                    mailerTracker.info.isSent = true;
                    sendMailComplete();
                } )
                .fail( function ( err ) {
                    reject( err );
                } );

        }

        if ( _.contains( emailsToSend, 'password' ) ) {

            mailerTracker.password = {};
            mailerTracker.password.sending = true;

            var passwordMail = {
                to: user.email,
                subject: config.mailer.updatedUserPasswordEmail.subject
            };

            var passwordViewName = config.mailer.updatedUserPasswordEmail.viewName;

            mailer.sendMail( passwordViewName, {}, passwordMail, user )
                .then( function () {
                    mailerTracker.password.isSent = true;
                    sendMailComplete();
                } )
                .fail( function ( err ) {
                    reject( err );
                } );

        }

        sendMailComplete();

    } );
}

function updateCookie( req, res ) {

    app.log.debug( res.updatedFields );

    if ( !_.has( res.updatedFields, 'PASSWORD' ) ) {
        return;
    }

    var expires = req.bridge.auth.expires;

    req.bridge.auth.password = res.updatedFields.PASSWORD;

    if ( _.isString( expires ) ) {
        expires = new Date( expires );
    }

    var cookieOptions = {
        httpOnly: true,
        overwrite: true,
        expires: expires
    };

    var secret = config.security.tokenSecret;

    var token = jwt.encode( req.bridge.auth, secret );

    req.bridge.cookies.set( 'BridgeAuth', token, cookieOptions );

}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send( {
            content: "User updated successfully"
        } );

        res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    // Validate the request to conform with an UpdateUser Request
    validateUpdateUserRequest( req )

    // Update the user object inside of the database.
    .then( function () {
        return database.updateUser( req );
    } )

    .then( function( updatedFields ) {
        res.updatedFields = updatedFields;
    } )

    .then( function () {
        return sendUpdatedUserEmail( req.bridge.user, res.updatedFields );
    } )

    .then( function() {
        return updateCookie( req, res );
    } )

    // Send the successful response message
    .then( function () {
        return sendResponse( res );
    } )

    // Catch any error that might have occurred in the previous promises.
    .fail( function ( err ) {
        next( err );
    } );
};
