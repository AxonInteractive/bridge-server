"use strict";

var resourceful = require('resourceful');
var BridgeError = resourceful.define('bridgeError');

BridgeError.string('Message');
BridgeError.number('StatusCode');


module.exports = function(message, statusCode){

    var completeMessage = "[ERROR - " + statusCode + "] ";

    switch(statusCode){
        case 400:
        completeMessage = completeMessage.concat("BAD REQUEST ");
        break;
        case 401:
        completeMessage = completeMessage.concat("UNAUTHORIZED ");
        break;
        case 403:
        completeMessage = completeMessage.concat("FORBIDDEN ");
        break;
        case 409:
        completeMessage = completeMessage.concat("CONFLICT ");
        break;
        case 500:
        completeMessage = completeMessage.concat("INTERNAL SERVER ERROR ");
        break;
        default:
        break;
    }

    completeMessage = completeMessage.concat("-> " + message);

    return new( BridgeError )( {
        Message:    completeMessage,
        StatusCode: statusCode
    } );
};