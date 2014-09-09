/** @module request/updateUser */
"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var URLModule   = require( 'url' );

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var util     = require( '../utilities');
var mailer   = require( '../mailer' );
var config   = require( '../config' );

var schema = {
    properties: {
        content: {
            type: 'object',
            required: true,
            properties: {
                appData: {
                    type: 'object',
                    required: false,
                },

                email: {
                    type: 'string',
                    allowEmpty: true,
                    required: false,
                    pattern: regex.optionalEmail,
                    messages: {
                        pattern: "not a valid email"
                    }
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
        },

        email: {
            type: 'string',
            description: "the email to try to login to",
            format: 'email',
            allowEmpty: false,
            required: true
        },
        time: {
            description: "The time the request was made",
            type: 'string',
            pattern: regex.ISOTime,
            allowEmpty: false,
            required: true,
            messages: {
                pattern: "not a valid ISO date"
            }
        },

        hmac: {
            description: "The HMAC of the request to be signed by the bridge client, in hex format",
            type: 'string',
            pattern: regex.sha256,
            allowEmpty: false,
            required: true,
            messages: {
                pattern: "not a valid hash"
            }
        }
    }
};

function validateUpdateUserRequest( req ) {
    return Q.Promise( function( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.email':
                    errorCode = 'Invalid email format';
                    break;
                case 'content.password':
                    errorCode = 'Invalid HMAC format';
                    break;
                case 'content.firstName':
                    errorCode = 'Invalid first name format';
                    break;
                case 'content.lastName':
                    errorCode = 'Invalid last name format';
                    break;
                case 'email':
                    errorCode = 'Invalid email format';
                    break;
                case 'hmac':
                    errorCode = 'Invalid HMAC format';
                    break;
                case 'time':
                    errorCode = 'Invalid time format';
                    break;
                default:
                    errorCode = 'Malformed update user request';
                    break;
            }

            var updateError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( updateError );
            return;
        }

        resolve();
    } );
}

/**
 * Send a email notifiying the owner of the account that their user information has been updated.
 *
 * @param  {User} user A user object in the form of the DB Table relating to the user where each
 *                     column is a variable my the column name.
 *
 * @return {Promise}   A Q style promise object
 */
function sendUpdatedUserEmail( user ) {
    return Q.Promise( function( resolve, reject ) {

        var url = URLModule.format( {
            protocol: config.server.mode,
            name: config.server.hostname
        } );

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.recoverAccountEmailSubject
        };

        var viewName = config.mailer.recoverAccountViewName;

        var footerImageURL     = URLModule.resolve( url, 'resources/email/peir-footer.png'    );
        var headerImageURL     = URLModule.resolve( url, 'resources/email/peir-header.png'    );
        var backgroundImageURL = URLModule.resolve( url, 'resources/email/right-gradient.png' );

        var variables = {
            email: user.EMAIL,
            name: _.capitalize( user.FIRST_NAME + ' ' + user.LAST_NAME ),
            footerImageURL: footerImageURL,
            headerImageURL: headerImageURL,
            backgroundImageURL: backgroundImageURL
        };

        mailer.sendMail( viewName, variables, mail )
        .then( function() {
            resolve();
        } )
        .fail( function( err ){
            reject( err );
        } );

    } );
}

function sendResponse( res ) {
    return Q.Promise( function( resolve, reject ) {

        res.send( {
            content: {
                message: "User updated successfully",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve();
    });
}

module.exports = function ( req, res, next ) {

    // Check that the basic request structure is verified.
    util.checkRequestStructureVerified( req )

    // The request must be in a Logged In State
    .then( function () {
        return util.mustBeLoggedIn( req );
    } )

    // Validate the request to conform with an UpdateUser Request
    .then( function () {
        return validateUpdateUserRequest( req );
    } )

    // Update the user object inside of the database.
    .then( function () {
        return database.updateUser( req );
    } )

    .then( function() {
        return sendUpdatedUserEmail( req.bridge.user );
    } )

    // Send the successful response message
    .then( function () {
        return sendResponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any error that might have occurred in the previous promises.
    .fail( function ( err ) {
        next( err );
    } );
};
