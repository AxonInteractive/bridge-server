"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );

var regex  = require( '../regex'  );
var error  = require( '../error'  );
var mailer = require( '../mailer' );

module.exports = function( req, res, next ) {

    checkStructureVerified( { req: req, res: res } )
        .then( validateForgotPasswordRequest )
        .then( sendForgotPasswordEMail )
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
            description: "This is the content of a ForgotPassword Request",
            type: 'object',
            required: true,
            properties: {
                message: {
                    description: "The message relating to the forgot password request. should be an email",
                    type: 'string',
                    required: true,
                    allowEmpty: false,
                    format: 'email'
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
        var res = message.res;

        var structError;

        if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
            structError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

            reject( structError );
            return;
        }

        resolve( message );
    });
}

function validateForgotPasswordRequest( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;
        var res = message.res;

        var valError;
        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.message': errorCode = 'Invalid email format'             ; break;
                case 'email'          : errorCode = 'Invalid email format'             ; break;
                case 'hmac'           : errorCode = 'Invalid HMAC format'              ; break;
                case 'time'           : errorCode = 'Invalid time format'              ; break;
                default               : errorCode = 'Malformed forgot password request'; break;
            }

            valError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( valError );
            return;
        }

        resolve( message );
    } );
}

function sendForgotPasswordEMail( message ) {
    return Q.Promise( function ( resolve, reject ) {

        mailer.sendForgotPasswordEMail( message.req );

        resolve( message );
    } );
}

function sendResponse( message ) {
    return Q.Promise( function ( resolve, reject ) {
        var req = message.req;
        var res = message.res;

        res.send( {
            content: {
                message: "Password recovery email sent successfully",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve();

    } );
}
