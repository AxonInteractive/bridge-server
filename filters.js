"use strict";

var app      = require('./server').app,
    database = require('./server').database,
    crypto   = require('crypto');

exports.authenticationFilter = function(req, res, next){

    database.query('SELECT * FROM users WHERE email = ?', ['first@domain.com'], function(rows){
        var user = rows[0];

            if (!varExists(user)){
            throw {
                msg: "no user with that email",
                statusCode: 400
            };
        }
        var hmac = crypto.createHmac('sha256', user.password);
        hmac.update(req.body.content + req.body.email + req.body.time);
        var valHmac = hmac.digest('hex');

        if (valHmac !== req.body.hmac){
            throw {
                msg: "unauthorized",
                statusCode: 401
            };
        }
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
    next();
};

exports.authorizationFilter = function(req, res, next){
    var user = database.query("SELECT * FROM users WHERE email = '" + req.body.email + "'")[0];

    if (!varExists(user)){
        throw {
            msg: "no user with that email",
            statusCode: 400
        };
    }

    next();

};

exports.basicReqFilter = function(req, res, next){
    var body = req.body;
    var content = body.content;

    // Check if the content exists
    if (!varExists(content)){
        throw {
            msg: "content does not exist",
            statusCode: 400
        };
    }

    var email = content.email;
    var password = content.password;

    // Check the email field of the request
    {
        if (!varExists(email)){
            throw { 
                msg: "email does not exist",
                statusCode: 400
            };
        }

        var regex = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~])*@[a-zA-Z](-?[a-zA-Z0-9])*(\.[a-zA-Z](-?[a-zA-Z0-9])*)+$/g;
        var reg = regex.exec(email);

        if (reg === null){
            throw { 
                msg: "email is not valid",
                statusCode: 400
            };

        }
    }

    // Check the password hash send with the content
    {
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
    }


    next();
};

exports.regCodeFilter = function(req, res, next){
    var regCode = req.body.content.regcode;

    if (!varExists(regCode)){
        throw {
            msg: "regCode does not exist",
            statusCode: 400
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