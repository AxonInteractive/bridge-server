"use strict";

var revalidator = require( 'revalidator' );
var Q = require( 'q' );


var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var util     = require( '../utilities');


module.exports = function ( req, res, next ) {

    util.checkRequestStructureVerified( { req: req, res: res } )
        .then( util.mustBeLoggedIn )
        .then( validateUpdateUserRequest )
        .then( database.updateUser )
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

function validateUpdateUserRequest( message ) {
    return Q.Promise( function( resolve, reject ) {

        var req = message.req;

        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.email':     errorCode = 'Invalid email format';          break;
                case 'content.password':  errorCode = 'Invalid HMAC format';           break;
                case 'content.firstName': errorCode = 'Invalid first name format';     break;
                case 'content.lastName':  errorCode = 'Invalid last name format';      break;
                case 'email':             errorCode = 'Invalid email format';          break;
                case 'hmac':              errorCode = 'Invalid HMAC format';           break;
                case 'time':              errorCode = 'Invalid time format';           break;
                default:                  errorCode = 'Malformed update user request'; break;
            }

           var updateError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( updateError );
            return;
        }

            resolve( message );
    } );
}

function sendResponse( message ) {
    return Q.Promise( function( resolve, reject ) {
        var res = message.res;

        res.send( {
            content: {
                message: "User updated successfully",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve( message );
    });
}
