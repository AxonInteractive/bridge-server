"use strict";

var fs        = require( 'fs' );
var Q         = require( 'q' );
var URLmodule = require( 'url' );
var path      = require( 'path' );
var mailer    = require( 'express-mailer' );
var server    = require( '../server' );
var mkdirp    = require( 'mkdirp' );

var app    = server.app;
var error  = server.error;
var config = server.config;

var options = config.mailer.options;

var _ = require( 'lodash' )._;

var mailerOptionsObject = {
    from: config.mailer.fromAddress
};

mailer.extend(app, options);

config.mailer.templateDirectory = path.normalize( config.mailer.templateDirectory );

var dir = path.resolve( config.mailer.templateDirectory );

app.log.verbose( "Verifying that mailer template directory exists..." );
app.log.debug( dir );

if ( !fs.existsSync( config.mailer.templateDirectory ) ) {
    app.log.warn("PDF directory '" + dir +"' doesn't exist. Attempting to make directory" );
    mkdirp( dir, function( err ) {
        if ( err ) {
            app.log.error( "Error making directory '" + dir + "', Reason: " + err );
            return;
        }

        app.log.info( "Template directory created successfully" );
    } );
} else {
    app.log.verbose( "Template directory found." );
}

app.log.debug( "Template Path: " + path.resolve( dir ) );


/**
 * Send an email over the setup transport
 * @param  {Object}  mail The email object to send.
 * @return {Boolean} True if mail passed standard checks, False if not.
 */
function sendMail ( mail, view, options, done ) {

    app.log.silly('send mail request recieved. Mail:', mail);

    var baseErrorString  = "Could not end e-mail. ";
    var existErrorString = "Mail has no '%s' property";
    var typeErrorString  = "Mail property '%s' is not a %s";

    if ( !_.has( mail, "to" ) ) {
        app.log.verbose( baseErrorString + existErrorString, "to", mail );
        return false;
    }

    if ( !_.has( mail, "subject" ) ) {
        app.log.verbose( baseErrorString + existErrorString, "subject", mail );
        return false;
    }

    if ( !_.isString( mail.to ) ) {
        app.log.verbose( baseErrorString + typeErrorString, "to", "string", mail );
        return false;
    }

    if ( !_.isString( mail.subject ) ) {
        app.log.verbose( baseErrorString + typeErrorString, "subject", "string", mail );
        return false;
    }

    if ( !_.isString( view ) ) {
        app.log.verbose( baseErrorString + typeErrorString, "view", "string", view, mail );
        return false;
    }

    app.log.silly( "Mail passed structure test. Attempting to send mail.");

    app.mailer.send(view, mail, function(err){
        if (err) {
            app.log.verbose("An error occurred sending an e-mail. Error: " + err);
            return;
        }

        if (_.isFunction(done)) {
            done();
        }
    });

    return true;
}

/**
 * Sends a email to verify a registration request.
 * *NOTE* ONLY used when email verification is turned on.
 * @param  {Object} user This is a user object
 * @return {Undefined}
 */
exports.sendVerificationEmail = function( req ){
    return Q.Promise(function(reject, resolve){

        var user = req.bridge.user;

        app.log.debug( "Sending verification email with User: ", user );

        if ( config.server.emailVerification === false ) {
            app.log.verbose( "Tried to send verification email while the server is not in verification mode" );
        }

        var url = config.server.mode + "://" + config.server.hostname;

        url = URLmodule.parse(url).href;

        var mail = {
            to                : user.email,
            subject           : config.mailer.verificationEmailSubject,
            verificationURL   : url,
            email             : user.email,
            name              : user.firstName + " " + user.lastName,
            unsubscribeURL    : "",
            footerImageURL    : URLmodule.parse( url + "email/peir-footer.png"    ).href,
            headerImageURL    : URLmodule.parse( url + "email/peir-header.png"    ).href,
            backgroundImageURL: URLmodule.parse( url + "email/right-gradient.png" ).href
        };

        var view = config.mailer.verifyEmailViewName;

        app.log.debug( "Sending Verification Email" );

        sendMail( mail, view );

        resolve();
    });
};

exports.sendForgotPasswordEMail = function( req ) {
    return Q.Promise( function( resolve, reject ) {

        var user = req.bridge.user;

        app.log.debug( "Sending forgot password email for user:" + user );

        var mail = {
            to: user.email,
            subject: config.mailer.recoveryEmailSubject
        };

        var view = config.mailer.recoverPasswordViewName;

        app.log.debug( "Send forgot password recovery email" );

        sendMail( mail, view );

        resolve();
    } );
};

exports.sendUpdatedAccountEmail = function( req ) {
    return Q.Promise( function ( resolve, reject ) {
        resolve();
    } );
};
