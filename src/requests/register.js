"use strict";

var revalidator = require('revalidator');

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );

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


module.exports = function(req, res, next) {
    var regError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
        regError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        next(regError);
        return;
    }

    // Must be anonymous
    if ( req.bridge.isAnon !== true ) {
        regError = error.createError( 500, 'Need authentication', "Cannot register without authentication" );

        // Throw the error
        next( regError );
        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {
        var firstError = validation.errors[ 0 ];

        var errorCode;

        switch ( firstError.property ) {
        case 'content.email':     errorCode = 'Invalid email format';       break;
        case 'content.password':  errorCode = 'Invalid HMAC format';        break;
        case 'content.firstName': errorCode = 'Invalid first name format';  break;
        case 'content.lastName':  errorCode = 'Invalid last name format';   break;
        default:                  errorCode = 'Malformed register request'; break;
        }

        regError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

        next(regError);
        return;
    }

    req.bridge.user = req.body.content;

    var reqHolder = req;
    var resHolder = res;
    var nextHolder = next;

    database.registerUser( req, res )
        .then( function ( ) {
            res.send( {
                message: "User account successfully created for " + req.bridge.user.EMAIL,
                time: new Date().toISOString()
            } );
            res.status( 200 );
        } )
        .fail( function ( err ) {
            next( err );
        } );

};
