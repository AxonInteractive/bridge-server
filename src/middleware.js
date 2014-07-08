"use strict";

var error       = require( './error' );
var regex       = require( './regex' );
var revalidator = require( 'revalidator' );
var crypto      = require( 'crypto' );
var database    = require( './database' );

/**
 * Add the nessesary CORS headers to the response object.
 * @param {Object}   req  The express request object.
 * @param {Object}   res  The express response object.
 * @param {Function} next The function to call when this function is complete.
 */
exports.attachCORSHeaders = function ( req, res, next ) {
    res.setHeader( 'Access-Control-Allow-Origin', req.headers.origin || '*' );
    next();
};

/**
 * Creates objects on the request object and on the response object
 *  necessary for bridge to pass messages around
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The function to call when this function is complete.
 */
exports.prepareBridgeObjects = function ( req, res, next ) {
    req.bridge = {};
    next();
};

/**
 * Handle CORS request. this is due to the proxy setup for the case of PEIR.
 * @param  {Object}    req The express request object.
 * @param  {Object}    res The express response object.
 * @return {Undefined}
 */
exports.handleOptionsRequest = function ( req, res, next ) {

    if ( req.method !== 'OPTIONS' ) {
        next();
        return;
    }

    res.status( 204 );

    res.setHeader( 'access-control-allow-methods', 'GET, PUT, OPTIONS, POST, DELETE' );
    res.setHeader( 'access-control-allow-headers', "content-type, accept" );

    res.setHeader( 'access-control-max-age' , 10 );
    res.setHeader( 'content-length'         , 0  );

    res.send();
};

/**
 * Read the query string from a get request and parse it to an object
 * @param  {Object}    req   The express request object.
 * @param  {Object}    res   The express response object.
 * @param  {Function}  next  The function to call when the middleware is complete.
 * @return {Undefined}
 */
exports.parseGetQueryString = function ( req, res, next ) {
    if ( req.method !== 'GET' ) {
        next();
        return;
    }

    if ( req.query.payload == null ) {
        next();
        return;
    }

    var strObj = decodeURIComponent( req.query.payload );

    if ( strObj == null || strObj === '' ) {
        next();
        return;
    }

    try {
        req.body = JSON.parse( strObj );
    } catch ( err ) {
        var ErrQueryString = error.createError( 400, 'Request JSON failed to parse',"BAD JSON in the query string payload object" );

        app.get( 'logger' ).verbose( {
            Error: ErrQueryString,
            JSONString: strObj
        } );

        res.error  = ErrQueryString;

        return;
    }
    next();
};

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
            pattern: regex.iSOTime,
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
exports.verifyRequestStructure = function ( req, res ) {


    app.log.info('Hello');
    var validation = revalidator.validate(req.body, bridgeRequestSchema);
    var vrsError;

    if (validation.valid === false) {
        var firstError = validation.errors[ 0 ];

        var errorCode = 'Basic request structure malformed';

        if ( firstError.property == 'email' ) {
            errorCode = 'Invalid email format';
        } else if ( firstError.property == 'time' ) {
            errorCode = 'Invalid time format';
        } else if ( firstError.property == 'HMAC' ) {
            errorCode = 'Invalid HMAC format';
        }

        vrsError = error.createError( 400, errorCode, "Property " + firstError.property + " - " + firstError.message );

        app.log.verbose( {
            Error: vrsError,
            RequestBody: req.body
        } );

        res.error = vrsError;
        return;
    }

    req.bridge.isAnon = (req.body.email === "");

    var hmacSalt;

    if (req.bridge.isAnon === true) {
        hmacSalt = "";

        if ( !checkHmacSignature( req, hmacSalt ) ) {
            vrsError = error.createError( 400, 'HMAC failed', 'HMAC check failed for anonymous request. *Caught in middleware*');

            app.get( 'logger' ).verbose( {
                Error: vrsError,
                RequestBody: req.body
            } );

            res.error = vrsError;
            return;
        }

        req.bridge.structureVerified = true;
        return;
    }

    else {
        database.authenticateRequest( req, res, function ( err ) {
            if ( err ) {

                app.get( 'logger' ).verbose( {
                    Error: err,
                    RequestBody: req.body
                } );

                res.error = err;
                return;
            }

            hmacSalt = req.bridge.user.PASSWORD;

            if ( !checkHmacSignature( req, hmacSalt ) ) {
                vrsError = error.createError( 400, 'HMAC failed' ,'HMAC check failed for authenticated request. *Caught in middleware*' );

                app.get( 'logger' ).verbose( {
                    Error: vrsError,
                    RequestBody: req.body
                } );

                res.error = vrsError;
                return;
            }

            req.bridge.structureVerified = true;
            //next();
            return;
        } );
    }

    
};

function checkHmacSignature( req, hmacSalt ) {

    var concat = JSON.stringify( req.body.content ) + req.body.email + req.body.time;

    var hmac = crypto.createHmac( 'sha256', hmacSalt ).update( concat ).digest( 'hex' );

    return ( req.body.hmac === hmac );
}

function bridgeErrorHandler( req, res, next ) {


    if ( _.has( res, 'error' )) {

        var errorContext;
        if ( _.isObject( res.error ) ) {
            errorContext = res.error;
        } else if ( _.isArray( res.error ) ) {
            errorContext = res.error[0];
        } else {

            return;
        }

        var validation = error.validateError( errorContext );

        if ( validation.valid === false ) {

            app.get( 'logger' ).verbose( 'Error malformed. Errors: ', validation.errors );

            return;
        }

        app.get( 'logger' ).silly( 'Bridge Error verified' );
        var config = app.get( 'BridgeConfig' );

        errorContext.time = new Date().toISOString();

        res.status( errorContext.status );

        app.log.verbose('Sending Error');

        if ( config.server.environment == 'development' ) {
            res.json( { content: errorContext } );
        }
        else {
            res.json( {
                content: {
                    status: errorContext.status,
                    errorCode: errorContext.errorCode,
                    time: errorContext.time
                }
            } );
        }

    }

    next();
    return;
}

exports.bridgeHandleErrors = bridgeErrorHandler;
