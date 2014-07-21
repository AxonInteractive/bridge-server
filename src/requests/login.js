"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );

var regex       = require( '../regex'     );
var error       = require( '../error'     );
var util        = require( '../utilities' );

module.exports = function ( req, res, next ) {

    // Check that the basic structure is verified
    util.checkRequestStructureVerified( req )

    // Must be logged in
    .then( function () {
        return util.mustBeLoggedIn( req );
    } )

    // Validate the request
    .then( function () {
        return validateLoginRequest( req );
    } )

    // Parse the application data from the database
    .then( function () {
        return parseAppData( req );
    } )

    // Send the success response
    .then( function ( appData ) {
        return sendReponse( req, res, appData );
    } )

    // Move onto the next middleware
    .then( function () {
        next();
    } )

    // Catch any errors from the above promises
    .fail( function ( err ) {
        next( err );
    } );
};

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

function validateLoginRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var loginError;

        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'email': errorCode = 'Invalid email format';    break;
                case 'hmac':  errorCode = 'Invalid HMAC format';     break;
                case 'time':  errorCode = 'Invalid time format';     break;
                default:      errorCode = 'Malformed login request'; break;
            }

            loginError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( loginError );
            return;
        }

        resolve ();
        return;
    } );
}

function parseAppData( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var appData = {};

        try {
            appData = JSON.parse( req.bridge.user.APP_DATA );
        } catch ( err ) {

            // Create the error
            var userParseError = error.createError( 500, 'User appData could not parse to JSON', "Could not parse application data to an object" );


            reject( userParseError );
            return;
        }

        resolve( appData );
    } );
}

function sendReponse( req, res, appData ) {
    return Q.Promise( function ( resolve, reject ) {

        var user = req.bridge.user;

        res.send( {
            content: {
                user: {
                    email: user.EMAIL,
                    firstName: user.FIRST_NAME,
                    lastName: user.LAST_NAME,
                    status: user.STATUS,
                    role: user.ROLE,
                    appData: appData
                },

                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve();
    } );
}

