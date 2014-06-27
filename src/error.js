"use strict";

var resourceful = require( 'resourceful' );

var BridgeError = resourceful.define( 'bridgeError', function () {
    this.string( 'Message', {
        required: true,
        allowEmpty: false
    } );

    this.number( 'StatusCode', {
        required: true,
        minimum: 400,
        maximum: 600,
        divisibleBy: 1
    } );
} );

module.exports = function ( message, statusCode ) {

    var completeMessage = "[ERROR - " + statusCode + "] ";

    switch ( statusCode ) {
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

    completeMessage = completeMessage.concat( "-> " + message );

    var error = new BridgeError({
        Message: completeMessage,
        StatusCode: statusCode
    });

    var validate = error.validate( error, BridgeError );

    if ( validate.valid === false ) {
        app.get( 'logger' ).error( "Could not make error. Problem: ", validate.errors );

        return {
            Message: message,
            StatusCode: statusCode
        };
    }

    return error;
};