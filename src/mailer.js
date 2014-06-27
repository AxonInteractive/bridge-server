"use strict";

var fs = require('fs');

var config     = app.get( 'BridgeConfig'   );
var error      = require( './error'        );
var mailer     = require( 'express-mailer' );

var logger    = app.get( 'logger' )  ;
var options   = config.mailer.options;

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

    logger.silly('send mail request recieved. Mail:', mail);

    var baseErrorString = "Could not end e-mail. ";
    var existErrorString = "Mail has no '%s' property";
    var typeErrorString = "Mail property '%s' is not a %s";

    if ( !_.has( mail, "to" ) ) {
        logger.verbose( baseErrorString + existErrorString, "to", mail );
        return false;
    }

    if ( !_.has( mail, "subject" ) ) {
        logger.verbose( baseErrorString + existErrorString, "subject", mail );
        return false;
    }

    if ( !_.isString( mail.to ) ) {
        logger.verbose( baseErrorString + typeErrorString, "to", "string", mail );
        return false;
    }

    if ( !_.isString( mail.subject ) ) {
        logger.verbose( baseErrorString + typeErrorString, "subject", "string", mail );
        return false;
    }

    if ( !_.isString( view ) ) {
        logger.verbose( baseErrorString + typeErrorString, "view", "string", view, mail );
        return false;
    }

    logger.silly( "Mail passed structure test. Attempting to send mail.");

    app.mailer.send(view, mail, function(err){
        if (err) {
            logger.verbose("An error occurred sending an e-mail. Error: " + JSON.stringify(err));
            console.log("ERROR IN DAS MAILER");
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

    var user = req.bridge.user;

    logger.debug( "Sending verification email with User: ", user );

    if ( config.server.emailVerification === false ) {
        logger.warn( "Tried to send verification email while the server is not in verification mode" );
    }

    var mail = {
        to: user.Email,
        subject: config.mailer.verificationEmailSubject,
    };

    var view = config.mailer.verifyEmailViewName;

    var options = {};

    logger.debug( "Sending Verification Email" );

    sendMail( mail, view );
};

exports.sendForgotPasswordEmail = function( email ){

};

