"use strict";

var fs = require('fs');

var config     = app.get( 'BridgeConfig' );
var nodemailer = require( 'nodemailer'   );
var error      = require( './error'      );

var transport = null                 ;
var logger    = app.get( 'logger' )  ;
var method    = config.mailer.method ;
var options   = config.mailer.options;

var templates = {
    verifyEmail     : null,
    recoverPassword : null
};

if ( !_.isString( method ) ) {
    logger.error( "Could not make E-mail Transport. Method is not a string" );
}
else
{
    logger.debug( "successfully made mailer transport using %s with " );
    transport = nodemailer.createTransport( method, options );
}

fs.readFile( config.mailer.verifyEmailTemplatePath, { encoding: 'utf8' }, function ( error, data ) {

    if ( error ) {
        logger.error( "Could not read template file for Email verification. Error: ", error );
        return;
    }

    logger.debug( "Verify Email HTML template loaded successfully! HTML: %s", data );
    templates.verifyEmail = data;

} );

fs.readFile( config.mailer.recoverPasswordTemplatePath, { encoding: 'utf8' }, function( error, data ) {
    if ( error ) {
        logger.error( "Could not read template file for Recover Password. Error: ", error );
        return;
    }

    logger.debug( "Password Recovery Email HTML template loaded successfully! HTML: %s ", data );
    templates.recoverPassword = data;
} );

function makeTransport()
{
    transport = nodemailer.createTransport( method, options );
}

function deleteTransport()
{
    transport.close();
    transport = null;
}

/**
 * Send an email over the setup transport
 * @param  {Object}  mail The email object to send.
 * @return {Boolean} True if mail passed standard checks, False if not.
 */
function sendMail ( mail, done ) {

    logger.silly('send mail request recieved. Mail:', mail);
    if ( transport == null ) {
        logger.error( "Tried to send mail without a transport. Please call startup to create a transport" );
        return false;
    }

    var baseErrorString = "Could not end e-mail. ";
    var existErrorString = "Mail has no '%s' property";
    var typeErrorString = "Mail property '%s' is not a %s";

    if ( !_.has( mail, 'from' ) ) {
        logger.error( baseErrorString + existErrorString, "from", mail );
        return false;
    }

    if ( !_.has( mail, "to" ) ) {
        logger.error( baseErrorString + existErrorString, "to", mail );
        return false;
    }

    if ( !_.has( mail, "subject" ) ) {
        logger.error( baseErrorString + existErrorString, "subject", mail );
        return false;
    }

    if ( !_.isString( mail.from ) ) {
        logger.error( baseErrorString + typeErrorString, "from", "string", mail );
        return false;
    }

    if ( !_.isString( mail.to ) ) {
        logger.error( baseErrorString + typeErrorString, "to", "string", mail );
        return false;
    }

    if ( !_.isString( mail.subject ) ) {
        logger.error( baseErrorString + typeErrorString, "subject", "string", mail );
        return false;
    }

    logger.silly( "Mail passed structure test. Attempting to send mail. Mail", mail );

    transport.sendMail( mail, function ( error, response ) {

        if ( error ) {

            logger.error( "An error occurred sending an e-mail. Error: " + JSON.stringify( error ), mail );
            return;
        }

        logger.debug( "Mail sent successfully.", mail );
        deleteTransport();
        makeTransport();
        done();
        return;



    } );

    return true;
}

/**
 * Sends a email to verify a registration request. 
 * *NOTE* ONLY used when email verification is turned on.
 * @param  {Object} user This is a user object
 * @return {Undefined}
 */
exports.sendVerificationEmail = function(user){

    logger.debug( "Sending verification email with User: ", user );

    if ( config.server.emailVerification === false ) {
        logger.warn( "" );
    }

    var mail = {
        to: user.Email,
        subject: config.mailer.verificationEmailSubject,
        from: config.mailer.fromAddress,
        html: templates.verifyEmail
    };

    logger.debug( "Sending Verification Email with Mail Object: ", mail );
    sendMail( mail );
};

/**
 * closes the email transport and sets it to null.
 * @return {Undefined}
 */
exports.close = function(){
    deleteTransport();
};

exports.sendMail = sendMail;
