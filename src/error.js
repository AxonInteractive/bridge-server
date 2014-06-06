"use strict";
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

    return {
        "Message": completeMessage,
        "StatusCode": statusCode
    };
};