"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );

var regex = require( '../regex' );
var error = require( '../error' );
var util   = require( '../utilities' );
var database = require( '../database' );

var _ = require('lodash')._;

var schema = {
    type: 'object',
    required: true,
    properties: {
        content: {
            type: 'object',
            required: true,
            properties: {

                hash: {
                    type:'string',
                    description: "The user has to find the account",
                    required: true,
                    allowEmpty: false,
                    pattern: regex.sha256,
                    messages: {
                        pattern: "not a valid hash"
                    }
                },

                message: {
                    type: 'string',
                    description: "The new password to put into the database",
                    required: true,
                    allowEmpty: false,
                    pattern: regex.sha256,
                    messages: {
                        pattern: "not a valid hash"
                    }
                }

                // time: {
                //     type: 'string',
                //     description: "The time the request was sent",
                //     required: true,
                //     allowEmpty: false,
                //     pattern: regex.ISOTime,
                //     messages: {
                //         pattern: "not a valid time"
                //     }
                // }
            }
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


function validateRecoverPasswordRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {
            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.hash':
                    errorCode = 'Invalid user hash format';
                    break;
                case 'content.message':
                    errorCode = 'Invalid password format';
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
                    errorCode = 'Malformed recover password request';
                    break;
            }
            var err = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( err );
            return;
        }

        resolve();
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

    // Check that the basic request structure is verified
    util.checkRequestStructureVerified( req )

    // The request must be anonymous. (Not logged in)
    .then( function () {
        return util.mustBeAnonymous( req );
    } )

    // Validate the request structure related to Recover Password requests
    .then( function () {
        return validateRecoverPasswordRequest( req );
    } )

    .then( function() {
        return database.recoverPassword( req.headers.bridge.content.hash, req.headers.bridge.content.message );
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
