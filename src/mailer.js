"use strict";

var fs            = require( 'fs' );
var Q             = require( 'q' );
var URLmodule     = require( 'url' );
var path          = require( 'path' );
var server        = require( '../server' );
var mkdirp        = require( 'mkdirp' );
var _             = require( 'lodash' )._;
var nodemailer    = require( 'nodemailer' );
var smtpTransport = require( 'nodemailer-smtp-transport' );

var app      = server.app;
var error    = server.error;
var config   = server.config;
var database = server.database;

var options = config.mailer.options;

var transport = nodemailer.createTransport( smtpTransport( options ) );

////////////////////////////////////////////////////
// Verify that the template directory exists

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

// End of template directory existence check
////////////////////////////////////////////////////

/**
 * Sends an email using a view and variables object to make an HTML document which is sent using
 * the mail objects properties.
 *
 * @param  {String} view      A string that is the file name of the view inside the template
 *                            directory specified in the configuration file.
 *
 * @param  {Object} mail      An object containing a to field and a subject field at its minimum.
 *                            can contain cc amoung others. They can be found at
 *                            "http://www.nodemailer.com/#e-mail-message-fields"
 *
 * @param  {Object} variables An object that contains the variables to use when templating the view
 *
 * @return {Promise}          A Q style promise object.
 */
function sendMail ( view, mail, variables ) {
    return Q.Promise( function( resolve, reject ) {

        app.log.silly('send mail request recieved. Mail:', mail);

        if ( !_.isString( view ) ) {
            reject( error.createError( 500, 'view string is not a string', "View must be a string" ) );
            return;
        }

        app.render( view, variables, function( err, html ) {

            if ( err ) {
                app.log.error( "Error occured rendering Email HTML. Error: ", err );
                reject( error.createError( 500, 'Could not render Email template', err ) );
                return;
            }

            mail.html = html;

            transport.sendMail( mail, function( err, info ) {

                if ( err ) {
                    app.log.error( "Mail failed to send. Error: ", err );
                    reject( error.createError( 500, "Could not send mail", err ) );
                    return;
                }

                app.log.info( "Info: ", info );

                resolve();

            } );

        } );
    } );
}

/**
 * Sends a email to verify a registration request.
 * *NOTE* ONLY used when email verification is turned on.
 *
 * @param  {ExpressRequest} req  Express request object that is made when a request is made to the
 *                               server.
 *
 * @return {Promise}             A Q style promise object
 */
exports.sendVerificationEmail = function( req ){
    return Q.Promise( function( resolve, reject ) {

        var user = req.bridge.user;

        app.log.debug( "Sending verification email with User: ", user );

        if ( _.isUndefined( user.email ) || _.isEmpty( user.email ) ) {
            reject( error.createError(
                500,
                'Could not read user object',
                "Email property could not be found on the user object"
            ) );
            return;
        }

        if ( config.server.emailVerification === false ) {
            app.log.verbose( "sending a verification email while the server is not in verification mode" );
        }

        var url = config.server.mode + "://" + config.server.hostname;

        url = URLmodule.parse(url).href;

        var mail = {
            to                : user.email,
            subject           : config.mailer.verificationEmailSubject
        };

        var variables = {
            verificationURL : url,
            email             : user.email,
            name              : _.capitalize( user.firstName + " " + user.lastName ),
            unsubscribeURL    : "",
            footerImageURL    : URLmodule.parse( url + "resources/email/peir-footer.png"    ).href,
            headerImageURL    : URLmodule.parse( url + "resources/email/peir-header.png"    ).href,
            backgroundImageURL: URLmodule.parse( url + "resources/email/right-gradient.png" ).href
        };

        var view = config.mailer.verificationViewName;

        app.log.debug( "Sending Verification Email" );

        sendMail( view, mail, variables )
        .then( function() {
            resolve();
        })
        .fail( function( err ) {
            database.query( "DELETE FROM users WHERE EMAIL = ?", [ user.email ] )
            .then( function() {
                reject( err );
            } )
            .fail ( function( dbErr ) {
                reject( 500, 'could not delete new user upon email failing to send', dbErr );
            } );
        } );
    } );
};

exports.sendRecoveryEmail = function( req ) {
    return Q.Promise( function( resolve, reject ) {

        var user = req.bridge.user;

        app.log.debug( "Sending forgot password email for user:" + user );

        if (_.isUndefined( user.email ) || _.isEmpty( user.email ) ) {
            reject( error.createError(
                500,
                'Could not read user object',
                "Email property could not be found on the user object"
            ) );
            return;
        }

        if ( config.server.emailVerification === false ) {
            app.log.verbose( "sending a verification email while the server is not in verification mode" );
        }

        var url = config.server.mode + "://" + config.server.hostname;

        url = URLmodule.parse(url).href;

        var mail = {
            to: user.email,
            subject: config.mailer.recoverAccountEmailSubject
        };

        var variables = {
            email             : user.email,
            name              : _.capitalize( user.firstName + " " + user.lastName ),
            footerImageURL    : URLmodule.parse( url + "resources/email/peir-footer.png"    ).href,
            headerImageURL    : URLmodule.parse( url + "resources/email/peir-header.png"    ).href,
            backgroundImageURL: URLmodule.parse( url + "resources/email/right-gradient.png" ).href
        };

        var view = config.mailer.recoverAccountViewName;

        app.log.debug( "Send forgot password recovery email" );

        sendMail( view, mail, variables )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

        resolve();
    } );
};

exports.sendUpdatedAccountEmail = function( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var user = req.bridge.user;

        resolve();
    } );
};

exports.sendWelcomeEmail = function( req ) {
    return Q.Promise( function ( resolve, reject ) {

        var user = req.bridge.user;

        resolve();
    } );
};
