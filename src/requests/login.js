"use strict";

var revalidator = require( 'revalidator' );
var regex       = require( '../regex' );
var error       = require( '../error' );
var database    = require( '../database' );

var schema = {
    properties: {
        content: {
            type:'object',
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
            type: 'string',
            description: "The time the request was sent in ISO format",
            pattern: regex.iSOTime,
            allowEmpty: false,
            required: true
        },
        hmac: {
            type: 'string',
            description: "The hmac signature of the bridge request in hex encoding",
            pattern: regex.sha256,
            allowEmpty: false,
            required: true
        }
    }
};

module.exports = function ( req, res, next ) {
    var loginError;

    if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

        loginError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

        res.error = loginError;

        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[ 0 ];

        loginError = error.createError( 400, 'Malformed forgot password request', firstError.property + " : " + firstError.message );

        res.error = loginError;

        next();
        return;
    }

    if ( req.bridge.isAnon === true ) {
        loginError = error.createError( 403, 'Failed to authenticate anonymous request', "Cannot authenticate a request that is anonymous" );

        res.error = loginError;
        next();
        return;
    }


    // database.authenticateRequest( req, res.body, function ( err ) {

    //     if ( err ) {
    //         app.get( 'logger' ).verbose( {
    //             Error: err,
    //             Reason: "Failed to authenticate request"
    //         } );

    //        res.error = err;

    //         if ( _.isFunction( next ) ) {
    //             next();
    //         }

    //         return;
    //     }

    var user = req.bridge.user;

    var appData = {};

    try {
        appData = JSON.parse( req.bridge.user.APP_DATA );
    } catch ( err ) {

        // Create the error
        var userParseError = error.createError( 500, 'User appData could not parse to JSON', "Could not parse application data to an object" );

        // Log the error and relevant information
        app.get( 'logger' ).verbose( {
            Error: userParseError,
            Reason: "Failed to parse the users application data to JSON",
            "Request Body": JSON.stringify( req.body ),
            "Application Data": req.bridge.user.APP_DATA
        } );

        res.error = userParseError;
        next();
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