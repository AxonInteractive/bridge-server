"use strict";

var revalidator = require('revalidator');

var regex = require('../regex');
var error = require('../error');

var schema = {
    properties: {
        content: {
            type: 'object',
            required: true,
            description: "The content of the registration request",
            properties: {
                email: {
                    type: 'string',
                    format: 'email',
                    required: true
                },

                'first-name': {
                    type: 'string',
                    allowEmpty: false,
                    required: true
                },

                'last-name': {
                    type: 'string',
                    allowEmpty: false,
                    required: true
                },
                
                password: {
                    type: 'string',
                    pattern: regex.sha256,
                    required: true,
                    messages: {
                        pattern: "not a valid hash"
                    }
                },

                regcode: {
                    type: 'string',
                    required: true
                }
            },
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


module.exports = function(req, res, next) {
    var regError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {
        regError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        res.error = regError;

        if ( _.isFunction( next ) ) {
            next( regError );
        }
        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {
        var firstError = validation.errors[ 0 ];

        regError = error.createError( 400, 'Malformed registration request', firstError.property + " : " + firstError.message );

        res.error = regError;

        if ( _.isFunction( next ) ) {
            next();
        }
        return;
    }

    

};
