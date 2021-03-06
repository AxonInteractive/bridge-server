"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var uri         = require( 'uri-js' );

var regex    = require( '../regex'     );
var error    = require( '../error'     );
var mailer   = require( '../mailer'    );
var database = require( '../database'  );
var config   = require( '../config'    );
var app      = require( '../../server' ).app;

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

        var query  = "SELECT * FROM users WHERE EMAIL = ?";
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

        var viewName = config.mailer.recoverAccountEmail.viewName;

        var url = app.get( 'rootURL' );

        var fragment = uri.serialize( {
            path: '/account-recovery',
            query: 'hash=' + user.USER_HASH
        } );

        var variables = {
            recoveryURL: null
        };

        variables.recoveryURL = uri.parse( app.get( 'rootURL' ) );

        variables.recoveryURL.fragment = fragment;
        variables.recoveryURL = uri.serialize( variables.recoveryURL );

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.recoverAccountEmail.subject
        };

        user = _.transform( user, function ( result, value, key ) {
            key = key.toLowerCase();
            var arr = key.split( '_' );
            for ( var i = 1; i < arr.length; i += 1 ) {
                arr[ i ] = arr[ i ].charAt( 0 ).toUpperCase() + arr[ i ].slice( 1 );
            }
            key = arr.join( '' );
            result[ key ] = value;
        } );

        mailer.sendMail( viewName, variables, mail, user )
            .then( function () {
                resolve();
            } )
            .fail( function ( err ) {
                reject( err );
            } );
    } );
}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send( {
            content: "Password recovery email sent successfully"
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

    // Catch any errors that occurred in the above promises
    .fail( function ( err ) {
        next( err );
    } );
};
