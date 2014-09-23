/**@module request/deauthenticate */

"use strict";

var jwt         = require( 'jwt-simple'  );
var moment      = require( 'moment'      );

var config     = require( '../config'     );

function setUserSessionToken( req ) {
    var bridgeHeader = req.get( 'bridge' );

    var remember = bridgeHeader.rememberMe;

    var tokenPayload = "deleted";

    var secret = config.security.tokenSecret;

    var token = jwt.encode( tokenPayload, secret );

    var cookieOptions = {
        httpOnly: true,
        overwrite: true
    };

    if ( remember ) {

        var tokenDuration = config.security.tokenExpiryDurationRememberMe;

        var tokenExpiry = moment.utc(0);

        cookieOptions.expires = tokenExpiry.toDate();
    }

    req.bridge.cookies.set( 'BridgeAuth', token, cookieOptions );
}

function sendResponse( res ) {
    res.status( 200 );

    res.send( {
        content: {
            message: "Deauthentication successful!"
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


    setUserSessionToken( req )
    .then( function() {
        sendResponse( res );
    } )
    .fail( function( err ) {
        next( err );
    } );

};
