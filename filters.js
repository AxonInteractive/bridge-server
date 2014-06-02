"use strict";

var app    = require('./server').app,
    crypto = require('crypto');

exports.authenticationFilter = function(req, res, next, error){

    app.get('database').query('SELECT * FROM users WHERE email = ?', [req.body.email], function(err, rows){

        if (err){
            error( {
                msg: err,
                statusCode: 400
            });
            return;
        }

        if (rows.length !== 1) {
            error({
                msg: "user not found or more than one user found for that email",
                statusCode: 400
            });
            return;
        }
        var user = rows[0];

        var hmac = crypto.createHmac('sha256', user.PASSWORD);
        var concat = JSON.stringify(req.body.content) + (req.body.email) + req.body.time;
        hmac.update( concat );
        var valHmac = hmac.digest('hex');


        if (valHmac !== req.body.hmac) {
            error({
                msg: "unauthorized",
                statusCode: 401
            });
            return;
        }
        req.bridge.user = user;
        
        next();
    });
};

exports.registrationAuthenticationFilter = function(req, res, next){

    var hmac = crypto.createHmac('sha256', req.body.content.password);
    hmac.update(req.body.content + req.body.email + req.body.time);
    var valHmac = hmac.digest('hex');

    if (valHmac !== req.body.hmac){
        throw {
            msg: "unauthorized",
            statusCode: 401
        };
    }

    req.bridge.user = {};

    next();
};

exports.authorizationFilter = function(req, res, next, error){
    var database = app.get('database');
    database.query("SELECT * FROM users WHERE email = ?", [req.body.email], function(err, rows){
        
        if (err){
            error({
                msg: err,
                statusCode: 400
            });
            return;
        }

        if (rows.length !== 1){
            throw {
                msg: "user not found or more than one user found for that email",
                statusCode: 400
            };
        }

        var user = rows[0];

        if (!varExists(user)){
            throw {
                msg: "no user with that email",
                statusCode: 400
            };
        }

        var role = user.ROLE;



        next();
    });
};

exports.registrationDataVaildation = function(req, res, next){
    var password = req.body.content.password;


    if (!varExists(password)){
        throw {
            msg: "password does not exist",
            statusCode: 400
        };
    }

    var sha256 = crypto.createHash('sha256');
    var hash = sha256.update('something').digest('hex');

    if (hash.length !== password.length)
        throw {
            msg: "password is not valid",
            statusCode: 400
        };


    var regCode = req.body.content.regcode;

    if (!varExists(regCode)){
        throw {
            msg: "regCode does not exist",
            statusCode: 400
        };
    }


    next();
};

exports.determineRequestFilters = function(req, res, next){

    req.filters = [];

    req.params.forEach(function(element){
        if (typeof element !== 'string')
            throw {
                msg: "filter params mis-formatted",
                statusCode: 400
            };

        var parts = element.split('=');

        if (parts.length !== 2){
            throw {
                msg: "filter parma could not be interpreted " + element,
                statusCode: 400
            };
        }

        var filter = {};

        parts[1] = parts[1].substring(0,parts[1].length-1);

        switch(parts[0]){
            case 'date-max':
            break;

            case 'date-min':
            break;

            case 'deleted':
                filter.field = "DELETED";
                switch (parts[1]){
                    case 'true':
                        filter.value = 1;
                    break;

                    case 'false':
                        filter.value = 0;
                    break;

                    default:
                    throw {
                        msg: "could not parse the 'DELETED' parameter. param: " + element,
                        statusCode: 400
                    };
                }
            break;

            case 'email':
                filter.field = "EMAIL";
                filter.value = parts[1];
            break;

            case 'first-name':
                filter.field = "FIRST_NAME";
                filter.value = parts[1];
            break;

            case 'last-name':
                filter.field = "LAST_NAME";
                filter.value = parts[1];
            break;

            case 'max-results':
                var limit = parseInt(parts[1]);
                if (isNaN(limit)){
                    throw {
                        msg: "could not parse the param for max-results to an int",
                        statusCode: 400
                    };
                }
                req.limit = limit;
            break;

            case 'offset':
                var offset = parseInt(parts[1]);
                if (isNaN(offset)){
                    throw {
                        msg: "could not parse the param for offset to an int",
                        statusCode: 400
                    };
                }
                req.offset = offset;
            break;

            case 'role':
                filter.field = "ROLE";
                switch(parts[1]){
                    case 'admin':
                        filter.value = "admin";
                    break;

                    case 'user':
                        filter.value = "user";
                    break;

                    default:
                    throw {
                        msg: "could not parse param for role",
                        statusCode: 400
                    };
                }
            break;

            case 'status':
                filter.field = "STATUS";
                switch(parts[1]){
                    case'created':
                        filter.value = 'CREATED';
                    break;
                    case'locked':
                        filter.value = 'LOCKED';
                    break;
                    case'normal':
                        filter.value = 'NORMAL';
                    break;
                    default:
                    throw {
                        msg: "could not parse param status",
                        statusCode: 400
                    };
                }
            break;

            default:
                throw {
                    msg: "invaild parameter: " + element,
                    statusCode: 400
                };
        }

        if (filter !== {}){
            req.filters.push(filter);
        }
    });


    next();
};

/**
 * Gets the app data from an authenticated user and attaches it to the response under response -> content -> user
 * @param  {Object}   req  The request object.
 * @param  {Object}   res  The response object.
 * @param  {Function} next The function to call when the filter is complete.
 * @return {Undefined}     Nothing
 */
exports.getRequestUser = function(req, res, next) {

    if (!req.bridge.user)
        throw {
            msg: "tried to do action without authorization",
            statusCode: 401
        };
    try {
        res.content.user = JSON.parse(req.bridge.user.APP_DATA);
    }
    catch(err){
        app.get('consoleLogger').error('failed to parse APP DATA as json');
        app.get('consoleLogger').error(req.bridge.user.APP_DATA);
        throw {
            msg: 'Failed to parse JSON from APP DATA',
            statusCode: 500
        };
    }
    next();
};

function varExists(variable){
    if (typeof variable === 'undefined'){
        return false;
    }
    else if (variable === null){
        return false;
    }

    return true;
}