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
function sendUpdatedUserEmail( user, emailVariables, fieldsUpdated ) {
    return Q.Promise( function ( resolve, reject ) {

        // Determine if a non AppData
        var updatedNonAppDataField;

        var emailsToSend = [];

        _.each( fieldsUpdated, function ( element, index ) {

            if ( element === 'FIRST_NAME' ) {
                if ( !_.contains( emailsToSend, 'info' ) ) {
                    emailsToSend.push( 'info' );
                }
            }

            if ( element === 'LAST_NAME' ) {
                if ( !_.contains( emailsToSend, 'info' ) ) {
                    emailsToSend.push( 'info' );
                }
            }

            if ( element === 'PASSWORD' ) {
                if ( !_.contains( emailsToSend, 'password' ) ) {
                    emailsToSend.push( 'password' );
                }
            }

        } );

        if ( _.isEmpty( emailsToSend ) ) {
            resolve();
            return;
        }


        var url = app.get( 'uriObject' );

        var footerImageURL     = _.cloneDeep( url );// + 'resources/email/peir-footer.png';
        var headerImageURL     = _.cloneDeep( url );// + 'resources/email/peir-header.png';
        var backgroundImageURL = _.cloneDeep( url );// url + 'resources/email/right-gradient.png';

        footerImageURL.path = '/resources/email/peir-footer.png';
        footerImageURL.path = '/resources/email/peir-header.png';
        footerImageURL.path = '/resources/email/reight-gradient.png';

        var variables = {
            email: user.EMAIL,
            name: _.capitalize( user.FIRST_NAME + ' ' + user.LAST_NAME ),
            footerImageURL: uri.serialize( footerImageURL ),
            headerImageURL: uri.serialize( headerImageURL ),
            backgroundImageURL: uri.serialize( backgroundImageURL )
        };

        app.log.debug( 'Update user email variables: ', variables );

        var mailerTracker = {};

        function sendMailComplete() {
            if ( mailerTracker.info.sending ) {
                if ( !mailerTracker.info.isSent ) {
                    return;
                }
            }

            if ( mailerTracker.password.sending ) {
                if ( !mailerTracker.password.isSent ) {
                    return;
                }
            }

            resolve();
        }

        if ( _.contains( emailsToSend, 'info' ) ) {

            mailerTracker.info = {};
            mailerTracker.info.sending = true;

            var mail = {
                to: user.EMAIL,
                subject: config.mailer.updatedUserInfoEmail.subject
            };

            var viewName = config.mailer.updatedUserInfoEmail.viewName;

            mailer.sendMail( viewName, variables, mail, user )
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
                to: user.Email,
                subject: config.mailer.updatedUserPasswordEmail.subject
            };

            var passwordViewName = config.mailers.updatedUserPasswordEmail.viewName;

            mailer.sendMail( passwordViewName, variables, passwordMail, user )
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

    // The request must be in a Logged In State
    util.mustBeLoggedIn( req )

    // Validate the request to conform with an UpdateUser Request
    .then( function () {
        return validateUpdateUserRequest( req );
    } )

    // Update the user object inside of the database.
    .then( function () {
        return database.updateUser( req );
    } )

    .then( function( updatedFields ) {
        var userFunc = app.get( 'updateUserMiddleware' );
        res.updatedFields = updatedFields;
        if ( _.isFunction( userFunc ) ) {
            return userFunc( req.bridge.user, req, res );
        }
    } )

    .then( function ( emailVariables ) {
        return sendUpdatedUserEmail( req.bridge.user, emailVariables, res.updatedFields );
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
