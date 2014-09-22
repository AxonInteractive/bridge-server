/** @module request/recoverPassword */
"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var URLModule   = require( 'url' );

var regex    = require( '../regex'     );
var error    = require( '../error'     );
var util     = require( '../utilities' );
var database = require( '../database'  );
var config   = require( '../config'    );
var mailer   = require( '../mailer'    );

var _ = require('lodash')._;

var schema = {
    type: 'object',
    required: true,
    properties: {
        hash: {
            type: 'string',
            description: "The user has to find the account",
            required: true,
            allowEmpty: false,
            pattern: regex.sha256,
            messages: {
                pattern: "not a valid hash"
            }
        },

        password: {
            type: 'string',
            description: "The new password to put into the database",
            required: true,
            allowEmpty: false,
            pattern: regex.sha256,
            messages: {
                pattern: "not a valid hash"
            }
        }

    }
};


function validateRecoverPasswordRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {
            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'hash':
                    errorCode = 'userHashInvalid';
                    break;
                case 'password':
                    errorCode = 'passwordInvalid';
                    break;
                default:
                    errorCode = 'malformedRequest';
                    break;
            }
            var err = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( err );
            return;
        }

        resolve();
    } );
}

/**
 * Sends a password updated email to the related user using the user object and the configuration
 * file to make the email
 *
 * @param  {User} user A user object in the form of the DB Table relating to the user where each
 *                     column is a variable my the column name.
 * @return {Promise}   A Q style promise object
 */
function sendPasswordUpdateEmail( user ) {
    return Q.Promise( function( resolve, reject ) {

        var url = URLModule.format( {
            protocol: config.server.mode,
            host: config.server.hostname
        } );

        var viewName = config.mailer.recoverAccountViewName;

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.recoverAccountEmailSubject
        };

        var footerImageURL     = URLModule.resolve( url, 'resources/email/peir-footer.png' );
        var headerImageURL     = URLModule.resolve( url, 'resources/email/peir-header.png' );
        var backgroundImageURL = URLModule.resolve( url, 'resources/email/right-gradient.png' );

        var variables = {
            email: user.EMAIL,
            name: _.capitalize( user.FIRST_NAME + " " + user.LAST_NAME ),
            footerImageURL: footerImageURL,
            headerImageURL: headerImageURL,
            backgroundImageURL: backgroundImageURL
        };

        mailer.sendMail( viewName, variables, mail )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

    } );
}

function sendReponse( res ) {
    return Q.Promise( function( resolve, reject ) {

        res.send( {
            "content": {
                message: "Password recovery successful!",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    util.mustBeAnonymous( req )

    // Validate the request structure related to Recover Password requests
    .then( function () {
        return validateRecoverPasswordRequest( req );
    } )

    // Attempt to set the password to the new password after verifying the user hash.
    .then( function() {
        var userHash = req.headers.bridge.hash;
        var newPassword = req.headers.bridge.password;
        return database.recoverPassword( userHash, newPassword, req );
    } )

    // Send the updated password email
    .then( function() {
        return sendPasswordUpdateEmail( req.bridge.user );
    } )

    // Send the success response
    .then( function () {
        return sendReponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any errors that occurred in the above promises
    .fail( function ( err ) {
        next( err );
    } );
};
