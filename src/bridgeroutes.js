"use strict";

var fs   = require( 'fs' );
var path = require( 'path' );
var app  = require( '../server' ).app;

var filters    = require( './filters' );
var database   = require( './database' );
var mailer     = require( './mailer' );
var middleware = require( './middleware' );

var config = app.get( 'BridgeConfig' );

exports.setup = function () {

    app.get( '/api/1.0/login', require('./requests/login') );

    app.post( '/api/1.0/users', require('./requests/register') );

    app.put( '/api/1.0/users', require('./requests/updateUser') );

    app.put( '/api/1.0/recover-password', require( './requests/recoverPassword') );

    app.put( '/api/1.0/forgot-password', require( './requests/forgotPassword' ) );

    app.put( '/api/1.0/verify-email', require( './requests/verifyEmail' ) );

    app.get( '/', serveIndex );

    app.log.debug( 'Bridge routes setup' );

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
