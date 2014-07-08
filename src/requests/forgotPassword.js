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
                    type:'string',
                    required: true,
                    allowEmpty: false,
                    format: 'email'
                }
            }
        }
    }
};


module.exports = function( req, res, next ) {

    var fpError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
        fpError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        res.error = fpError;

        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[0];

        var errorCode;

        switch(firstError.property) {
            case 'content.message': errorCode = 'Invalid email format'; break;
            default: errorCode = 'Malformed forgot password request'; break;
        }

        fpError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

        res.error = fpError;


        return;
    }


    res.send( {
        content: {
            message: "Password recovery email sent successfully",
            time: new Date().toISOString()
        }
    } );

    res.status( 200 );

    if (_.isFunction(next)) {
        next();
    }

};