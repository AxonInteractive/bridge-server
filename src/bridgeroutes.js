"use strict";

var fs         = require( 'fs'          );
var path       = require( 'path'        );
var express    = require( 'express'     );
var config     = require( '../server'   ).config;
var app        = require( '../server'   ).app;

var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

app.log.debug( "Index Path: " + path.resolve( indexPath ) );

function serveIndex( req, res ) {

    var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

    if ( fs.existsSync( indexPath ) ) {
        res.sendfile( indexPath );
        return;
    }

    res.status( 404 );
    res.send( "Could not find the homepage" );
}

exports.setup = function () {

    var router = express.Router();

    router.route( '/api/1.0/login' )
        .get( require( './requests/login' ) );

    router.route( '/api/1.0/users' )
        .post( require( './requests/register' ) )
        .put( require( './requests/updateUser' ) );

    router.route( '/api/1.0/recover-password' )
        .put( require( './requests/recoverPassword' ) );

    router.route( '/api/1.0/forgot-password' )
        .put( require( './requests/forgotPassword' ) );

    router.route( '/api/1.0/verify-email' )
        .put( require( './requests/verifyEmail' ) );

    router.route( '/' )
        .get( serveIndex );

    app.use ( router );

    app.log.debug( 'Bridge router setup' );

};
