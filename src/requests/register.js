"use strict";

var revalidator = require( 'revalidator' );
var Q           = require( 'q' );

var regex    = require( '../regex' );
var error    = require( '../error' );
var database = require( '../database' );
var mailer   = require( '../mailer' );
var util     = require( '../utilities');
module.exports = function ( req, res, next ) {

    util.checkRequestStructureVerified( { req: req, res: res } )
        .then( util.mustBeAnonymous )
        .then( validateRegisterRequest )
        .then( addUserObjectToBridge )
        .then( database.registerUser )
        .then( sendVerificationEmail )
        .then( sendReponse )
        .then( function () {
            next();
        } )
        .fail( function ( err ) {
            next( err );
        } );
};

var schema = {
    properties: {
        content: {
            type: 'object',
            required: true,
            description: "The content of the registration request",
            properties: {
                email: {
                    type: 'string',
                    format: 'email',
                    required: true
                },

                firstName: {
                    type: 'string',
                    allowEmpty: false,
                    required: true
                },

                lastName: {
                    type: 'string',
                    allowEmpty: false,
                    required: true
                },

                password: {
                    type: 'string',
                    pattern: regex.sha256,
                    required: true,
                    messages: {
                        pattern: "not a valid hash"
                    }
                },

                appData: {
                    type: 'object',
                    required: false,
                    description: "The user added data to go into the database along with the user"
                },

                regcode: {
                    type: 'string',
                    required: false
                }
            },
        },

        email: {
            type: 'string',
            description: "The email of the request, used for identification",
            required: true,
            allowEmpty: true,
            pattern: regex.optionalEmail,
            messages: {
                pattern: "not a valid email"
            }
        },

        time: {
            description: "The time the request was made",
            type: 'string',
            pattern: regex.iSOTime,
            allowEmpty: false,
            required: true,
            messages: {
                pattern: "not a valid ISO date"
            }
        },

        hmac: {
            description: "The HMAC of the request to be signed by the bridge client, in hex format",
            type: 'string',
            pattern: regex.sha256,
            allowEmpty: false,
            required: true,
            messages: {
                pattern: "not a valid hash"
            }
        }
    }
};

function validateRegisterRequest( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        var validation = revalidator.validate( req.body, schema );

        if ( validation.valid === false ) {
            var firstError = validation.errors[ 0 ];

            var errorCode;

            switch ( firstError.property ) {
                case 'content.email':     errorCode = 'Invalid email format';       break;
                case 'content.password':  errorCode = 'Invalid password format';    break;
                case 'content.firstName': errorCode = 'Invalid first name format';  break;
                case 'content.lastName':  errorCode = 'Invalid last name format';   break;
                case 'email':             errorCode = 'Invalid email format';       break;
                case 'hmac':              errorCode = 'Invalid HMAC format';        break;
                case 'time':              errorCode = 'Invalid time format';        break;
                default:                  errorCode = 'Malformed register request'; break;
            }

            var regError = error.createError( 400, errorCode, firstError.property + " : " + firstError.message );

            reject( regError );
            return;
        }

        resolve( message );

    } );
}

function addUserObjectToBridge( message ) {
    return Q.Promise( function ( resolve, reject ) {

        var req = message.req;

        req.bridge.user = req.body.content;

        resolve( message );

    } );
}

function sendVerificationEmail( message ) {
    return Q.Promise( function ( resolve, reject ) {
        if ( app.get( 'BridgeConfig' ).server.emailVerification === true ) {
            mailer.sendVerificationEmail( message.req )
                .then( function () {
                    resolve( message );
                } );
        }
        else {
            resolve( message );
        }
    } );
}

function sendReponse( message ) {
    return Q.Promise( function( resolve, reject ) {
        var res = message.res;

        res.send({
            content: {
                message: "User registered successfully!",
                time: new Date().toISOString()
            }
        });

        res.status(200);

        resolve( message );
    } );
}
