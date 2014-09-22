/**@module request/authenticate */

"use strict";

var jwt         = require( 'jwt-simple'  );
var moment      = require( 'moment'      );
var Q           = require( 'q'           );
var revalidator = require( 'revalidator' );

var bridgeWare = require( '../middleware' );
var database   = require( '../database'   );
var config     = require( '../config'     );
var regex      = require( '../regex'      );
var error      = require( '../error'      );

var schema = {
    properties: {
        email: {
            type: 'string',
            required: true,
            format: 'email'
        },

        password: {
            type: 'string',
            required: true,
            pattern: regex.sha256,
            messages: {
                pattern: "is not a valid hash string"
            }
        },

        rememberMe: {
            type: 'boolean',
            required: true
        }
    }
};

function parseBridgeHeader( req, res ) {
    return Q.Promise( function( resolve, reject ) {
        bridgeWare.functions.parseBridgeHeader( req, res, function( err ) {
            if ( err ) {
                reject( err );
                return;
            }

            resolve();
        } );
    } );
}

function validateAuthenticationRequest( req ) {
    return Q.Promise( function( resolve, reject ) {

        var bridgeHeader = req.get( 'bridge' );

        var validation = revalidator.validate( bridgeHeader, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'email':
                    errorCode = 'emailInvalid';
                    break;
                case 'password':
                    errorCode = 'passwordInvalid';
                    break;
                default:
                    errorCode = 'malformedRequest';
                    break;
            }

            reject( error.createError( 400, errorCode, firstError.property + " : " + firstError.message ) );
            return;
        }

    } );
}

function setUserSessionToken( req, user ) {
    var bridgeHeader = req.get( 'bridge' );

    bridgeHeader.user = user;

    var remember = bridgeHeader.rememberMe;

    var tokenDuration = ( remember ?
            config.security.tokenExpiryDurationRememberMe :
            config.security.tokenExpiryDuration
        );

    var tokenExpiry = moment.utc().add( tokenDuration );

    var tokenPayload = {
        email: user.EMAIL,
        password: user.PASSWORD,
        id: user.ID,
        expires: tokenExpiry.toISOString()
    };

    var secret = config.security.tokenSecret;

    var token = jwt.encode( tokenPayload, secret );

    var cookieOptions = {
        httpOnly: false,
        domain: "." + config.server.hostName,
        expires: tokenExpiry.toDate()
    };

    req.bridge.cookies.set( 'BridgeAuth', token, cookieOptions );
}

function sendResponse( res ) {
    res.status( 200 );

    res.send( {
        content: {
            message: "Authentication successful!"
        }
    } );
}

/**
 * Authenticates a request using the bridge-auth cookie in conjunction with jwt to provided
 * ciphered authentication data.
 *
 * @param  {ExpressRequest}   req   An express request object that is created when a request is made
 *                                  to the server.
 *
 * @param  {ExpressResponse}  res   An express response object that is created when a request is
 *                                  made to the server.
 *
 * @param  {Function}         next  Callback function that is called when an error occured in this
 *                                  function passing an error object as its only argument,
 *
 * @return {Undefined}
 */
module.exports = function( req, res, next ) {

    parseBridgeHeader( req, res )
    .then( function() {
        return validateAuthenticationRequest( req );
    } )
    .then( function() {
        var bridgeHeader = req.get( 'bridge' );

        var email = bridgeHeader.email;
        var password = bridgeHeader.password;

        return database.authenticateUser( email, password );
    } )
    .then( function( user ) {
        return setUserSessionToken( req, user );
    } )
    .then( function() {
        return sendResponse( res );
    } )
    .then( function() {
        next();
    } )
    .fail( function( err ) {
        next( err );
    } );

};
