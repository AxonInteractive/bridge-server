"use strict";

var revalidator = require("revalidator");
var Q           = require('q');

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );

module.exports = function ( req, res, next ) {

    checkStructureVerified( { req: req, res: res } )
        .then( validateVerifyEmailRequest )
        .then( database.verifyEmail )
        .then( sendResponse )
        .then( function () {
            next();
        } )
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

function checkStructureVerified( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

            var verifyError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

            reject( verifyError );
            return;
        }

        resolve( message );
    } );
}

function validateVerifyEmailRequest( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch(firstError.property) {
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

        resolve( message );
    } );
}

function sendResponse( message ) {
    return Q.Promise( function ( resolve, reject ) {
        var res = message.res;

        res.send({
            content: {
                message: "Email account verified successfully!",
                time: new Date().toISOString()
            }
        });

        res.status( 200 );

        resolve( message );
    } );
}

