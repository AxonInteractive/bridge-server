"use strict";

var revalidator = require( 'revalidator' );
var app = require('../server').app;

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
            required: true
            // enum: [
            //         'Basic request structure malformed',
            //         'Could not determine filters for GET request',
            //         'Database query error',
            //         'Email already used',
            //         'Email not found',
            //         'Failed to authenticate anonymous request',
            //         'Filter is not a string',
            //         'HMAC failed',
            //         'Incorrect user state',
            //         'Invalid email format',
            //         'Invalid first name format',
            //         'Invalid HMAC format',
            //         'Invalid last name format',
            //         'Invalid password format',
            //         'Invalid time format',
            //         'Invalid user hash format',
            //         'Malformed forgot password request',
            //         'Malformed login request',
            //         'Malformed recover password request',
            //         'Malformed update user request',
            //         'Malformed verify email request',
            //         'Need authentication',
            //         'Request JSON failed to parse',
            //         'Request structure unverified',
            //         'User appData could not parse to JSON',
            //         'User not found'
            //     ]
        }
    }
};

exports.createError = function ( httpCode, errorCode, debugMessage ) {

    var error = {
        status: httpCode,
        errorCode: errorCode
    };

    if ( debugMessage ) {
        error.message = debugMessage;
    }

    var validate = revalidator.validate( error, schema );

    if ( validate.valid === false ) {
        app.log.warn( "Could not validate bridge error. Errors: ", validate.errors );
    }

    return error;
};

exports.validateError = function ( error ) {
    return revalidator.validate( error, schema );
};
