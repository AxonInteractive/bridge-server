"use strict";

var Q = require( 'q' );
var fs = require( 'q-io/fs' );
var _ = require( 'lodash' );

var error = require( './error' );
var app = require( '../server' ).app;

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

exports.deleteFile = function( path, timesCalled ) {

    if ( _.isUndefined( timesCalled ) ) {
        timesCalled = 0;
    }

    if ( !_.isNumber( timesCalled ) ) {
        timesCalled = 0;
    }

    fs.exists( path )
        .then( function( exists ) {
            if ( exists ) {
                fs.remove( path )
                    .then( function() {
                        app.log.debug( "Successfully deleted file: " + path );
                    } )
                    .fail( function( err ) {
                        app.log.warn( "Could not delete file: " + path );
                        timesCalled += 1;
                        setTimeout( exports.deleteFile, 10000, path, timesCalled );
                        throw err;
                    });
            }
        } )
        .fail( function( err ) {
            app.log.debug( 'fs exists failed: ', err );
            return;
        });
};

