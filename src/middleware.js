"use strict";
var revalidator = require( 'revalidator' );
var crypto      = require( 'crypto' );
var _           = require( 'lodash' )._;
var moment      = require( 'moment' );
var path        = require( 'path' );
var express     = require( 'express' );
var fs          = require( 'q-io/fs' );
var Q           = require( 'q' );

var server = require( '../server' );
var regex  = require( './regex' );

var error    = server.error;
var database = server.database;
var app      = server.app;
var config   = server.config;

/**
 * Add the nessesary CORS headers to the response object.
 * @param {Object}   req  The express request object.
 * @param {Object}   res  The express response object.
 * @param {Function} next The function to call when this function is complete.
 */
exports.attachCORSHeaders = function () {
    app.log.debug( "CORS header middleware setup" );
    return function ( req, res, next ) {
        res.setHeader( 'Access-Control-Allow-Origin', req.headers.origin || '*' );
        next();
    };
};

/**
 * Handle CORS request. this is due to the proxy setup for the case of PEIR.
 * @param  {Object}    req The express request object.
 * @param  {Object}    res The express response object.
 * @return {Function}
 */
exports.handleOptionsRequest = function () {
    app.log.debug( "Options request handler setup" );
    return function ( req, res, next ) {

        if ( req.method !== 'OPTIONS' ) {
            next();
            return;
        }

        res.status( 204 );

        res.setHeader( 'access-control-allow-methods', 'GET, PUT, OPTIONS, POST, DELETE' );
        res.setHeader( 'access-control-allow-headers', "content-type, accept, bridge" );

        res.setHeader( 'access-control-max-age', 10 );
        res.setHeader( 'content-length', 0 );

        res.send();
    };
};

function parseBridgeHeader( req, res, next ) {
    var bridgeRequestObject;

    if ( _.isUndefined( req.headers.bridge ) ) {
        next( error.createError( 400, 'missingBridgeHeader', 'Request missing bridge header' ) );
        return;
    }

    try {
        bridgeRequestObject = JSON.parse( req.headers.bridge );
    } catch ( err ) {
        next( error.createError( 400, 'appDataIsNotJSON', err ) );
        return;
    }

    req.headers.bridge = bridgeRequestObject;

    req.bridge = {};

    next();
}

exports.parseBridgeHeader = function() {
    app.log.debug( "Bridge header parser setup" );
    return parseBridgeHeader;
};
function checkHmacSignature( req, hmacSalt ) {

    var concat = JSON.stringify( req.headers.bridge.content ) + req.headers.bridge.email + req.headers.bridge.time;

    var hmac = crypto.createHmac( 'sha256', hmacSalt ).update( concat ).digest( 'hex' );

    return ( req.headers.bridge.hmac === hmac );
}

/**
 * The bridge request object schema. The definition of a bridge request
 * @type {Object}
 */
var bridgeRequestSchema = {
    properties: {
        content: {
            description: "The content of the bridge request",
            type: 'object',
            required: false
        },

        email: {
            description: "The email that the request was sent from. can be empty",
            type: 'string',
            pattern: regex.optionalEmail,
            required: true,
            allowEmpty: true,
            messages: {
                pattern: "not a valid email"
            }
        },

        time: {
            description: "The time the request was sent from",
            type: 'string',
            required: true,
            allowEmpty: false,
            pattern: regex.ISOTime,
            messages: {
                pattern: "does not conform to the ISO format"
            }
        },

        hmac: {
            description: "the hmac signature of a bridge request",
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

/**
 * Verify that the request has the necessary structure and content to be handled by the bridge
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The function to call when this function is complete
 */
function verifyRequestStructure( req, res, next ) {

    if ( !_.isObject( req.headers.bridge ) ) {
        next( error.createError( 500, 'internalServerError', 'request header bridge is not an object' ) );
        return;
    }

    var validation = revalidator.validate( req.headers.bridge, bridgeRequestSchema );
    var vrsError;

    if ( !validation.valid ) {
        var firstError = validation.errors[ 0 ];

        var errorCode;

        if ( firstError.property === 'email' ) {
            errorCode = 'emailInvalid';
        } else if ( firstError.property === 'time' ) {
            errorCode = 'timeInvalid';
        } else if ( firstError.property === 'HMAC' ) {
            errorCode = 'hmacInvalid';
        } else {
            errorCode = 'malformedBridgeHeader';
        }

        vrsError = error.createError( 400, errorCode, "Property " + firstError.property + " - " + firstError.message + "\n" + "Error Obj: " + JSON.stringify( validation.errors ) );

        next( vrsError );
        return;
    }

    req.bridge.isAnon = ( req.headers.bridge.email === "" );

    var hmacSalt;

    if ( req.bridge.isAnon ) {
        hmacSalt = "";

        if ( !checkHmacSignature( req, hmacSalt ) ) {
            vrsError = error.createError( 400, 'hmacMismatch', 'HMAC check failed for anonymous request.' );
            next( vrsError );
            return;
        }

        req.bridge.structureVerified = true;
        next();
        return;
    } else {

        database.authenticateRequest( req )
        .then( function () {
            hmacSalt = req.bridge.user.PASSWORD;

            if ( !checkHmacSignature( req, hmacSalt ) ) {
                vrsError = error.createError( 400, 'hmacMismatch', 'HMAC check failed for authenticated request.' );
                next( vrsError );
                return;
            }

            req.bridge.structureVerified = true;
            next();
        } )
        .fail( function ( err ) {
            next( err );

        } );
    }
}

exports.verifyRequestStructure = function () {
    app.log.debug( "Bridge request structure middleware setup" );
    return verifyRequestStructure;
};

/**
 * Statically hosts file based on the configuration file settings.
 * @return {Function} Express middleware style function.
 */
exports.staticHostFiles = function () {
    app.log.debug( "Static file hosting setup!" );
    var staticHost = express.static( path.resolve( config.server.wwwRoot ) );

    return function ( req, res, next ) {

        var protectedObject;

        //  Determine if the request is a protected. if so get the protected object related to it
        Q.fcall( function() {

            // if there is no protected Resources array just act like normal
            if ( !_.has( config.server, 'protectedResources' ) ) {
                staticHost( req, res, next );
                return;
            }

            // Find if the req is asking for a path that is protected
            _( config.server.protectedResources ).forEach( function ( element, index ) {
                if ( req.path.indexOf( element.path ) > -1 ) {
                    protectedObject = element;
                    return false;
                }
            } );

            // if the path was not found under the list of protected routes statically host like normal
            if ( !protectedObject ) {
                staticHost( req, res, next );
                return;
            }

            Q.fcall( function() {
                return Q.Promise( function( resolve, reject ) {
                    parseBridgeHeader( req, res, function ( err ) {
                        if ( err ) {
                            reject( err );
                            return;
                        }

                        resolve();
                    } );
                } );
            } )
            .then( function() {
                return Q.Promise( function( resolve, reject ) {
                    verifyRequestStructure( req, res, function( err ) {
                        if ( err ) {
                            reject( err );
                            return;
                        }

                        resolve();
                    } );
                } );
            } )
            .then( function() {
                // If the request was anonymous then they cannot access content
                if ( req.bridge.isAnon ) {
                    throw error.createError( 403, 'protectedMustBeLoggedIn', "Cannot access protected content" );
                }

                // Check to see if the user role is in the protectedObjects list of acceptable roles
                var found = _.find( protectedObject.roles, function ( element ) {
                    if ( element === req.bridge.user.ROLE ) {
                        return element;
                    }
                } );

                // If the role was not found send a 401 Unauthorized error
                if ( !found ) {
                    throw error.createError( 401, 'protectedAuthFailed', "User role is not on the list of acceptable roles for this resource" );
                }

                // If the user checks ouw as privileged to receive this content send the content.
                staticHost( req, res, next );
                return;
            } )
            .fail( function( err ) {
                next( err );
            } );
        } )
        .fail( function( err ) {
            next( err );
        } );
    };
};

exports.bridgeErrorHandler = function () {

    app.log.debug( 'Bridge error handler setup' );

    return function ( errContext, req, res, next ) {

        var err;

        if ( _.isArray( errContext ) ) {
            err = errContext[ 0 ];
        }
        else if( errContext instanceof( Error ) ) {
            res.json({
                status: 500,
                errorCode: 'fatal error',
                time: moment.utc().toISOString()
            });
        } else {
            err = errContext;
        }

        var validation = error.validateError( err );

        if ( validation.valid === false ) {
            app.log.verbose( 'Error malformed. Errors: ', validation.errors );
            app.log.verbose( "Error: ", errContext );
            next( errContext );
            return;
        }

        app.log.silly( 'Bridge Error verified' );
        var config = require( '../server' ).config;

        err.time = moment.utc().toISOString();

        res.status( err.status );

        app.log.verbose( 'Sending Error', err );

        // if ( config.server.environment === 'development' ) {
        res.json( {
            content: err
        } );
        // } else {
        //     res.json( {
        //         content: {
        //             status: err.status,
        //             errorCode: err.errorCode,
        //             time: err.time
        //         }
        //     } );
        // }

        //next( errContext );
    };
};
