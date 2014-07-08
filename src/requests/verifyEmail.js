"use strict";

var revalidator = require("revalidator");
var Q           = require('q');

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );

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

module.exports = function ( req, res, next ) {
    var verifyError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

        verifyError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        next( verifyError );
        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[ 0 ];

        verifyError = error.createError( 400, 'Malformed verify email request', firstError.property + " : " + firstError.message );

        next( verifyError );
        return;
    }

    var reqHolder = req;
    var resHolder = res;
    var nextHolder = next;

    database.verifyEmail( req, res )
        .then( function () {
            res.send( {
                content: {
                    message: "Email account verified successfully!",
                    time: new Date().toISOString()
                }
            } );

            res.status( 200 );
        } )

    .fail( function ( err ) {
        next( err );
    } );
};