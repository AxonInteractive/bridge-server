"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var mailer   = require( '../mailer' );
var util     = require( '../utilities' );
var config   = require( '../../server' ).config;

var schema = {
    properties: {
        content: {
            type: 'object',
            required: true,
            description: "The content of the registration request",
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
                },

                regcode: {
                    type: 'string',
                    required: false
                }
            },
        },

        email: {
            type: 'string',
            description: "The email of the request, used for identification",
            required: true,
            allowEmpty: true,
            pattern: regex.optionalEmail,
            messages: {
                pattern: "not a valid email"
            }
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

function validateRegisterRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {
            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.email':
                    errorCode = 'Invalid email format';
                    break;
                case 'content.password':
                    errorCode = 'Invalid password format';
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
                    errorCode = 'Malformed register request';
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
        resolve( req.headers.bridge.content );
    } );
}

function sendVerificationEmail( req ) {
    return Q.Promise( function ( resolve, reject ) {
        if ( config.server.emailVerification === true ) {
            mailer.sendVerificationEmail( req )
                .then( function () {
                    resolve();
                } );
        } else {
            resolve();
        }
    } );
}

function sendReponse( req ) {
    return Q.Promise( function ( resolve, reject ) {

        req.res.send( {
            content: {
                message: "User registered successfully!",
                time: new Date().toISOString()
            }
        } );

        req.res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    // Check that the basic request structure is verified.
    util.checkRequestStructureVerified( req )

    // Check that the request is Anonymous (Not Logged in)
    .then( function () {
        return util.mustBeAnonymous( req );
    } )

    // Validate the structure of the request against the registration schema
    .then( function () {
        return validateRegisterRequest( req );
    } )

    // Get the user object out of the request
    .then( function () {
        return getUserObject( req );
    } )

    // Register the user object using the re
    .then( function ( user ) {
        return database.registerUser( user );
    } )

    // Send the verification email
    .then( function () {
        return sendVerificationEmail( req );
    } )

    // Send the successful response message
    .then( function () {
        sendReponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any errors that occurred in the above middle ware
    .fail( function ( err ) {
        next( err );
    } );
};
