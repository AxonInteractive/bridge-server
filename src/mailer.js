'use strict';

var fs            = require( 'fs' );
var Q             = require( 'q' );
var qfs           = require( 'q-io/fs' );
var path          = require( 'path' );
var server        = require( '../server' );
var mkdirp        = require( 'mkdirp' );
var _             = require( 'lodash' )._;
var nodemailer    = require( 'nodemailer' );
var smtpTransport = require( 'nodemailer-smtp-transport' );

var app      = server.app;
var error    = server.error;
var config   = server.config;

var options = config.mailer.options;

var transport = nodemailer.createTransport( smtpTransport( options ) );

////////////////////////////////////////////////////
// Verify that the template directory exists

config.mailer.templateDirectory = path.normalize( config.mailer.templateDirectory );

var dir;

if ( config.mailer.templateDirectory[ 0 ] === '/' ) {
    dir = path.resolve( config.mailer.templateDirectory );
} else {
    dir = path.resolve( path.join( path.dirname( require.main.filename ), config.mailer.templateDirectory ) );
}
app.log.verbose( 'Verifying that mailer template directory exists...' );
app.log.debug( dir );

if ( !fs.existsSync( dir ) ) {
    app.log.warn( 'Email template directory \'' + dir +'\' doesn\'t exist. Attempting to make directory' );
    mkdirp( dir, function( err ) {
        if ( err ) {
            app.log.error( 'Error making directory \'' + dir + '\', Reason: ' + err );
            return;
        }

        app.log.info( 'Template directory created successfully' );
    } );
} else {
    app.log.verbose( 'Template directory found.' );
}

app.log.debug( 'Template Path: ' + path.resolve( dir ) );

// End of template directory existence check
////////////////////////////////////////////////////

/**
 * Sends an email using a view and variables object to make an HTML document which is sent using
 * the mail objects properties.
 *
 * @param  {String} viewName  A string that is the file name of the view inside the template
 *                            directory specified in the configuration file.
 *
 * @param  {Object} variables An object that contains the variables to use when templating the view
 *
 * @param  {Object} mail      An object containing a to field and a subject field at its minimum.
 *                            can contain cc amoung others. They can be found at
 *                            "http://www.nodemailer.com/#e-mail-message-fields"
 *
 * @return {Promise}          A Q style promise object.
 */
exports.sendMail = function( viewName, variables, mail, user ) {
    return Q.Promise( function( resolve, reject ) {

        app.log.silly('send mail request recieved. Mail:', mail);

        if ( !_.isString( viewName ) ) {
            reject( error.createError( 500, 'internalServerError', 'viewName must be a string' ) );
            return;
        }

        qfs.exists( path.join( config.mailer.templateDirectory, viewName ) )
        .then( function( exists ) {
            if ( !exists ) {
                throw new Error( 'View doesn\'t exist' );
            }
        } )
        .then( function() {
            return Q.Promise( function( resolve, reject ) {
                variables.siteURL = app.get( 'rootURL' );
                variables.supportEmail = config.server.supportEmail;
                variables.user = _.transform( user, function( result, value, key ) {
                  key = key.toLowerCase();
                  var arr = key.split('_');
                  for ( var i = 1; i < arr.length; i += 1 ) {
                    arr[ i ] = arr[ i ].charAt(0).toUpperCase() + arr[ i ].slice(1);
                  }
                  key = arr.join('');
                  result[ key ] = value;
                } );

                var clientFunc = app.get( 'emailVariables' );
                var clientVars = {};

                if ( _.isFunction( clientFunc ) ) {
                    clientVars = clientFunc( user );
                }

                _.extend( variables, clientVars );

                app.log.debug( 'Rendering Email...' );
                app.log.debug( 'Variables: ', variables );
                app.render( viewName, variables, function( err, html ) {
                    if ( err ) {
                        app.log.error( 'Error occured rendering Email HTML. Error: ', err );
                        reject( error.createError( 500, 'internalServerError', err ) );
                        return;
                    }

                    mail.html = html;
                    resolve();
                } );
            } );
        } )
        .then( function() {
            return Q.Promise( function( resolve, reject ) {
                app.log.debug( 'Sending mail...' );
                mail.from = config.mailer.fromAddress;
                transport.sendMail( mail, function( err, info ) {
                    if ( err ) {
                        app.log.error( 'Mail failed to send. Error: ', err );
                        reject( error.createError( 500, 'internalServerError', err ) );
                        return;
                    }

                    app.log.debug( 'Sent mail info: ', info );
                    resolve();
                } );
            } );
        } )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

    } );
};
