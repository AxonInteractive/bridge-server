"use strict";

var app = require('../server').app;
var error = require('./error');

/**
 * Add the nessesary CORS headers to the response object.
 * @param {Object}   req  The express request object.
 * @param {Object}   res  The express response object.
 * @param {Function} next The function to call when this function is complete.
 */
exports.attachCORSHeaders = function(req, res, next){
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    next();
};

/**
 * Creates objects on the request object and on the response object
 *  necessary for bridge to pass messages around
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The function to call when this function is complete.
 */
exports.prepareBridgeObjects = function (req, res, next){
    req.bridge = {};
    next();
};

/**
 * Handle CORS request. this is due to the proxy setup for the case of PEIR.
 * @param  {Object}    req The express request object.
 * @param  {Object}    res The express response object.
 * @return {Undefined}
 */
exports.handleOptionsRequest = function(req, res, next){
    if (req.method !== 'OPTIONS'){
        next();
        return;
    }
    res.status(204);
    //res.setHeader('access-control-allow-origin', req.headers.origin || '*');
    res.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS, POST, DELETE');
    res.setHeader('access-control-allow-headers', "content-type, accept");
    res.setHeader('access-control-max-age', 10);
    res.setHeader('content-length', 0);
    res.send();
};

/**
 * Read the query string from a get request and parse it to an object
 * @param  {Object}  req    The express request object.
 * @param  {Object}  res    The express response object.
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
exports.parseGetQueryString = function(req, res, next){
    if (req.method !== 'GET'){
            next();
            return;
    }

    if (req.query.payload == null)
    {
        next();
        return;
    }

    var strObj = decodeURIComponent(req.query.payload);

    if (strObj == null || strObj === ''){
            next();
            return;
    }

    try {
        req.body = JSON.parse(strObj);
    }
    catch(err){
        var ErrQueryString = new error('BAD JSON in the query string payload object', 400);
        app.get('logger').warn(ErrQueryString.Message + '\n' + strObj);
        res.status(ErrQueryString.StatusCode);
        res.send({ content:{ message: ErrQueryString.Message } });
        return;
    }
    next();
};

/**
 * Setup the bridge structure such that 
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
exports.setupResponseHeaders = function(req, res, next){
    var resContent = res.body;
    res.body = {
        content: resContent
    };
    next();
};

/**
 * Verify that the request has the necessary structure and content to be handled by the bridge
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The function to call when this function is complete
 */
exports.verifyRequestStructure = function ( req, res, next ) {
    var body    = req.body;
    var content = body.content;
    var email   = body.email;
    var time    = body.time;
    var hmac    = body.hmac;

    // Check if the content exists
    if ( content == null ) {
        var contentError = new error( 'Content property does not exist on the request', 400 );

        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( contentError ),
            Reason: "Content property doesn't exist on the body of the request",
            "Request Body": JSON.stringify( req.body )
        } );

        res.status( contentError.StatusCode );
        res.send( {
            content: {
                message: contentError.Message
            }
        } );
        return;
    }

    // Check the email field of the request
    {
        if ( email == null ) {
            var emailExistError = new error( 'Email property of the bridge body does not exist', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( emailExistError ),
                Reason: "Email property doesn't exist on the body of the request",
                "Request Body": JSON.stringify( req.body )
            } );

            res.status( emailExistError.StatusCode );
            res.send( {
                content: {
                    message: emailExistError.Message
                }
            } );
            return;
        }

        var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/g;
        var reg = emailRegex.exec( email );

        if ( reg == null ) {
            var emailRegexError = new error( 'Email was found but is not a valid format', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( emailRegexError ),
                Reason: "Email failed to pass regex check for validation",
                "Request Body": JSON.stringify( req.body ),
                Email: email
            } );

            res.status( emailRegexError.StatusCode );
            res.send( {
                content: {
                    message: emailRegexError.Message
                }
            } );
            return;
        }
    }
    
    // Check the time field of the message
    {
        if ( time == null ) {
            var timeExistError = new error( 'Time property of the bridge body does not exist', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( timeExistError ),
                Reason: "Time property doesn't exist on the body of the request",
                "Request Body": JSON.stringify( req.body )
            } );

            res.status( timeExistError.StatusCode );
            res.send( {
                content: {
                    message: timeExistError.Message
                }
            } );
            return;
        }

        var timeRegex = /^\d{4}-(0[1-9]|1[1-2])-([0-2]\d|3[0-1])T([0-1]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z/g;
        var timeReg = timeRegex.exec( time );

        if ( timeReg == null ) {
            var timeRegexError = new error( 'Time was found but is not a valid format', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( timeRegexError ),
                Reason: "Time failed to pass regex check for validation",
                "Request Body": JSON.stringify( req.body ),
                Time: time
            } );


            res.status( timeRegexError.StatusCode );
            res.send( {
                content: {
                    message: timeRegexError.Message
                }
            } );
            return;
        }

        var reqTimeObj = new Date( time );
        if ( reqTimeObj == null ) {
            var timeParseError = new error( 'Time string could not be parsed to an object', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( reqTimeObj ),
                Reason: "Time could not be parsed to an date object",
                "Request Body": JSON.stringify( req.body ),
                Time: time
            } );

            res.status( timeParseError.StatusCode );
            res.send( {
                content: {
                    message: timeParseError.Message
                }
            } );
            return;
        }

        var nowTimeObj = new Date();
        var timeDiff = nowTimeObj - reqTimeObj;

        if ( timeDiff > 60000 && timeDiff < 0 ) {
            var timeDiffError = new error( 'Time was pared to an object but is too old', 400 );

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( timeDiffError ),
                Reason: "The delta time between time the request was send and the time it was received was over one minute in the past or in the future",
                "Request Body": JSON.stringify( req.body ),
                "Current Time": JSON.stringify(nowTimeObj),
                "Request Created Time": JSON.stringify(reqTimeObj),
                "Time Difference in ms": timeDiff
            } );

            res.status( timeDiffError.StatusCode );
            res.send( {
                content: {
                    message: timeDiffError.Message
                }
            } );
            return;
        }
    }

    // Check the hmac field of the message
    {
        if (hmac == null){
            var hmacExistError = new error('Hmac property of the bridge body does not exist', 400);

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( hmacExistError ),
                Reason: "hmac property doesn't exist on the body of the request",
                "Request Body": JSON.stringify( req.body )
            } );

            res.status(hmacExistError.StatusCode);
            res.send({
                content: {
                    message: hmacExistError.Message
                }
            });
            return;
        }

        var sha256Regex = /^[a-z0-9]{64}$/;
        var hashReg = sha256Regex.exec(hmac);
        if (hashReg === null){
            var hmacFormatError = new error('Hmac was found but is not a valid format', 400);

            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( hmacFormatError ),
                Reason: "hmac isnt properly formatted in the request. Failed regex check",
                "Request Body": JSON.stringify( req.body ),
                HMAC: hmac
            } );

            res.status(hmacFormatError.StatusCode);
            res.send({
                content: {
                    message: hmacFormatError.Message
                }
            });
            return;
        }

    }

    req.bridge = {};
    res.content = {};

    next();
};