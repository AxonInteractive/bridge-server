"use strict";

var Q = require( 'q' );

var error = require( '../error' );
var util  = require( '../utilities' );

function parseAppData( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var appData = {};

        try {
            appData = JSON.parse( req.bridge.user.APP_DATA );
        } catch ( err ) {

            // Create the error
            var userParseError = error.createError( 500, 'appDataIsNotJSON', "Could not parse application data to an object" );


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
                email: user.EMAIL,
                firstName: user.FIRST_NAME,
                lastName: user.LAST_NAME,
                status: user.STATUS,
                role: user.ROLE,
                appData: appData
            }
        } );

        res.status( 200 );

        resolve();
    } );
}

module.exports = function( req, res, next ) {

    util.mustBeLoggedIn( req )

    .then( function() {
        return parseAppData( req );
    } )

    .then( function( appData ) {
        return sendReponse( req, res, appData );
    } )

    .fail( function( err ) {
        next( err );
    } );

};
