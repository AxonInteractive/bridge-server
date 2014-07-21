"use strict";

var fs         = require( 'fs'          );
var path       = require( 'path'        );
var config     = require( '../server'   ).config;
var app        = require( '../server'   ).app;


exports.setup = function () {

    app.get( '/api/1.0/login', require('./requests/login') );

    app.post( '/api/1.0/users', require('./requests/register') );

    app.put( '/api/1.0/users', require('./requests/updateUser') );

    app.get( '/api/1.0/users', function( req, res, next){
        next();
    });

    app.put( '/api/1.0/recover-password', require( './requests/recoverPassword') );

    app.put( '/api/1.0/forgot-password', require( './requests/forgotPassword' ) );

    app.put( '/api/1.0/verify-email', require( './requests/verifyEmail' ) );

    app.get( '/', serveIndex );

};

function serveIndex( req, res ) {
    var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );
    if ( fs.existsSync( indexPath ) ) {
        res.sendfile( indexPath );
        return;
    }

    res.status( 404 );
    res.send( "Could not find the homepage" );
}
