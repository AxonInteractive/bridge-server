"use strict";

var Q = require( 'q' );

var _ = require( 'lodash' )._;

var error = require( './error' );

exports.mustBeLoggedIn = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var loginError;

        if ( req.bridge.isAnon === true ) {
            loginError = error.createError( 403, 'mustBeLoggedIn', "Cannot authenticate a request that is anonymous" );

            reject( loginError );
            return;
        }

        resolve();
    } );
};

exports.mustBeAnonymous = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {

        // Must be anonymous
        if ( req.bridge.isAnon !== true ) {
            var regError = error.createError( 403, 'mustBeAnonymous', "Cannot register without authentication" );

            reject( regError );
            return;
        }

        resolve();

    } );
};

