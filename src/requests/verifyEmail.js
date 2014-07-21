"use strict";

var revalidator = require("revalidator");
var Q           = require('q');

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var util     = require( '../utilities');


module.exports = function ( req, res, next ) {

    // Check that the basic request structure is verified.
    util.checkRequestStructureVerified( req )

    // Validate the request to conform with the Verify Email request
    .then( function () {
        return validateVerifyEmailRequest( req );
    } )

    // Verify the email in the datebase
    .then( function () {
        return database.verifyEmail( req );
    } )

    // Send the successful response message
    .then( function () {
        return sendResponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any error that occurred on the on the above promises
    .fail( function ( err ) {
        next( err );
    } );
};

var schema = {
    properties: {
        content: {
            type: 'object',
            required: true,
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
            pattern: regex.iSOTime,
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

function validateVerifyEmailRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {


        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch( firstError.property ) {
                case 'content.hash': errorCode = 'Invalid user hash format';       break;
                case 'email':        errorCode = 'Invalid email format';           break;
                case 'hmac':         errorCode = 'Invalid HMAC format';            break;
                case 'time':         errorCode = 'Invalid time format';            break;
                default:             errorCode = 'Malformed verify email request'; break;
            }

            var verifyError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( verifyError );
            return;
        }

        resolve();
    } );
}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send({
            content: {
                message: "Email account verified successfully!",
                time: new Date().toISOString()
            }
        });

        res.status( 200 );

        resolve();
    } );
}

