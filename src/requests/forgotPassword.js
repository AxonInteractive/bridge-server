"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var URLModule   = require( 'url' );

var regex    = require( '../regex'     );
var error    = require( '../error'     );
var mailer   = require( '../mailer'    );
var database = require( '../database'  );
var util     = require( '../../server' ).util;
var config   = require( '../../server' ).config;

var schema = {
    properties: {
        email: {
            description: "The message relating to the forgot password request. should be an email",
            type: 'string',
            required: true,
            allowEmpty: false,
            format: 'email'
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
                case 'email':
                    errorCode = 'emailInvalid';
                    break;
                default:
                    errorCode = 'malformedRequest';
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
        var values = [ req.headers.bridge.email ];

        database.query( query, values )
            .then( function ( rows ) {

                if ( rows.length !== 1 ) {
                    reject( error.createError( 400, 'userNotFound', "No user found with that email" ) );
                    return;
                }

                req.bridge.user = rows[ 0 ];

                resolve( rows[ 0 ] );
            } )
            .fail( function ( err ) {

                reject( error.createError( 500, 'databaseError', err ) );

            } );
    } );
}

/**
 * Sends a forgot password email to the users registered email.
 *
 * @param  {User} user A user object in the form of the DB Table relating to the user where each
 *                     column is a variable my the column name.
 *
 * @return {Promise}   A Q style promise object
 */
function sendForgotPasswordEMail( user ) {
    return Q.Promise( function ( resolve, reject ) {

        var viewName = config.mailer.recoverAccountViewName;

        var url = URLModule.format( {
            protocol: config.server.mode,
            host: config.server.hostname,
        } );

        var footerURL = URLModule.resolve( url, 'resources/email/peir-footer.png' );
        var headerURL = URLModule.resolve( url, 'resources/email/peir-header.png' );
        var backgroundURL = URLModule.resolve( url, 'resources/email/right-gradient.png' );

        var variables = {
            email: user.EMAIL,
            name : _.capitalize( user.FIRST_NAME + " " + user.LAST_NAME ),
            footerImageURL: footerURL,
            headerImageURL: headerURL,
            backgroundImageURL: backgroundURL,
            recoveryURL: ""
        };

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.recoverAccountEmailSubject
        };

        mailer.sendMail( viewName, variables, mail )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

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


    // Check that the request is in the valid format
    validateForgotPasswordRequest( req )

    // Check that the request user exists in the database
    .then( function() {
        return checkUserExists( req );
    } )

    .then( function( user ) {
        return database.forgotPassword( user );
    } )

    // Send the email related to recovering the password
    .then( function () {
        return sendForgotPasswordEMail( req.bridge.user );
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
