/**@module request/register */
"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var uri         = require( 'uri-js' );

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var mailer   = require( '../mailer' );
var util     = require( '../utilities' );
var server   = require( '../../server' );
var config   = require( '../config' );
var app      = server.app;

var schema = {
    properties: {

        email: {
            type: 'string',
            format: 'email',
            required: true
        },

        firstName: {
            type: 'string',
            allowEmpty: false,
            required: true
        },

        lastName: {
            type: 'string',
            allowEmpty: false,
            required: true
        },

        password: {
            type: 'string',
            pattern: regex.sha256,
            required: true,
            messages: {
                pattern: "not a valid hash"
            }
        },

        appData: {
            type: 'object',
            required: false,
            description: "The user added data to go into the database along with the user"
        }

    }
};

function validateRegisterRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge, schema );

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

            var regError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( regError );
            return;
        }

        resolve();

    } );
}

function getUserObject( req ) {
    return Q.Promise( function ( resolve, reject ) {
        resolve( req.headers.bridge );
    } );
}

/**
 * Sends a email to verify a registration request.
 * *NOTE* ONLY used when email verification is turned on.
 *
 * @param  {User}  user             A user object in the form of the DB Table relating to the user
 *                                  where each column is a variable my the column name.
 *
 * @param  {Object} emailVariables  The variables that get fed into the email template to fill in
 *                                  the template variables.
 *
 * @return {Promise}   A Q style promise object
 */
function sendVerificationEmail( user, emailVariables ) {
    return Q.Promise( function ( resolve, reject ) {

        if ( config.server.emailVerification === true ) {

            var viewName = config.mailer.verificationEmail.viewName;

            var url = uri.parse( app.get( 'rootURL' ) );

            var mail = {
                to      : user.email,
                subject : config.mailer.verificationEmail.subject
            };

            if ( !_.isObject( emailVariables ) ) {
                emailVariables = {};
            }

            emailVariables.verificationURL = uri.parse( app.get( 'rootURL' ) );

            var fragment = uri.serialize( {
                path: '/account-verification',
                query: 'hash=' + user.hash
            } );

            emailVariables.verificationURL.fragment = fragment;
            emailVariables.verificationURL = uri.serialize( emailVariables.verificationURL );

            mailer.sendMail( viewName, emailVariables, mail )
            .then( function() {
                resolve();
            } )
            .fail( function( err ) {
                database.query( "DELETE FROM users WHERE EMAIL = ?", [ user.email ] )
                .then( function() {
                    reject( err );
                } )
                .fail( function( dbErr ) {
                    reject( 500, 'could not delete new user upon email failing to send', dbErr );
                } );
            } );
        } else {
            resolve();
        }

    } );
}

function sendReponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send( {
            content: "User registered successfully!"
        } );

        res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    // Validate the structure of the request against the registration schema
    validateRegisterRequest( req )

    // Get the user object out of the request
    .then( function () {
        return getUserObject( req );
    } )

    // Register the user object using the re
    .then( function ( user ) {
        return database.registerUser( req, user );
    } )

    // Run the user extension function. This should work as a promise
    .then( function() {
        var userFunc = app.get( 'registerMiddleware' );
        if ( _.isFunction( userFunc ) ) {
            return userFunc( req.   bridge.user, req, res );
        }
    } )

    // Send the verification email using the user object
    .then( function ( emailVariables ) {
        return sendVerificationEmail( req.bridge.user, emailVariables );
    } )

    // Send the successful response message
    .then( function () {
        return sendReponse( res );
    } )

    // Catch any errors that occurred in the above middle ware
    .fail( function ( err ) {
        next( err );
    } );
};
