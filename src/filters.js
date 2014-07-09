"use strict";

var crypto      = require('crypto');
//
var bridgeError = require('./error');
var regex       = require('./regex');
var revalidator = require('revalidator');

var filterSchema = {
    properties: {
        "date-max": {
            type: 'string',
            pattern: regex.iSOTime,
            required: false,
            messages: {
                pattern: "is not in ISO format"
            }
        },

        "date-min": {
            type: 'string',
            pattern: regex.iSOTime,
            required: false,
            messages: {
                pattern: "is not in ISO format"
            }
        },

        deleted: {
            type: 'boolean',
            required: false
        },

        email: {
            type: 'string',
            format: 'email',
            required: false
        },

        "first-name": {
            type: 'string',
            required: false,
            allowEmpty: false,
        },

        "last-name": {
            type: 'string',
            required: false,
            allowEmpty: false
        },

        "max-results": {
            type: 'integer',
            required: false,
            minimum: 0
        },

        offset: {
            type: 'integer',
            required: false,
            minimum: 0
        },

        role: {
            type: 'string',
            required: false,
            enum: [ 'admin', 'user' ]
        },

        status: {
            type: 'string',
            required: false,
            enum: [ 'created', 'locked', 'normal' ]
        }
    }
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

    var filters = {};

    req.params.forEach( function ( element ) {
        if ( typeof element !== 'string' ) {

            // Create the error
            var filterElementTypeError = bridgeError.createError( 400, '', "Filter parameter is not a string" );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( filterElementTypeError ),
                Reason: "Filter element was not type of string",
                Parameters: JSON.stringify( req.params ),
                RequestBody: JSON.stringify( req.body )
            } );

            // Throw the error
            error( filterElementTypeError );
        }

        var parts = element.split( '=' );

        if ( parts.length !== 2 ) {

            // Create the error
            var elementSplitLengthError = bridgeError.createError( 400, 'Malformed equal on filter', "Either no \'=\' character or more than one." );

            // Log the error and relevant information
            app.get( 'logger' ).verbose( {
                Error: JSON.stringify( elementSplitLengthError ),
                Reason: "Zero or more than one Equal character in the element string for a filter parameter",
                Parameter: element,
                RequestBody: JSON.stringify( req.body ),
            } );

            // Throw the error
            error( elementSplitLengthError );
        }

        filters[ parts[ 0 ] ] = parts[ 1 ];

    });

    var validate = revalidator.validate( filters, filterSchema );

    if (validate === false) {

        var validationError = bridgeError.createError( 400, 'Malformed filter object', "The filter on the request failed to validate" );

        app.log.verbose({
            Error: validationError,
            Reason: validate.errors,
            RequestBodt: req.body,
            FiltersObject: filters
        });

        error( validationError );
        return;

    }

    next();
    return;
};
