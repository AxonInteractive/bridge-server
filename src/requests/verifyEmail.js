/** @module request/verifyEmail */
"use strict";

var revalidator = require( "revalidator" );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var URLModule   = require( 'url' );

var regex    = require( '../regex'    );
var error    = require( '../error'    );
var database = require( '../database' );
var util     = require( '../utilities');
var config   = require( '../config'   );
var mailer   = require( '../mailer'   );
var app      = require( '../../server' ).app;

var schema = {
    properties: {
        hash: {
            type: 'string',
            required: true,
            allowEmpty: false,
            pattern: regex.sha256,
            messages: {
                pattern: "not a valid hash"
            }
        }
    }
};

function validateVerifyEmailRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {


        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch( firstError.property ) {
                case 'hash':
                    errorCode = 'userHashInvalid';
                    break;
                default:
                    errorCode = 'malformedRequest';
                    break;
            }

            var verifyError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( verifyError );
            return;
        }

        resolve();
    } );
}

function sendWelcomeEmail( user, emailVariables ) {
    return Q.Promise( function( resolve, reject ) {

        var url = URLModule.format( {
            protocol: config.server.mode,
            host: config.server.hostname
        } );

        var viewName = config.mailer.welcomeEmail.viewName;

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.welcomeEmail.subject
        };

        if ( !_.isObject( emailVariables ) ) {
            emailVariables = {};
        }

        mailer.sendMail( viewName, emailVariables, mail )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

    } );
}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send({
            content: "Email account verified successfully!"
        });

        res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    // Validate the request to conform with the Verify Email request
    validateVerifyEmailRequest( req )

    // Verify the email in the datebase
    .then( function () {
        return database.verifyEmail( req );
    } )

    .then( function() {
        var userFunc = app.get( 'verifyEmailMiddleware' );
        if ( _.isFunction( userFunc ) ) {
            return userFunc( req.bridge.user, req, res );
        }
    } )

    .then( function( emailVariables ) {
        return sendWelcomeEmail( req.bridge.user, emailVariables );
    } )

    // Send the successful response message
    .then( function () {
        return sendResponse( res );
    } )

    // Catch any error that occurred on the on the above promises
    .fail( function ( err ) {
        next( err );
    } );
};
