"use strict";

var fs         = require( 'fs'           );
var path       = require( 'path'         );
var express    = require( 'express'      );
var config     = require( '../server'    ).config;
var app        = require( '../server'    ).app;
var bridgeWare = require( './middleware' );

var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

app.log.debug( "Index Path: " + path.resolve( indexPath ) );

exports.serveIndex = function( req, res ) {

    var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

    if ( fs.existsSync( indexPath ) ) {
        res.sendfile( indexPath );
        return;
    }

    exports.send404( req, res );
};

exports.send404 = function( req, res ) {
    res.status( 404 );

    var NotFoundPath = path.join( config.server.wwwRoot, "404.html" );

    fs.exists( NotFoundPath, function ( exists ) {

        if ( !exists ) {
            res.send( "404 - Not found" );
            return;
        }

        res.sendFile( path.resolve( NotFoundPath ) );

    } );
};

exports.setup = function () {

    var publicRouter = app.get( 'publicRouter' );
    var privateRouter = app.get( 'privateRouter' );

    //privateRouter.use( bridgeWare.verifyToken() );

    publicRouter.route( '/login' )
        .get( require( './requests/login' ) );

    privateRouter.route( '/users' )
        .post( require( './requests/register' ) )
        .put( require( './requests/updateUser' ) );

    publicRouter.route( '/recover-password' )
        .put( require( './requests/recoverPassword' ) );

    publicRouter.route( '/forgot-password' )
        .put( require( './requests/forgotPassword' ) );

    privateRouter.route( '/verify-email' )
        .put( require( './requests/verifyEmail' ) );


    app.log.debug( 'Bridge routes setup' );

};
