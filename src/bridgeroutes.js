/** @module BridgeRoutes */
"use strict";

var fs         = require( 'fs'           );
var path       = require( 'path'         );
var express    = require( 'express'      );

var config     = require( '../server'    ).config;
var app        = require( '../server'    ).app;
var bridgeWare = require( './middleware' );

var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

app.log.debug( "Index Path: " + path.resolve( indexPath ) );

/**
 * Servers the file specified by the bridge configuration file under config.server.indexPath, that
 * is prepended to the config.server.wwwRoot path.
 *
 * @param  {ExpressRequest}  req  An express request object that is made when a request is made to
 *                                the server.
 *
 * @param  {ExpressResponse} res  An express response object that is made when a request is made to
 *                                the server.
 *
 * @return {Undefined}
 */
exports.serveIndex = function( req, res ) {

    var indexPath = path.join( config.server.wwwRoot, config.server.indexPath );

    if ( fs.existsSync( indexPath ) ) {
        res.sendfile( indexPath );
        return;
    }

    exports.send404( req, res );
};

/**
 * Sends a 404 html file if it exists. if the file doesn't exists this just sends a string "404 -
 * Not Found".
 *
 * @param  {ExpressRequest}  req  An express request object that is made when a request is made to
 *                                the server.
 *
 * @param  {ExpressResponse} res  An express response object that is made when a request is made to
 *                                the server.
 *
 * @return {Undefined}
 */
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

    privateRouter.use( bridgeWare.authenticateToken );

    publicRouter.route( '/authenticate' )
        .post( require( './requests/authenticate' ) );

    privateRouter.route( '/deauthenticate' )
        .delete( require( './requests/deauthenticate' ) );

    publicRouter.route( '/user' )
        .post( require( './requests/register' ) );

    privateRouter.route( '/user' )
        .put( require( './requests/updateUser' ) )
        .get( require( './requests/getUser' ) );

    publicRouter.route( '/recover-password' )
        .put( require( './requests/recoverPassword' ) );

    publicRouter.route( '/forgot-password' )
        .put( require( './requests/forgotPassword' ) );

    privateRouter.route( '/verify-email' )
        .put( require( './requests/verifyEmail' ) );


    app.log.debug( 'Bridge routes setup' );

};
