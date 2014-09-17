"use strict";

var _      = require( "lodash" );
var Q      = require( 'q' );
var path   = require( 'path' );
var bridge = require( '../server' );


var config = bridge.config;


exports.Author = "Bridge Web Server";

/**
 * Covert arracy to an xlsx file using a specific sheet name and a
 * @param  {2DArray} array       A 2D array containing the information for the XLSX Table
 * @param  {String} fileName     The filename to use when writing the file to the FS
 * @param  {String} sheetName    The name of the sheet to put the Table on
 * @param  {Array} columnWidths  An array of objects containing either a wpx or wch properties
 * @return {Promise}             A Q style promise object
 */
module.exports = function( array, filePath, sheetName, columnWidths ) {
    return Q.Promise( function( resolve, reject ) {


    } );
};
