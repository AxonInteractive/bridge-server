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


    app.all( '/api/1.0/*', middleware.verifyRequestStructure );

    app.get( '/api/1.0/login', require('./requests/login') );

    app.post( '/api/1.0/users', registerHandler );

    app.put( '/api/1.0/users', updateUser );

    app.put( '/api/1.0/recover-password', recoverPassword );

    app.put( '/api/1.0/forgot-password', require( './requests/forgotPassword' ) );

    app.put( '/api/1.0/verify-email', verifyEmail );

    app.get( '/', serveIndex );

//    app.all( '/api/1.0/*', middleware.bridgeHandleErrors );

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

function loginHandler( req, res ) {
    require('./requests/login')(req, res);
}

function registerHandler( req, res ) {
    var registerPipeline = new pipeline();

    registerPipeline.pipe( filters.registrationDataVaildation )
        .pipe( filters.registrationAuthenticationFilter );

    if ( req.body.dontCommitToDB !== true ) {
        registerPipeline.pipe( database.registerUser );
    }

    registerPipeline.execute( req, function ( resBody, err ) {

        if ( err != null ) {

            app.get( 'logger' ).verbose( {
                req: req.body,
                status: err.StatusCode,
                err: err.Message
            } );

            res.status( err.StatusCode );
            res.send( {
                content: {
                    message: err.Message
                }
            });
            return;
        }

        app.get( 'logger' ).silly( {
            req: req.body,
            status: 200,
            res: resBody
        } );

        resBody.content.message = "Registration Sucessful";

        res.status( 200 );
        res.send( resBody );

        return;
    } );
}

function recoverPassword( req, res ) {

}

function forgotPassword( req, res ) {

    require( './requests/forgotPassword' )( req, res );
}

function verifyEmail( req, res ) {
    var verifyPipeline = new pipeline();

    verifyPipeline.pipe( database.verifyEmail );

    verifyPipeline.execute(req, function(resBody, err){

        if ( err ) {
            res.status( err.StatusCode );

            app.get( 'logger' ).debug( {
                req: req.body,
                status: err.StatusCode,
                err: err.Message
            } );

            res.send({
                content: {
                    message: err.Message
                }
            });
        }

        res.status( 200 );
        res.send( resBody );

        return;

    });
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
