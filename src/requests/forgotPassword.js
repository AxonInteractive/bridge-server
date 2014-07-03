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
            required: true
        },

        time: {
            description: "This is the time the request was made",
            type: 'string',
            pattern: regex.iSOTime,
            allowEmpty: false,
            required: true
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
        fpError = new error( "Request structure must be verified", 500 );

        res.send( fpError.Message );
        res.status( fpError.StatusCode );


        if ( _.isFunction( cb ) ) {
            cb( fpError );
        }
        return;
    }

    if ( !_.isObject( req.body ) ) {
        fpError = new error( "Request body is not an object", 400 );

        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( fpError ),
            RequestBody: JSON.stringify( req.body )
        } );

        res.send( fpError.Message );
        res.status( fpError.StatusCode );
        
        if ( _.isFunction( cb ) ) {
            cb( fpError );
        }

        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[0];

        res.status( 400 );

        res.send({
            content: {
                message: "Property: " + firstError.property + " : " + firstError.message,
                time: new Date().toISOString()
            }
        });



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