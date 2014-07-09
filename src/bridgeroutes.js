"use strict";

var pipeline = require( '../lib/pipeline' );
var filters  = require( './filters'       );
var database = require( './database'      );
var mailer   = require( './mailer'        );
var fs       = require( 'fs'              );
var config   = app.get( 'BridgeConfig'    );
var path     = require( 'path' );
var middleware = require('./middleware');
exports.setup = function () {

    app.get( '/api/1.0/login', require('./requests/login') );

    app.post( '/api/1.0/users', require('./requests/register') );

    app.put( '/api/1.0/users', require('./requests/updateUser') );

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

function recoverPassword( req, res ) {

}

function updateUser( req, res ) {
    var uUPipeline = new pipeline();

    uUPipeline
        .pipe( filters.authenticationFilter )
        .pipe( database.updateUser );

    uUPipeline.execute( req, function ( resBody, err ) {
        if ( err != null ) {

            res.status( err.StatusCode );

            app.get( 'logger' ).verbose( {
                req: req.body,
                status: err.StatusCode,
                err: err.Message
            } );

            res.send( err );
            return;
        }

        res.status( 200 );
        res.send( resBody );
    } );
}
