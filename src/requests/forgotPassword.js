"use strict";

var revalidator = require('revalidator');

var regex = require('../regex');
var error = require('../error');

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

function verifyStructure(req, res) {

    var structError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
        structError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        throw structError;
    }
}

function validateRequest(req, res) {

    var valError;
    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[ 0 ];

        var errorCode;

        switch ( firstError.property ) {
        case 'content.message': errorCode = 'Invalid email format';              break;
        default:                errorCode = 'Malformed forgot password request'; break;
        }

        valError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

        throw valError;
    }
}

function sendResponse(req, res) {
    
    res.send( {
        content: {
            message: "Password recovery email sent successfully",
            time: new Date().toISOString()
        }
    } );

    res.status( 200 );

}


module.exports = function( req, res, next ) {

    var fpError = false;

    try {
        verifyStructure( req );
        validateRequest( req );
        sendResponse( res );
    }

    catch (err) {
        next(err);
        return;
    }

    next();

};