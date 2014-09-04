"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;

var regex    = require( '../regex' );
var error    = require( '../error' );
var mailer   = require( '../mailer' );
var database = require( '../database' );
var util     = require( '../../server').util;

var schema = {
    properties: {
        content: {
            description: "This is the content of a ForgotPassword Request",
            type: 'object',
            required: true,
            properties: {
                message: {
                    description: "The message relating to the forgot password request. should be an email",
                    type: 'string',
                    required: true,
                    allowEmpty: false,
                    format: 'email'
                }
            }
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
            pattern: regex.ISOTime,
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

function validateForgotPasswordRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var valError;
        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.message':
                    errorCode = 'Invalid email format';
                    break;
                case 'email':
                    errorCode = 'Invalid email format';
                    break;
                case 'hmac':
                    errorCode = 'Invalid HMAC format';
                    break;
                case 'time':
                    errorCode = 'Invalid time format';
                    break;
                default:
                    errorCode = 'Malformed forgot password request';
                    break;
            }

            valError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( valError );
            return;
        }

        resolve();
    } );
}

function checkUserExists( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var query  = "SELECT EMAIL FROM users WHERE EMAIL = ?";
        var values = [ req.headers.bridge.content.message ];

        database.query( query, values )
            .then( function ( rows ) {

                if ( rows.length !== 1 ) {
                    reject( error.createError( 400, 'Email not found', "No user found with that email" ) );
                    return;
                }

                resolve( rows[ 0 ] );
            } )
            .fail( function ( err ) {

                reject( error.createError( 500, 'Database query error', err ) );

            } );
    } );
}

function sendForgotPasswordEMail( req ) {
    return Q.Promise( function ( resolve, reject ) {

        // Prep the user object for the forgot password email
        req.bridge.user = {
            email: req.headers.bridge.content.message
        };

        mailer.sendForgotPasswordEMail( req );

        resolve();
    } );
}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send( {
            content: {
                message: "Password recovery email sent successfully",
                time: new Date().toISOString()
            }
        } );

        res.status( 200 );

        resolve();

    } );
}

module.exports = function( req, res, next ) {

    // Check that the request has passed the structure test
    util.checkRequestStructureVerified( req )

    // Check that the request is in the valid format
    .then( function () {
        return validateForgotPasswordRequest( req );
    } )

    // Check that the request user exists in the database
    .then( function() {
        return checkUserExists( req );
    } )

    .then( function( user ) {
        return database.forgotPassword( user );
    } )

    // Send the email related to recovering the password
    .then( function () {
        return sendForgotPasswordEMail( req );
    } )

    // Send the success response
    .then( function () {
        return sendResponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any errors that occurred in the above promises
    .fail( function ( err ) {
        next( err );
    } );
};
