"use strict";

var config     = app.get( 'BridgeConfig' );
var nodemailer = require( 'nodemailer' );
var error      = require( './error' );

var transport = null;
var logger    = app.get( 'logger' );

var method = config.mailer.method;
var options = config.mailer.options;

if ( !_.isString( method ) ) {
    logger.error( "Could not make E-mail Transport. Method is not a string" );
}

if ( !_.isObject( options ) ) {
    logger.error( "Could not make E-MailTransport. Options is not an object" );
}

transport = nodemailer.createTransport( method, options );


/**
 * Send an email over the setup transport
 * @param  {Object}  mail The email object to send.
 * @return {Boolean} True if mail passed standard checks, False if not.
 */
exports.sendMail = function ( mail ) {

    if ( transport == null ) {
        logger.error( "Tried to send mail without a transport. Please call startup to create a transport" );
        return false;
    }

    var baseErrorString = "Could not end e-mail. ";
    var existErrorString = "Mail has no '%s' property";
    var typeErrorString = "Mail property '%s' is not a %s";

    if ( !_.has( mail, "from" ) ) {
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

    transport.sendMail( mail, function ( error, response ) {

        if ( error ) {

            logger.error( "An error occurred sending an e-mail. Error: " + JSON.stringify( error ), mail);
            return;
        }
        
        logger.verbose("Mail sent successfully.", mail);
        return;

    } );

    return true;

};

exports.close = function(){
    transport.close();
    transport = null;
};