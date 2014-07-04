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

module.exports = function ( req, res, cb ) {
    var loginError;

    if ( !_.isObject( req.body ) ) {
        loginError = new error( "Request body is not an object", 400 );

        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( loginError ),
            RequestBody: JSON.stringify( req.body )
        } );

        res.send( loginError.Message );
        res.status( loginError.StatusCode );

        if ( _.isFunction( cb ) ) {
            cb( loginError );
        }

        return;
    }

    var validation = revalidator.validate( req.body, schema );

    if ( validation.valid === false ) {

        var firstError = validation.errors[ 0 ];

        res.status( 400 );

        res.send( {
            content: {
                message: "Property: " + firstError.property + " : " + firstError.message,
                time: new Date().toISOString()
            }
        } );

        if ( _.isFunction( cb ) ) {
            cb();
        }

        return;
    }


    database.authenticateRequest( req, res.body, function ( err ) {

        if ( err ) {
            app.get( 'logger' ).verbose( {
                Error: err,
                Reason: "Failed to authenticate request"
            } );

            res.send( {
                content: {
                    message: err.Message,
                    time: new Date().toISOString()
                }
            } );

            res.status( err.StatusCode );

            if ( _.isFunction( cb ) ) {
                cb( err );
            }

            return;
        }

        var user = req.bridge.user;

        var appData = {};

        try {
            appData = JSON.parse( req.bridge.user.APP_DATA );
        } catch ( err ) {

            // Create the error
            var userParseError = new error( 'Could not parse application data to an object', 500 );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: userParseError,
                Reason: "Failed to parse the users application data to JSON",
                "Request Body": JSON.stringify( req.body ),
                "Application Data": req.bridge.user.APP_DATA
            } );

            // Throw the error
            res.send( {
                content: {
                    message: userParseError.Message,
                    time: new Date().toISOString()
                }
            } );

            res.status( userParseError.StatusCode );

            if ( _.isFunction( cb ) ) {
                cb( err );
            }

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

        if ( _.isFunction( cb ) ) {
            cb();
        }

        return;
    } );
};