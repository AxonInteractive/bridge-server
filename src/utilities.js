"use strict";

var Q = require( 'q' );

var _ = require( 'lodash' )._;

var error = require( './error' );

exports.checkRequestStructureVerified = function ( req ) {
    return Q.Promise( function ( resolve, reject ) {
        var loginError;

        if ( !_.isBoolean( req.bridge.structureVerified ) || req.bridge.structureVerified === false ) {

            loginError = error.createError( 500, 'structureMustBeVerified', "Request structure must be verified" );

            reject( loginError );
            return;
        }

        resolve();
    } );
};

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

