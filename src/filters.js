"use strict";

var crypto      = require('crypto');
var bridgeError = require('./error');
var regex       = require('./regex');

/**
 * A filter used to authenticate a user from the bridge database.
 * @param  {Object}   req   The express request object.
 * @param  {Object}   res   The express response object.
 * @param  {Function} next  Callback for when the function is complete
 * @param  {Function} error Callback for when an error occurs
 * @return {Undefined}
 */
exports.authenticationFilter = function(req, res, next, error){

    if (req.bridge.isAnon === true){
        var authenticationError = new bridgeError("Cannot authenticate", 403);
        app.get('logger').verbose({
            Error: JSON.stringify(authenticationError),
            Reason: "Cannot authenticate an anonymous request",
            "Request Body": JSON.stringify(req.body)
        });
        error(authenticationError);
        return;
    }

    app.get('database').query('SELECT * FROM users WHERE EMAIL = ?', [req.body.email], function(err, rows){

        if (err){
            var databaseError = new bridgeError ('Database query error. see log files for more information', 403);
            app.get('logger').warn({
                Reason: JSON.stringify(err),
                Query: "SELECT * FROM users WHERE email = " + req.body.email,
                Error: JSON.stringify(databaseError)
            });
            error(databaseError);
            return;
        }

        if (rows.length !== 1) {
            var resultError = new bridgeError("User not found or more than one user found for that email", 403);
            app.get('logger').warn({
                Results: JSON.stringify(rows),
                Query: "SELECT * FROM users WHERE EMAIL = " + req.body.email,
                Error: JSON.stringify(resultError)
            });
            error( resultError );
            return;
        }

        var user = rows[0];

        var hmac = crypto.createHmac('sha256', user.PASSWORD);
        var concat = JSON.stringify(req.body.content) + (req.body.email) + req.body.time;
        hmac.update( concat );
        var valHmac = hmac.digest('hex');


        if (valHmac !== req.body.hmac) {
            var hmacError = new bridgeError("Failed hmac check", 403);
            app.get('logger').warn({
                Reason: 'Request failed hmac check',
                "Request Body": JSON.stringify(req.body),
                "Target HMAC" : valHmac,
                "Request HMAC": req.body.hmac,
                Error: JSON.stringify(hmacError)
            });
            error( hmacError );
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
exports.registrationAuthenticationFilter = function(req, res, next, error){


    // Validating Password
    {
        // Preform a regex on the password to make sure it is in correct format
        var passRegex = regex.sha256;
        var passReg = passRegex.exec(req.body.content.password);

        if (passReg === null){
            var passFormatError = new bridgeError('Request password is in incorrect format', 400);
            app.get('logger').info({
                Reason: 'Request password doesn\'t pass the regex check',
                "Request Password Hash": req.body.content.password,
                "Request Body": JSON.stringify(req.body),
                Error: JSON.stringify(passFormatError)
            });
            error( passFormatError );
            return;
        }


        var hmac = crypto.createHmac('sha256', '');
        var concat = JSON.stringify(req.body.content) + req.body.email + req.body.time;
        hmac.update(concat);
        var valHmac = hmac.digest('hex');

        if (valHmac !== req.body.hmac) {
            var hmacError = new bridgeError("Failed hmac check", 403);
            app.get('logger').warn({
                Reason: 'Request failed hmac check',
                "Request Body": JSON.stringify(req.body),
                "Target HMAC" : valHmac,
                "Request HMAC": req.body.hmac,
                Error: JSON.stringify(hmacError)
            });
            error( hmacError );
            return;
        }
    }

    req.bridge.user = {
        Email: req.body.content.email,
        Pass: req.body.content.password,
        FName: req.body.content.firstname,
        LName: req.body.content.lastname,
        AppData: req.body.content.appData
    };

    next();
};

/**
 * Checks the request for the correct data structures and validates the format of those fields.
 * @param  {Object}   req   The express request object.
 * @param  {Object}   res   The express response object.
 * @param  {Function} next  The callback for the completion of this filter
 * @param  {Function} error The callback for an error occuring in the filter.
 * @return {Undefined} 
 */ 
exports.registrationDataVaildation = function ( req, res, next, error ) {

    // Make sure all of the nessesary data for registration exists
    if ( req.body.content == null || req.body.content.email == null ||
        req.body.content.password == null || req.body.content.firstName == null ||
        req.body.content.lastName == null || req.body.content.appData == null ) 
    {
        var requestBodyContentFormatError = new bridgeError( 'Request body content missing property. See log for more information', 400 );
        app.get( 'logger' ).info( {
            Error: JSON.stringify( requestBodyContentFormatError ),
            Reason: "Property on the request body content for registration is either null or defined.",
            "Request Body": JSON.stringify( req.body )
        } );
        error( requestBodyContentFormatError );
        return;
    }

    // Validating Email
    {
        var emailRegex = regex.email;
        var emailReg = emailRegex.exec( req.body.content.email );

        if ( emailReg === null ) {
            var emailFormatError = new bridgeError( 'Email property has failed to validate', 400 );
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( bridgeError ),
                Reason: "Email from request has failed to pass the regex check",
                "Request Body": req.body
            } );
            error( emailFormatError );
            return;
        }

    }

    // Validating First and Last Name
    {
        var nameRegex = regex.name;
        var fNameReg = nameRegex.exec( req.body.content.firstName );

        if ( fNameReg === null ) {
            var nameFormatError = new bridgeError( 'First name property found but is not in a valid format', 400 );
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( nameFormatError ),
                Reason: "First name property didn't pass regex",
                "Request Body": JSON.stringify( req.body ),
            } );
            error( nameFormatError );
            return;
        }

        var lNameReg = nameRegex.exec( req.body.content.lastName );

        if ( lNameReg === null ) {
            var lnameFormatError = new bridgeError( 'Last name property found but is not in a valid format', 400 );
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( lnameFormatError ),
                Reason: "Last name property didn't pass the regex",
                "Request Body": JSON.stringify( req.body ),
            } );
            error( lnameFormatError );
            return;
        }
    }

    // Validating Password field of the request body content
    {

        var password    = req.body.content.password;

        var sha256Regex = regex.sha256;

        var passReg     = sha256Regex.exec(password);

        if ( passReg === null ) {
            var passFormatError = new bridgeError( 'Password property found but is not in a valid format', 400 );
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( passFormatError ),
                Reason: "Password property didn't pass its regex",
                "Request Body": JSON.stringify( req.body )
            } );
            error( passFormatError );
            return;
        }
    }
    {
        if (!_.isObject(req.body.content.appData)){
            var appDataFormatError = new bridgeError( 'AppData property found but is not in a valid format, expected an object', 400 );

            app.get('logger').verbose( {
                Error: JSON.stringify(appDataFormatError),
                Reason: "Type of property app data is not an object",
                "Request Body": JSON.stringify(req.body)
            } );

            error(appDataFormatError);
            return;
        }
    }

    next();
};

/**
 * Determine the filters for a given request based on its params
 * @param  {Object}   req   The express request object.
 * @param  {Object}   res   The express response object.
 * @param  {Function} next  The function to call when this function is complete.
 * @param  {Function} error The function to call when this function has an error.
 * @return {Undefined}
 */
exports.determineRequestFilters = function ( req, res, next, error ) {

    req.filters = [];

    req.params.forEach( function ( element ) {
        if ( typeof element !== 'string' ) {

            // Create the error
            var filterElementTypeError = new bridgeError( 'Filter parameter is not a string', 400 );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( filterElementTypeError ),
                Reason: "Filter element was not type of string",
                Parameters: JSON.stringify( req.params ),
                "Request Body": JSON.stringify( req.body )
            } );

            // Throw the error
            error( filterElementTypeError );
        }

        var parts = element.split( '=' );

        if ( parts.length !== 2 ) {

            // Create the error
            var elementSplitLengthError = new bridgeError( 'Either no \'=\' character or more than one.', 400 );
            
            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( elementSplitLengthError ),
                Reason: "Zero or more than one Equal character in the element string for a filter parameter",
                Parameter: element,
                "Request Body": JSON.stringify( req.body ),
            } );

            // Throw the error
            error( elementSplitLengthError );
        }

        var filter = {};

        parts[ 1 ] = parts[ 1 ].substring( 0, parts[ 1 ].length - 1 );
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
                    {
                        // Create the error
                        var deletedFilterValueParseError = new bridgeError( 'Value of deleted parameter could not be parsed to either \'true\' or \'false\'', 400 );
                        
                        // Log the error and relevant information
                        app.get( 'logger' ).verbose( {
                            Error: JSON.stringify( deletedFilterValueParseError ),
                            Reason: "Could not parse value of deleted filter to true or false",
                            Parameter: element,
                            "Request Body": JSON.stringify( req.body ),
                        } );

                        // Throw the error
                        error( deletedFilterValueParseError );
                        return;
                    }
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
            {
                var limit = parseInt( parts[ 1 ] );
                if ( isNaN( limit ) ) {

                    // Create the error
                    var maxResultsFilterValueParseError = new bridgeError( 'Value of \'max-results\' parameter could not be parsed to a number', 400 );
                    
                    // Log the error and relevant information
                    app.get( 'logger' ).verbose( {
                        Error: JSON.stringify( maxResultsFilterValueParseError ),
                        Reason: "Could not parse value for Max Results filter to a number",
                        Parameter: element,
                        "Request Body": JSON.stringify( req.body )
                    } );

                    // Throw the error
                    error( maxResultsFilterValueParseError );
                    return;
                }
                req.limit = limit;
            }
            break;

            case 'offset':
            {
                var offset = parseInt( parts[ 1 ] );
                if ( isNaN( offset ) ) {

                    // Create the error
                    var offsetFilterValueParseError = new bridgeError( 'Value of \'offset\' parameter could not be parsed to a number', 400 );

                    // Log the error and relevant information
                    app.get( 'logger' ).verbose( {
                        Error: JSON.stringify( offsetFilterValueParseError ),
                        Reason: "Could not parse value for offset filter to a number",
                        Parameter: element,
                        "Request Body": JSON.stringify( req.body )
                    } );

                    // Throw the error
                    error( offsetFilterValueParseError );
                    return;
                }
                req.offset = offset;
            }
            break;

            case 'role':
            {
                filter.field = "ROLE";
                switch ( parts[ 1 ] ) {

                case 'admin':
                    filter.value = "admin";
                    break;

                case 'user':
                    filter.value = "user";
                    break;

                default:
                    {
                        // Create the error
                        var roleFilterValueParseError = new bridgeError( 'value of \'role\' parameter could not be parse to either \'admin\' or \'user\'', 400 );

                        // Log the error and relevant information
                        app.get( 'logger' ).verbose( {
                            Error: JSON.stringify( roleFilterValueParseError ),
                            Reason: "Could not parse value for role to either user or admin",
                            Parameter: element,
                            "Request Body": JSON.stringify( req.body )
                        } );

                        // Throw the error
                        error( roleFilterValueParseError );
                        return;
                    }
                }
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
                    case'recover':
                        filter.value = 'RECOVER';
                    break;
                    default:
                    {
                        // Create the error
                        var statusFilterValueParseError = new bridgeError( 'value of \'status\' parameter could not be parsed to either \'CREATED\' or \'LOCKED\' or \'NORMAL\'', 400 );

                        // Log the error with relevant information
                        app.get( 'logger' ).verbose( {
                            Error: JSON.stringify( statusFilterValueParseError ),
                            Reason: "Could not parse value of status to CREATED or LOCKED or NORMAL",
                            Parameter: element,
                            "Request Body": JSON.stringify( req.body )
                        } );

                        // Throw the error
                        error( statusFilterValueParseError );
                        return;
                    }
                }
            break;

            // Element was not found.. therefore ignoring
            default:
            {
                return;
            }
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
 * @param  {Object}   res  The responses body object.
 * @param  {Function} next The function to call when the filter is complete.
 * @return {Undefined}     Nothing
 */
exports.responseAddUser = function ( req, res, next, error ) {

    if ( !req.bridge.user ) {

        // Create the error
        var needAuthenticationError = new bridgeError( 'Cannot add user to the response without authentication', 403 );

        // Log the error and relevant information
        app.get( 'logger' ).verbose( {
            Error: JSON.stringify( needAuthenticationError ),
            Reason: "Tried to add the user to the response object without authentication",
            "Request Body": JSON.stringify( req.body ),
        } );

        // Throw the error
        error( needAuthenticationError );
        return;
    }

    var appData = {};

    try {
        appData = JSON.parse( req.bridge.user.APP_DATA );
    } catch ( err ) {

        // Create the error
        var userParseError = new bridgeError( 'Could not parse application data to an object', 500 );

        // Log the error and relevant information
        app.get( 'logger' ).verbose( {
            Error: userParseError,
            Reason: "Failed to parse the users application data to JSON",
            "Request Body": JSON.stringify( req.body ),
            "Application Data": req.bridge.user.APP_DATA
        } );

        // Throw the error
        error( userParseError );
        return;
    }

    res.user = {};

    res.user.email        = req.bridge.user.EMAIL;
    res.user.firstName    = req.bridge.user.FIRST_NAME;
    res.user.lastName     = req.bridge.user.LAST_NAME;
    res.user.status       = req.bridge.user.STATUS;
    res.user.role         = req.bridge.user.ROLE;
    res.user.appData      = appData;

    next();
};
