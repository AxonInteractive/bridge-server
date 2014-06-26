"use strict";

var pipeline = require( '../lib/pipeline' );
var filters  = require( './filters'       );
var database = require( './database'      );
var mailer   = require( './mailer'        );
var fs       = require( 'fs'              );
var config   = app.get( 'BridgeConfig'    );

exports.setup = function () {

    app.get( '/api/1.0/login', loginHandler );

    app.put( '/api/1.0/users', registerHandler );

    //app.post( '/api/1.0/change-password', changePassword );

    app.post( '/api/1.0/users', updateUser );

    app.post( '/api/1.0/recover-password', recoverPassword );

    app.post( '/api/1.0/forgot-password', forgotPassword );

    app.post( '/api/1.0/verify-email', verifyEmail );

    app.get( '/', serveIndex );
};

function serveIndex( req, res ) {
    if ( fs.existsSync( config.server.homepage ) ) {
        res.sendfile( config.server.homepage );
        return;
    }

    res.status( 404 );
    res.send( "Could not find the homepage" );
}

function loginHandler( req, res ) {
    var loginPipeline = new pipeline();

    loginPipeline
        .pipe( filters.authenticationFilter )
        .pipe( filters.responseAddUser );

    var additionaldataFunc = app.get( 'bridge-ext' ).additionaldataFunc;

    loginPipeline.execute( req, function ( resBody, err ) {

        if ( err ) {
            res.status( err.StatusCode );
            res.send( {
                "content": {
                    "message": err.Message
                }
            } );
            return;
        }

        if ( _.isFunction( additionaldataFunc ) ) {
            resBody.content.user.additionalData = additionaldataFunc( req, resBody );
        } else {
            resBody.content.user.additionalData = {};
        }

        res.status( 200 );
        res.send( resBody );
    } );
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

        app.get( 'logger' ).verbose( {
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

    fs.readFile( config.templates.recoverPasswordTemplatePath, function(err, data){

        if ( err ) {
            app.get( 'logger' ).warn( "Error reading template file for forgot password. Error: ", err );
            res.status( 500 );
            return;
        }

        // TODO fill templates with values

        res.status( 200 );
    } );
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
