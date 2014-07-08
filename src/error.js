"use strict";

var revalidator = require( 'revalidator' );

var schema = {
    properties: {
        status: {
            type: 'integer',
            required: true,
            minimum: 400,
            maximum: 600
        },

        errorCode: {
            type: 'string',
            allowEmpty: false,
            required: true,
            enum: [
                    'Basic request structure malformed',
                    'Database query error',
                    'Email already used',
                    'Email not found',
                    'Failed to authenticate anonymous request',
                    'HMAC failed',
                    'Invalid email format',
                    'Invalid time format',
                    'Invalid HMAC format',
                    'Incorrect user state',
                    'Malformed equal on filter',
                    'Malformed forgot password request',
                    'Need authentication',
                    'Request JSON failed to parse',
                    'Request structure unverified',
                    'User appData could not parse to JSON',
                    'User not found' 
                ]
        },

        message: {
            type: 'string',
            allowEmpty: true,
            required: false
        }
    }
};

exports.createError = function ( httpCode, errorCode, debugMessage ) {

    var completeMessage = "[ERROR - " + httpCode + "] ";

    switch ( httpCode ) {
    case 400:
        completeMessage = completeMessage.concat( "BAD REQUEST " );
        break;
    case 401:
        completeMessage = completeMessage.concat( "UNAUTHORIZED " );
        break;
    case 403:
        completeMessage = completeMessage.concat( "FORBIDDEN " );
        break;
    case 409:
        completeMessage = completeMessage.concat( "CONFLICT " );
        break;
    case 500:
        completeMessage = completeMessage.concat( "INTERNAL SERVER ERROR " );
        break;
    default:
        break;
    }

    completeMessage = completeMessage.concat( "-> " + debugMessage );

    var error = {
        status: httpCode,
        errorCode: errorCode,
        message: debugMessage
    };

    var validate = revalidator.validate( error, schema );

    if ( validate.valid === false ) {
        app.get( 'logger' ).verbose( "Could not validate bridge error. Errors: ", validate.errors );

        return {
            status: httpCode,
            message: debugMessage,
            errorCode: errorCode
        };
    }

    return error;
};

exports.validateError = function ( error ) {
    return revalidator.validate( error, schema );
};