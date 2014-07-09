"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );

var regex = require( '../regex' );
var error = require( '../error' );

module.exports = function ( req, res, next ) {
    checkStructureVerified( { req: req, res: res } )
        .then(checkForAnonymousRequest)
        .then(validateRecoverPasswordRequest)
        .then(sendReponse)
        .then(function(){
            next();
        })
        .fail(function(err){
            next( err );
        });
};

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
                //     pattern: regex.iSOTime,
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
            var regError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

            reject( regError );
            return;
        }

        resolve( message );
    } );
}

function checkForAnonymousRequest( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        // Must be anonymous
        if ( req.bridge.isAnon !== true ) {
            var regError = error.createError( 500, 'Need authentication', "Cannot register without authentication" );

            reject( regError );
            return;
        }

        resolve( message );

    } );
}

function validateRecoverPasswordRequest( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {
            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.hash':    errorCode = 'Invalid user has format';            break;
                case 'content.message': errorCode = 'Invalid password format';            break;
                case 'email':           errorCode = 'Invalid email format';               break;
                case 'hmac':            errorCode = 'Invalid HMAC format';                break;
                case 'time':            errorCode = 'Invalid time format';                break;
                default:                errorCode = 'Malformed recover password request'; break;
            }
            var err = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( err );
            return;
        }

        resolve( message );
    } );
}

function sendReponse( message ) {
    return Q.Promise( function( resolve, reject ) {
        var res = message.res;

        res.send( {
            "content": {
                message: "Password recovery successful!",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve( message );
    } );
}
