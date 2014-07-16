"use strict";

var Q = require( 'q' );

var error = require( './error' );

exports.checkRequestStructureVerified = function ( message ) {
    return Q.Promise( function ( resolve, reject ) {
        var loginError;

        var req = message.req;

        if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

            loginError = error.createError( 500, 'Request structure unverified', "Request structure must be verified" );

            reject( loginError );
            return;
        }

        resolve( message );
    } );
};

exports.mustBeLoggedIn = function ( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        var loginError;

        if ( req.bridge.isAnon === true ) {
            loginError = error.createError( 403, 'Failed to authenticate anonymous request', "Cannot authenticate a request that is anonymous" );

            reject( loginError );
            return;
        }

        resolve( message );
    } );
};

exports.mustBeAnonymous = function( message ) {
    return Q.Promise( function( resolve, reject ) {

        var req = message.req;

        // Must be anonymous
        if ( req.bridge.isAnon !== true ) {
            var regError = error.createError( 403, 'Need authentication', "Cannot register without authentication" );

            reject( regError );
            return;
        }

        resolve( message );

    } );
};
