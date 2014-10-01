/** @module middleware */
"use strict";
var revalidator = require( 'revalidator' );
var crypto = require( 'crypto' );
var _ = require( 'lodash' )._;
var moment = require( 'moment' );
var path = require( 'path' );
var express = require( 'express' );
var fs = require( 'q-io/fs' );
var Q = require( 'q' );
var jwt = require( 'jwt-simple' );
var Cookies = require( 'cookies' );

var server = require( '../server' );
var regex = require( './regex' );

var error = server.error;
var database = server.database;
var app = server.app;
var config = server.config;

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
 * Apply the global default CSP header to the response for the inbound request. This is an express
 * middle ware object and doesn't require any other middle ware be run before it.
 *
 * @param  {ExpressRequest}   req   The express request object which is made when a request is made
 *                                  to the sever.
 *
 * @param  {ExoressResponse}   res  The express response object which is made when a request is made
 *                                  to the server.
 *
 * @param  {Function} next          The callback function that is called when the middleware has
 *                                  completed. If called with its first parameter the middleware has
 *                                  errored and should be handled as such. That parameter will be
 *                                  the error object relating to the particular error that has occured.
 *
 * @return {Function}               Express middleware function which the correct signature.
 */
exports.applyDefaultSecuityPolicyHeader = function( req, res, next ) {
    var policyString = "default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'self'; style-src 'self' " +
        "'unsafe-inline' https://fonts.googleapis.com; img-src 'self'; media-src 'self'; frame-src " +
        "'none'; font-src 'self' https://fonts.gstatic.com; connect-src 'self'";

    res.set('Content-Security-Policy',   policyString );
    res.set('X-Content-Security-Policy', policyString );
    next();
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

        res.setHeader( 'access-control-allow-methods',
            'GET, PUT, OPTIONS, POST, DELETE' );
        res.setHeader( 'access-control-allow-headers',
            "content-type, accept, bridge" );

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
exports.functions.parseBridgeHeader = function ( req, res, next ) {
    var bridgeRequestObject;

    if ( _.isUndefined( req.headers.bridge ) ) {
        next( error.createError( 400, 'missingBridgeHeader',
            'Request missing bridge header' ) );
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
exports.parseBridgeHeader = function () {
    app.log.debug( "Bridge header parser setup" );
    return exports.functions.parseBridgeHeader;
};

/**
 * Statically hosts file based on the configuration file settings.
 *
 * @return {Function} Express middleware style function.
 */
exports.staticHostFiles = function () {
    app.log.debug( "Static file hosting setup!" );

    var dir;

    if ( config.server.wwwRoot[ 0 ] === '/' ) {
        dir = path.resolve( config.server.wwwRoot );
    } else {
        dir = path.resolve( path.join( path.dirname( require.main.filename ), config.server.wwwRoot ) );
    }

    var staticHost = express.static( dir );

    return function ( req, res, next ) {

        var protectedObject;

        //  Determine if the request is a protected. if so get the protected object related to it

        // if there is no protected Resources array just act like normal
        if ( !_.has( config.server, 'protectedResources' ) ) {
            staticHost( req, res, next );
            return;
        }

        // Find if the req is asking for a path that is protected
        _( config.server.protectedResources ).forEach( function (
            element, index ) {
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

        req.bridge = req.bridge || {};
        req.bridge.cookies = new Cookies( req, res );

        Q.fcall( function () {
            return Q.Promise( function ( resolve, reject ) {
                exports.authenticateToken( req, res,
                    function ( err ) {
                        if ( err ) {
                            reject( err );
                            return;
                        }

                        resolve();
                    } );
            } );
        } )
            .then( function () {

                // Check to see if the user role is in the protectedObjects list of acceptable roles
                var found = _.find( protectedObject.roles,
                    function ( element ) {
                        if ( element === req.bridge.user.ROLE ) {
                            return element;
                        }
                    } );

                // If the role was not found send a 401 Unauthorized error
                if ( !found ) {
                    throw error.createError( 401,
                        'protectedAuthFailed',
                        "User role is not on the list of acceptable roles for this resource"
                    );
                }

                // If the user checks ouw as privileged to receive this content send the content.
                staticHost( req, res, next );
                return;
            } )
            .fail( function ( err ) {
                next( err );
            } );
    };
};

/**
 * Bridge handler for errors. this is a catch all error style middleware for an express style
 * application.
 *
 * @method bridgeErrorHandler
 *
 * @return {Function}           The express middleware function to go into the application object
 *                                  using app.use
 */
exports.bridgeErrorHandler = function () {

    app.log.debug( 'Bridge error handler setup' );

    return function ( errContext, req, res, next ) {

        var err;

        if ( _.isArray( errContext ) ) {
            err = errContext[ 0 ];
        } else if ( errContext instanceof( Error ) ) {
            res.status( 500 );
            res.json( {
                status: 500,
                errorCode: 'internalServerError',
                time: moment.utc().toISOString()
            } );
            app.log.error( errContext.stack );
            return;
        } else {
            err = errContext;
        }

        if ( !_.isObject( errContext ) && !_.isArray( errContext ) ) {
            next( errContext );
            return;
        }

        if ( _.isArray( errContext ) ) {
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
exports.authenticateToken = function ( req, res, next ) {

    var token = req.bridge.cookies.get( 'BridgeAuth' );

    if ( !token ) {
        next( error.createError( 403, 'missingCookie',
            'request had no authentication cookie' ) );
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
        .then( function ( user ) {
            req.bridge.user = user;
            next();
        } )
        .fail( function ( err ) {
            next( err );
        } );
};

/**
 * Gets the cookies from the request by using the expressjs cookies module. Examples of this module
 * can be seen at: https://github.com/expressjs/cookies
 *
 * @return {ExpressMiddleware} An express middleware function.
 */
exports.getCookies = function () {
    app.log.debug( "Bridge cookie parser setup!" );
    return function ( req, res, next ) {
        req.bridge = req.bridge || {};
        req.bridge.cookies = new Cookies( req, res );
        next();
    };
};

/**
 * Preps the bridge object that will be used throughout the rest of the bridge application for
 * various purposes.
 *
 * @param  {ExpressRequest}   req   The request object that is made when a request is made to the
 *                                  server.
 *
 * @param  {ExpressResponse}  res   The response object that is made when a request is made to the
 *                                  server.
 *
 * @param  {Function}         next  The callback function that is called when this middleware
 *                                  function is complete. If called with a parameter then an error
 *                                  occurred and is described by that parameter.
 *
 *
 * @return {Undefined}
 */
exports.prepBridgeObjects = function( req, res, next ) {

    req.headers.bridge = req.headers.bridge || {};
    req.bridge = req.bridge || {};

    var user = {};

    _.each( req.useragent, function( element, key ) {
        if ( _.isBoolean( element ) ) {
            if ( element === true ) {
                user[ key ] = element;
            }
        } else {
            user[ key ] = element;
        }
    } );

    req.bridge.dbLogger = {
        data: {
            origin         :  req.get( 'origin' ),
            userAgent      :  user,
            bridgeHeader   :  req.get( 'bridge' ),
            responseHeaders:  null,
            method         :  req.method,
            datatype: path.basename( req.path )
        },
        datatype: path.basename( req.path ),
        userID: 1
    };

    next();

};

exports.dbLoggerUserIDAssigner = function( req, res, next ) {

    req.bridge.dbLogger.userID = req.bridge.user.ID;

    next();

};
