/**@module request/verifyEmail */
"use strict";

var revalidator = require( "revalidator" );
var Q           = require( 'q' );
var _           = require( 'lodash' )._;
var URLModule   = require( 'url' );

var regex    = require( '../regex'    );
var error    = require( '../error'    );
var database = require( '../database' );
var util     = require( '../utilities');
var config   = require( '../config'   );
var mailer   = require( '../mailer'   );

var schema = {
    properties: {
        hash: {
            type: 'string',
            required: true,
            allowEmpty: false,
            pattern: regex.sha256,
            messages: {
                pattern: "not a valid hash"
            }
        }
    }
};

function validateVerifyEmailRequest( req ) {
    return Q.Promise( function ( resolve, reject ) {


        var validation = revalidator.validate( req.headers.bridge, schema );

        if ( validation.valid === false ) {

            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch( firstError.property ) {
                case 'hash':
                    errorCode = 'userHashInvalid';
                    break;
                default:
                    errorCode = 'malformedRequest';
                    break;
            }

            var verifyError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( verifyError );
            return;
        }

        resolve();
    } );
}

function sendWelcomeEmail( user ) {
    return Q.Promise( function( resolve, reject ) {

        var url = URLModule.format( {
            protocol: config.server.mode,
            host: config.server.hostname
        } );

        var viewName = config.mailer.welcomeViewName;

        var mail = {
            to: user.EMAIL,
            subject: config.mailer.welcomeEmailSubject
        };

        var footerImageURL     = URLModule.resolve( url, 'resources/email/peir-footer.png'    );
        var headerImageURL     = URLModule.resolve( url, 'resources/emali/peir-header.png'    );
        var backgroundImageURL = URLModule.resolve( url, 'resources/email/right-gradient.png' );

        var variables = {
            email: user.EMAIL,
            name: _.capitalize( user.FIRST_NAME + ' ' + user.LAST_NAME ),
            footerImageURL: footerImageURL,
            headerImageURL: headerImageURL,
            backgroundImageURL: backgroundImageURL
        };

        mailer.sendMail( viewName, variables, mail )
        .then( function() {
            resolve();
        } )
        .fail( function( err ) {
            reject( err );
        } );

    } );
}

function sendResponse( res ) {
    return Q.Promise( function ( resolve, reject ) {

        res.send({
            content: {
                message: "Email account verified successfully!",
                time: new Date().toISOString()
            }
        });

        res.status( 200 );

        resolve();
    } );
}

module.exports = function ( req, res, next ) {

    // Validate the request to conform with the Verify Email request
    validateVerifyEmailRequest( req )

    // Verify the email in the datebase
    .then( function () {
        return database.verifyEmail( req );
    } )

    .then( function() {
        return sendWelcomeEmail( req.bridge.user );
    } )

    // Send the successful response message
    .then( function () {
        return sendResponse( res );
    } )

    // Move onto the next middle ware
    .then( function () {
        next();
    } )

    // Catch any error that occurred on the on the above promises
    .fail( function ( err ) {
        next( err );
    } );
};
