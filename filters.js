"use strict";

var app    = require('./server').app,
    crypto = require('crypto');

exports.authenticationFilter = function(req, res, next, error){

    app.get('database').query('SELECT * FROM users WHERE email = ?', [req.body.email], function(err, rows){

        if (err){
            error( {
                msg: err,
                statusCode: 403
            });
            return;
        }

        if (rows.length !== 1) {
            error({
                msg: "user not found or more than one user found for that email",
                statusCode: 403
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
                statusCode: 403
            });
            return;
        }
        req.bridge.user = user;
        
        next();
    });
};

/**
 * This filter is used for registration authentication. also does dataVaildation
 * @param  {Object}   req  The express request object.
 * @param  {Object}   res  The express response object.
 * @param  {Function} next The callback function for when the operation is complete
 * @return {Undefined}
 */
exports.registrationAuthenticationFilter = function(req, res, next){


    // Validating Password
    {
        // Preform a regex on the password to make sure it is in correct format
        var passRegex = /^[a-z0-9]{64}$/;
        var passReg = passRegex.exec(req.body.content.password);

        if (passReg === null)
            throw {
                msg: "password is in incorrect format",
                statusCode: 400
        };


        var hmac = crypto.createHmac('sha256', req.body.content.password);
        var concat = JSON.stringify(req.body.content) + req.body.email + req.body.time;
        hmac.update(concat);
        var valHmac = hmac.digest('hex');

        if (valHmac !== req.body.hmac) {
            throw {
                msg: "unauthorized",
                statusCode: 403
            };
        }
    }

    req.bridge.user = {};
    req.bridge.regObj = {
        Email: req.body.content.email,
        Pass: req.body.content.password,
        FName: req.body.content['first-name'],
        LName: req.body.content['last-name'],
        RegCode: req.body.content.regcode,
        AppData: {
            "pretest"       : false,
            "module1-page1" : false,
            "module1-page2" : false,
            "exercise1"     : false,
            "module2-page1" : false,
            "module2-page2" : false,
            "exercise2"     : false,
            "module3-page1" : false,
            "module3-page2" : false,
            "exercise3"     : false,
            "posttest"      : false,
            "kt-plan"       : false
        }
    };

    next();
};

exports.authorizationFilter = function(req, res, next, error){
    var database = app.get('database');
    database.query("SELECT * FROM users WHERE email = ?", [req.body.email], function(err, rows){
        
        if (err){
            error({
                msg: err,
                statusCode: 401
            });
            return;
        }

        if (rows.length !== 1){
            throw {
                msg: "user not found or more than one user found for that email",
                statusCode: 401
            };
        }

        var user = rows[0];

        if (!varExists(user)){
            throw {
                msg: "no user with that email",
                statusCode: 401
            };
        }

        var role = user.ROLE;



        next();
    });
};

exports.registrationDataVaildation = function(req, res, next){

    // Make sure all of the nessesary data for registration exists
    if (req.body.content == null || req.body.content.email == null ||
        req.body.content.password == null || req.body.content['first-name'] == null ||
        req.body.content['last-name'] == null || req.body.content.regcode == null)
    {
        throw {
            msg: "Missing data needed for registration",
            statusCode: 400
        };
    }

    // Validating Email
    {
        var emailRegex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/g;
        var emailReg = emailRegex.exec(req.body.content.email);

        if (emailReg === null)
            throw {
                msg: "Email inside content is mis-formatted",
                statusCode: 400
            };

    }

    // Validating First and Last Name
    {
        var nameRegex = /^[a-zA-Z]{2,}$/;
        var fNameReg = nameRegex.exec(req.body.content['first-name']);

        if (fNameReg === null)
            throw {
                msg: "first name failed to validate",
                statusCode: 400
            };

        var lNameReg = nameRegex.exec(req.body.content['last-name']);

        if (lNameReg === null)
            throw {
                msg: "last name failed to validate",
                statusCode: 400
            };
    }

    var password = req.body.content.password;


    if (!(password)){
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
    res.content.additionalData = {};
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