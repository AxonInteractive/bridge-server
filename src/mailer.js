"use strict";

var fs  = require('fs');
var Q   = require('q');
var URL = require('url');
var _ = require('underscore')._;

var app = require('../server').app;

var config = require( '../server'      ).config;
var error  = require( './error'        );
var mailer = require( 'express-mailer' );

var options = config.mailer.options;

var mailerOptionsObject = {
    from: config.mailer.fromAddress
};

mailer.extend(app, options);

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

        url = URL.parse(url).href;

        var mail = {
            to                : user.email,
            subject           : config.mailer.verificationEmailSubject,
            verificationURL   : url,
            email             : user.email,
            name              : user.firstName + " " + user.lastName,
            unsubscribeURL    : "",
            footerImageURL    : URL.parse( url + "email/peir-footer.png"    ).href,
            headerImageURL    : URL.parse( url + "email/peir-header.png"    ).href,
            backgroundImageURL: URL.parse( url + "email/right-gradient.png" ).href
        };

        var view = config.mailer.verifyEmailViewName;

        app.log.debug( "Sending Verification Email" );

        sendMail( mail, view );

        resolve();
    });
};

exports.sendForgotPasswordEMail = function( req ) {
    return Q.Promise( function( resolve, reject ) {
        resolve();
    } );
};

exports.sendUpdatedAccountEmail = function( req ) {
    return Q.Promise( function ( resolve, reject ) {
        resolve();
    } );
};
