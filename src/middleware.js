/** @module middleware */
"use strict";
var revalidator = require( 'revalidator' );
var crypto      = require( 'crypto' );
var _           = require( 'lodash' )._;
var moment      = require( 'moment' );
var path        = require( 'path' );
var express     = require( 'express' );
var fs          = require( 'q-io/fs' );
var Q           = require( 'q' );
var jwt         = require( 'jwt-simple' );
var Cookies     = require( 'cookies' );

var server = require( '../server' );
var regex  = require( './regex' );

var error    = server.error;
var database = server.database;
var app      = server.app;
var config   = server.config;

exports.functions = {};

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


/**
 * Parses the bridge header object from a string to a JSON object. This return a function to
 * perform the preceding operation.
 *
 * @param  {ExpressRequest}   req  The express request object that is made when a request is made
 *                                 to the server
 *
 * @param  {ExpressResponse}  res  The express response object that is made when a request is made
 *                                 to the server
 *
 * @param  {Function}         next The callback function to call when the middleware is completed.
 *                                 If called with a parameter the variable will be an error object
 *                                 to signify that an error occurred with this middleware.
 *
 * @return {Undefined}
 */
exports.functions.parseBridgeHeader = function( req, res, next ) {
    var bridgeRequestObject;

    if ( _.isUndefined( req.headers.bridge ) ) {
        next( error.createError( 400, 'missingBridgeHeader', 'Request missing bridge header' ) );
        return;
    }

    try {
        bridgeRequestObject = JSON.parse( req.headers.bridge );
    } catch ( err ) {
        next( error.createError( 400, 'bridgeHeaderIsNotJSON', err ) );
        return;
    }

    req.headers.bridge = bridgeRequestObject;

    req.bridge = req.bridge || {};

    next();

};

/**
 * Express middleware for parsing the bridge header object as a JSON object. if the header is empty
 * for whatever reason it will be an empty json object.
 *
 * @return {Function}  An express middleware style function.
 */
exports.parseBridgeHeader = function() {
    app.log.debug( "Bridge header parser setup" );
    return exports.functions.parseBridgeHeader;
};

/**
 * Verifies that the correct objects are made and defaults them to an empty object if they are not
 * defined
 *
 * @param  {Object}    req   The express request object.
 *
 * @param  {Object}    res   The express response object.
 *
 * @param  {Function}  next  The function to call when this function is complete
 *
 * @returns {Undefined}
 */
function verifyRequestStructure( req, res, next ) {

    req.headers.bridge = req.headers.bridge || {};
    req.bridge         = req.bridge         || {};
    req.bridge.isAnon  = true;

    next();
}

/**
 * Returns the function for the verify request structure middleware.
 *
 * @return {Function} The function that has the express style signature.
 */
exports.verifyRequestStructure = function () {
    app.log.debug( "Bridge request structure middleware setup" );
    return verifyRequestStructure;
};

/**
 * Statically hosts file based on the configuration file settings.
 *
 * @return {Function} Express middleware style function.
 */
// TODO Rewirte protected files using the new token method
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
                    exports.functions.parseBridgeHeader( req, res, function ( err ) {
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
            res.status ( 500 );
            res.json({
                status: 500,
                errorCode: 'internalServerError',
                time: moment.utc().toISOString()
            });
            app.log.error( errContext.stack );
            return;
        } else {
            err = errContext;
        }

        if ( !_.isObject( errContext ) && !_.isArray( errContext ) ) {
            next( errContext );
            return;
        }

        if (_.isArray( errContext ) ) {
            res.json( errContext );
            return;
        }

        var validation = error.validateError( err );

        if ( validation.valid === false ) {
            app.log.verbose( 'Error malformed. Errors: ', validation.errors );
            app.log.verbose( "Error: ", errContext );
            res.json( errContext );
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

/**
 * The schema for validating a token object with revalidator
 * @type {Schema}
 */
var tokenSchema = {
    properties: {
        email: {
            type: 'string',
            required: true,
            allowEmpty: false
        },

        password: {
            type: 'string',
            required: true,
            allowEmpty: false
        },

        id: {
            type: 'integer',
            required: true,
            minimum: 1
        }
    }
};

/**
 * Express middleware function that is responsible for authenticating object that use the token
 * object for validation
 *
 * @param  {ExpressRequest}   req  Express js request object that is created when a request is made
 *                                 to the server
 *
 * @param  {ExpressResponse}  res  Express response object that is created when a request is made
 *                                 to the server
 *
 * @param  {Function} next         Callback function that is called when the middle ware is complete.
 *                                 If called with a parameter then that variable is an error object.
 *
 * @return {Undefined}
 */
exports.authenticateToken = function( req, res, next ) {

    var token = req.bridge.cookies.get( 'BridgeAuth' );

    if ( !token ) {
        req.bridge.isAnon = true;
        next( error.createError( 403, 'missingCookie', 'request had no authentication cookie' ) );
        return;
    }

    var authObj;

    try {
        authObj = jwt.decode( token, config.security.tokenSecret );
    } catch ( err ) {
        next( error.createError( 403, 'invalidToken', err ) );
        return;
    }

    // Make sure that the bridge object exists and is at least an empty object.
    req.bridge = req.bridge || {};

    req.bridge.isAnon = false;

    // Assign the req.bidge.auth variable to the decoded auth object.
    req.bridge.auth = authObj;

    if ( !_.isObject( authObj ) ) {
        next( error.createError( 400, 'invalidToken', "token is not an object" ) );
        return;
    }

    // validate the token.
    var tokenValidation = revalidator.validate( authObj, tokenSchema );

    if ( !tokenValidation.valid ) {
        next( error.createError( 400, 'invalidToken', "see server log for more details" ) );
        app.log.debug( "Invalid token error: ", tokenValidation.errors );
        return;
    }

    database.authenticateUser( authObj.email, authObj.password )
    .then( function( user ) {
        req.bridge.user = user;
        next();
    } )
    .fail( function( err ) {
        next( err );
    } );
};

/**
 * Gets the cookies from the request by using the expressjs cookies module. Examples of this module
 * can be seen at: https://github.com/expressjs/cookies
 *
 * @return {ExpressMiddleware} An express middleware function.
 */
exports.getCookies = function() {
    app.log.debug( "Bridge cookie parser setup!" );
    return function( req, res, next ) {
        req.bridge = req.bridge || {};
        req.bridge.cookies = new Cookies( req, res );
        next();
    };
};
