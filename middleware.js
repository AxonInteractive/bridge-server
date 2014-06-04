"use strict";

var app = require('./server').app;

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
        app.get('logger').warn('Bad JSON String:\n' + strObj);
        res.status(400);
        res.send();
        return;
    }
    next();
};

/**
 * Verify that the request has the necessary structure and content to be handled by the bridge
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The function to call when this function is complete
 */
exports.verifyRequestStructure = function(req, res, next){
    var body    = req.body;
    var content = body.content;
    var email   = body.email;
    var time    = body.time;
    var hmac    = body.hmac;

    // Check if the content exists
    if (content == null){
        res.status(400);
        res.send({
            msg: "content does not exist"
        });
        return;
    }

    // Check the email field of the request
    {
        if (email == null){
            res.status(400);
            res.send({
                msg: "email does not exist"
            });
            return;
        }

        var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/g;
        var reg = emailRegex.exec(email);

        if (reg == null){
            res.status(400);
            res.send({
                msg: "email is not valid"
            });
            return;
        }
    }
    
    // Check the time field of the message
    {
        if (time == null){
            res.status(400);
            res.send({
                msg: "time does not exist"
            });
            return;
        }

        var timeRegex = /^\d{4}-(0[1-9]|1[1-2])-([0-2]\d|3[0-1])T([0-1]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z/g;
        var timeReg = timeRegex.exec(time);

        if (timeReg == null)
        {
            res.status(400);
            res.send({
                msg: "time is not valid"
            });
        }

        var reqTimeObj = new Date(time);
        if (reqTimeObj == null){
            res.status(400);
            res.send({
                msg: 'time could not be parsed as an object'
            });
            return;
        }

        var nowTimeObj = new Date();
        var timeDiff = nowTimeObj - reqTimeObj;

        if ( timeDiff > 60000 && timeDiff < 0 ){
            res.status(400);
            res.send({
                msg: "time difference on the request is to large. diff: " + timeDiff,
            });
            return;
        }
    }

    // Check the hmac field of the message
    {
        if (hmac == null){
            res.status(400);
            res.send({
                msg: "hmac does not exist"
            });
            return;
        }

        var passregex = /^[a-z0-9]{64}$/;
        var passReg = passregex.exec(hmac);
        if (passReg === null){
            res.status(400);
            res.send({
                msg: "password is not valid",
            });
            return;
        }

    }

    req.bridge = {};
    res.content = {};

    next();
};