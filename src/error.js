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
            type: 'integer',
            allowEmpty: false,
            required: true
        },

        debugMessage: {
            required: true
        }
    }
};

/**
 * An object that has keys that match a error code which is an integer.
 * @type {Object}
 */
exports.errorCodeMap = {
    "malformedBridgeHeader"   : 1,
    "databaseError"           : 2,
    "emailInUse"              : 3,
    "authFailedAnon"          : 4,
    "invalidPassword"         : 5,
    "incorrectUserState"      : 6,
    "emailInvalid"            : 7,
    "firstNameInvalid"        : 8,
    "hashInvalid"             : 9,
    "lastNameInvalid"         : 10,
    "passwordInvalid"         : 11,
    "timeInvalid"             : 12,
    "userHashInvalid"         : 13,
    "mustBeLoggedIn"          : 14,
    "structureMustBeVerified" : 15,
    "appDataIsNotJSON"        : 16,
    "userNotFound"            : 17,
    "internalServerError"     : 18,
    "missingBridgeHeader"     : 19,
    "bridgeHeaderIsNotJSON"   : 20,
    "protectedAuthFailed"     : 21,
    "protectedMustBeLoggedIn" : 22,
    "malformedRequest"        : 23,
    "museBeAnonymous"         : 24,
    "invalidToken"            : 25,
    "missingToken"            : 26
};

/**
 * Created a error object based on the inputs of the function. you can extend the errorCodes by
 * editing this modules errorCodeMap object.
 *
 * @param  {Integer}     httpCode     The http status code that is to be sent with the response
 *
 * @param  {String}      errorString  The error code string that is a key to the errorCodeMap
 *
 * @param  {Anything}    debugMessage An extra variable to be sent along with the response
 *
 * @return {ErrorObject}              The error object to be used with expresses error handler.
 */
exports.createError = function ( httpCode, errorString, debugMessage ) {

    var errorCode = exports.errorCodeMap[ errorString ];

    if ( !errorCode ) {
        app.log.warn( "error '" + errorString + "' was not found in the errorMap" );
    }

    var error = {
        status: httpCode,
        errorCode: errorCode || errorCode.internalServerError,
        debugMessage: debugMessage || ""
    };

    var validate = revalidator.validate( error, schema );

    if ( validate.valid === false ) {
        app.log.warn( "Could not validate bridge error. Errors: ", validate.errors );
    }

    return error;
};

exports.validateError = function ( error ) {
    return revalidator.validate( error, schema );
};
