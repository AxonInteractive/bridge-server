"use strict";

var revalidator = require( 'revalidator' );
var Q = require( 'q' );


var regex = require( '../regex' );
var error = require( '../error' );
var database = require( '../database' );
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

module.exports = function ( req, res, next ) {
    var updateError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

        updateError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        next( updateError );
        return;
    }

    // Must be logged in
    if ( req.bridge.isAnon === true ) {
        updateError = error.createError( 403, 'Failed to authenticate anonymous request', "Cannot authenticate a request that is anonymous" );

        next( updateError );
        return;
    }

    var validation = revalidator.validate( req.body, schema );

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
        default:
            errorCode = 'Malformed update user request';
            break;
        }

        updateError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

        next( updateError );
        return;
    }

    database.updateUser( req, res )
        .then( function () {
            res.send( {
                content: {
                    message: "User updated successfully",
                    time: new Date.toISOString()
                }
            } );
        } )
        .fail( function ( err ) {
            next( err );
        } );

};