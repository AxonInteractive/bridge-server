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
        },

        email: {
            description: "This is the email of the request",
            type: 'string',
            pattern: regex.optionalEmail,
            allowEmpty: true,
            required: true,
            messages: {
                pattern: "is not a valid email"
            }
        },

        time: {
            description: "This is the time the request was made",
            type: 'string',
            pattern: regex.iSOTime,
            allowEmpty: false,
            required: true,
            messages: {
                pattern: "is not a valid ISO date"
            }
        },

        hmac: {
            description: "The HMAC of the request to be signed by the bridge client, in hex format",
            type: 'string',
            pattern: regex.sha256,
            allowEmpty: false,
            required: true
        }
    }
};


module.exports = function( req, res, cb ) {

    var fpError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
        fpError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        res.errors = fpError;

        if ( _.isFunction( cb ) ) {
            cb( fpError );
        }
        return;
    }

    if ( _.isString( req.body ) ) {
        fpError = error( 400, 'Request JSON failed to parse', "Request body is a string instead of an object" );

        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( fpError ),
            RequestBody: JSON.stringify( req.body )
        } );

        res.errors = fpError;

        if ( _.isFunction( cb ) ) {
            cb( fpError );
        }

        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {


        var firstError = validation.errors[0];

        fpError = error.createError( 400, 'Malformed forgot password request', firstError.property + " : " + firstError.message );

        res.errors = fpError;

        if ( _.isFunction( cb ) ) {
            cb();
        }
        return;
    }


    res.send( {
        content: {
            message: "Password recovery email sent successfully",
            time: new Date().toISOString()
        }
    } );

    res.status( 200 );

    if (_.isFunction(cb)) {
        cb();
    }

};