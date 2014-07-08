"use strict";

var revalidator = require( 'revalidator' );

var regex       = require( '../regex' );
var error       = require( '../error' );

var schema = {
    properties: {
        content: {
            type: 'object',
            description: 'an empty object',
            required: false,
        },
        email: {
            type: 'string',
            description: "the email to try to login to",
            format: 'email',
            allowEmpty: false,
            required: true
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

module.exports = function ( req, res, next ) {
    var loginError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

        loginError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        next( loginError );
        return;
    }

    if ( req.bridge.isAnon === true ) {
        loginError = error.createError( 403, 'Failed to authenticate anonymous request', "Cannot authenticate a request that is anonymous" );

        next( loginError );
        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[ 0 ];

        var errorCode;

        switch ( firstError.property ) {
        case 'email':           errorCode = 'Invalid email format';    break;
        default:                errorCode = 'Malformed login request'; break;
        }

        loginError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

        next( loginError );
        return;
    }

    var user = req.bridge.user;

    var appData = {};

    try {
        appData = JSON.parse( req.bridge.user.APP_DATA );
    } catch ( err ) {

        // Create the error
        var userParseError = error.createError( 500, 'User appData could not parse to JSON', "Could not parse application data to an object" );


        next( userParseError );
        return;
    }

    res.send( {
        content: {
            user: {
                email: user.EMAIL,
                firstName: user.FIRST_NAME,
                lastName: user.LAST_NAME,
                status: user.STATUS,
                role: user.ROLE,
                appData: appData
            }
        }
    } );

    res.status( 200 );

    next();
    return;
};